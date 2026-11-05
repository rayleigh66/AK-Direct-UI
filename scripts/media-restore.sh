#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${BACKUP_FILE:?Set BACKUP_FILE to a *_media_*.tar.gz archive}"
: "${COMPOSE_PROJECT:?Set COMPOSE_PROJECT to the exact deployment Compose project}"
: "${CONFIRM_MEDIA_VOLUME:?Set CONFIRM_MEDIA_VOLUME to the exact media volume name}"
if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore media without CONFIRM_RESTORE=yes." >&2
  exit 1
fi

PROJECT="$COMPOSE_PROJECT"
TARGET_VOLUME="${PROJECT}_media_data"
ALPINE_IMAGE="${MEDIA_RESTORE_IMAGE:-alpine:3.20}"
MANAGE_API="${RESTORE_MANAGE_API:-1}"

if [ "$CONFIRM_MEDIA_VOLUME" != "$TARGET_VOLUME" ]; then
  echo "Refusing to restore: CONFIRM_MEDIA_VOLUME must be $TARGET_VOLUME for project $PROJECT." >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Media backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if ! docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1; then
  echo "Refusing to restore: media volume $TARGET_VOLUME does not exist." >&2
  exit 1
fi

VOLUME_PROJECT="$(docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}' "$TARGET_VOLUME" 2>/dev/null || true)"
VOLUME_NAME="$(docker volume inspect -f '{{index .Labels "com.docker.compose.volume"}}' "$TARGET_VOLUME" 2>/dev/null || true)"
if [ "$VOLUME_PROJECT" != "$PROJECT" ] || [ "$VOLUME_NAME" != "media_data" ]; then
  echo "Refusing to restore: $TARGET_VOLUME is not the Compose media_data volume of $PROJECT." >&2
  exit 1
fi

BACKUP_DIR="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
BACKUP_NAME="$(basename "$BACKUP_FILE")"

echo "Validating media archive before touching the target volume..."
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "Refusing to restore: the archive is not a valid gzip file (corrupt or truncated)." >&2
  exit 1
fi
if ! ENTRY_LIST="$(tar -tzf "$BACKUP_FILE" 2>/dev/null)"; then
  echo "Refusing to restore: the archive member list cannot be read." >&2
  exit 1
