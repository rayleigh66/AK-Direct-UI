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

rollback() {
  echo "Rolling back the media volume from the pre-restore snapshot..." >&2
  if restore_from_volume "$PREVIOUS_VOLUME"; then
    echo "Rollback completed. The previous media content is restored." >&2
  else
    KEEP_PREVIOUS=1
    echo "Rollback FAILED. The original media remains in volume $PREVIOUS_VOLUME; restore it manually." >&2
  fi
}

start_api() {
  if [ "$MANAGE_API" = "1" ] && [ "$API_STOPPED" = "1" ]; then
    docker compose -p "$PROJECT" up -d api >/dev/null 2>&1 || true
  fi
}

fail_restore() {
  echo "$1" >&2
  rollback
  start_api
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

# 2. Snapshot the current media so a failed promotion can be rolled back.
echo "Snapshotting the current media volume..."
docker volume create "$PREVIOUS_VOLUME" >/dev/null
if ! docker run --rm -v "$TARGET_VOLUME:/from:ro" -v "$PREVIOUS_VOLUME:/to" "$ALPINE_IMAGE" sh -c \
  'cd /from && tar -cf - . | tar -xf - -C /to'; then
  echo "Refusing to restore: could not snapshot the current media. The target was not modified." >&2
  exit 1
fi

# 3. Stop the API, promote staging to the target, and verify the result.
if [ "$MANAGE_API" = "1" ]; then
  if docker compose -p "$PROJECT" stop api >/dev/null 2>&1; then
    API_STOPPED=1
  fi
fi

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

start_api
echo "Media restore completed from $BACKUP_FILE (project $PROJECT, volume $TARGET_VOLUME)."