fi
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  case "$entry" in
    ./*) ;;
    *)
      echo "Refusing to restore: archive member is not relative (./...): $entry" >&2
      exit 1
      ;;
  esac
  relative="${entry#./}"
  case "/$relative/" in
    *"/../"*)
      echo "Refusing to restore: archive member contains path traversal: $entry" >&2
      exit 1
      ;;
  esac
  case "$relative" in
    *\\*)
      echo "Refusing to restore: archive member contains a backslash: $entry" >&2
      exit 1
      ;;
  esac
done <<< "$ENTRY_LIST"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "${line%"${line#?}"}" in
    -|d) ;;
    *)
      echo "Refusing to restore: archive contains a non-regular entry: $line" >&2
      exit 1
      ;;
  esac
done < <(tar -tvzf "$BACKUP_FILE" 2>/dev/null)

STAGING_VOLUME="${PROJECT}_media_staging_$$"
PREVIOUS_VOLUME="${PROJECT}_media_previous_$$"
KEEP_PREVIOUS=0
API_STOPPED=0

cleanup() {
  docker volume rm -f "$STAGING_VOLUME" >/dev/null 2>&1 || true
  if [ "$KEEP_PREVIOUS" = "0" ]; then
    docker volume rm -f "$PREVIOUS_VOLUME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

volume_manifest() {
  docker run --rm -v "$1:/data:ro" "$ALPINE_IMAGE" sh -c \
    'cd /data 2>/dev/null || exit 0; find . -type f -exec sha256sum {} + 2>/dev/null | LC_ALL=C sort'
}

restore_from_volume() {
  local source="$1"
  docker run --rm -v "$source:/from:ro" -v "$TARGET_VOLUME:/to" "$ALPINE_IMAGE" sh -c \
    'rm -rf /to/* /to/.[!.]* /to/..?* 2>/dev/null; cd /from && tar -cf - . | tar -xf - -C /to && chown -R 1000:1000 /to'
}

API_ID=""

api_container_id() {
  docker compose -p "$PROJECT" ps -q api 2>/dev/null | head -n1 || true
}

wait_for_api_healthy() {
  local timeout="${API_HEALTH_TIMEOUT_SECONDS:-120}"
  local waited=0
  local status=""
  local id
  id="$(api_container_id)"
  if [ -z "$id" ]; then
    echo "API container was not created after restart." >&2
    return 1
  fi
  while [ "$waited" -lt "$timeout" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in
      healthy) return 0 ;;
      exited|dead|missing)
        echo "API state is $status after restart." >&2
        return 1
        ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done
  echo "API did not become healthy within ${timeout}s (last status: $status)." >&2
  return 1
}

start_api() {
  if [ "$MANAGE_API" != "1" ] || [ "$API_STOPPED" != "1" ]; then
    return 0
  fi
  echo "Restarting the API..."
  if ! docker compose -p "$PROJECT" up -d --no-deps api; then
    echo "API restart command failed." >&2
    return 1
  fi
  if ! wait_for_api_healthy; then
    echo "API restart or health check failed." >&2
    return 1
  fi
  API_STOPPED=0
  return 0
}

rollback() {
  echo "Rolling back the media volume from the pre-restore snapshot..." >&2
  if ! restore_from_volume "$PREVIOUS_VOLUME"; then
    KEEP_PREVIOUS=1
    echo "Rollback FAILED. The original media remains in volume $PREVIOUS_VOLUME; restore it manually." >&2
    return 1
  fi
  if [ "$(volume_manifest "$TARGET_VOLUME")" != "$PREVIOUS_MANIFEST" ]; then
    KEEP_PREVIOUS=1
    echo "Rollback verification FAILED. The original media remains in volume $PREVIOUS_VOLUME; restore it manually." >&2
    return 1
  fi
  echo "Rollback completed. The previous media content is restored." >&2
  return 0
}

fail_restore() {
  echo "$1" >&2
  if ! rollback; then
    echo "Writers remain stopped. Do NOT restart the API until the media volume is repaired from $PREVIOUS_VOLUME." >&2
    exit 1
  fi
  if ! start_api; then
    echo "Rollback succeeded, but the API did not restart healthy. Do not send traffic until the API is verified." >&2
    exit 1
  fi
  exit 1
}

# 1. Extract into an isolated staging volume and verify the extraction result.
echo "Extracting the archive into an isolated staging volume..."
docker volume create "$STAGING_VOLUME" >/dev/null
if ! docker run --rm \
  -v "$STAGING_VOLUME:/staging" \
  -v "$BACKUP_DIR:/restore:ro" \
  "$ALPINE_IMAGE" sh -c \
  "tar -xzf '/restore/$BACKUP_NAME' -C /staging && chown -R 1000:1000 /staging"; then
  echo "Refusing to restore: extraction failed. The target media volume was not modified." >&2
  exit 1
fi
STAGED_MANIFEST="$(volume_manifest "$STAGING_VOLUME")"

# 2. Stop writes BEFORE taking the pre-restore snapshot. The API is the only
#    writer of the media volume (the backup service mounts it read-only).
if [ "$MANAGE_API" = "1" ]; then
  echo "Stopping the API before the pre-restore snapshot..."
  if ! docker compose -p "$PROJECT" stop api; then
    echo "Refusing to restore: docker compose stop api failed. The target media volume was not modified." >&2
    exit 1
  fi
  API_ID="$(api_container_id)"
  if [ -n "$API_ID" ]; then
    RUNNING="$(docker inspect -f '{{.State.Running}}' "$API_ID" 2>/dev/null || echo true)"
    if [ "$RUNNING" = "true" ]; then
      echo "Refusing to restore: the API is still running after stop. The target media volume was not modified." >&2
      exit 1
    fi
  fi
  API_STOPPED=1
  echo "API writes are stopped."
else
  echo "WARNING: RESTORE_MANAGE_API=0 skips API quiescing; use this only in isolated tests." >&2
fi

# 3. Snapshot the (now quiescent) media so a failed promotion can be rolled back.
echo "Snapshotting the current media volume..."
docker volume create "$PREVIOUS_VOLUME" >/dev/null
if ! docker run --rm -v "$TARGET_VOLUME:/from:ro" -v "$PREVIOUS_VOLUME:/to" "$ALPINE_IMAGE" sh -c \
  'cd /from && tar -cf - . | tar -xf - -C /to'; then
  echo "Refusing to restore: could not snapshot the current media. The target was not modified." >&2
  if [ "$API_STOPPED" = "1" ]; then
    if ! start_api; then
      echo "The API could not be restarted; writers remain stopped." >&2
    fi
  fi
  exit 1
fi
PREVIOUS_MANIFEST="$(volume_manifest "$PREVIOUS_VOLUME")"

# 4. Promote staging to the target and verify the result.
if ! restore_from_volume "$STAGING_VOLUME"; then
  fail_restore "Promotion into the media volume failed."
fi

RESTORED_MANIFEST="$(volume_manifest "$TARGET_VOLUME")"
if [ "${MEDIA_RESTORE_TEST_FORCE_VERIFY_FAILURE:-0}" = "1" ]; then
  echo "Test hook: forcing post-promotion verification failure." >&2
  RESTORED_MANIFEST="forced-mismatch"
fi
if [ "$RESTORED_MANIFEST" != "$STAGED_MANIFEST" ]; then
  fail_restore "Post-restore verification failed: the media volume does not match the archive."
fi

# 5. Only reopen writers after a verified restore.
if ! start_api; then
  KEEP_PREVIOUS=1
  echo "Media was restored and verified, but the API did not restart healthy. Do not send traffic to the API. The previous media snapshot is kept in volume $PREVIOUS_VOLUME for manual recovery." >&2
  exit 1
fi
echo "Media restore completed from $BACKUP_FILE (project $PROJECT, volume $TARGET_VOLUME)."
