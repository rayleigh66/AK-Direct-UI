#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="aoking-media-restore-test-$$"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aoking-media-restore-test.XXXXXX")"
ENV_FILE="$WORK_DIR/env"
BACKUP_ROOT="$WORK_DIR/backups"
mkdir -p "$BACKUP_ROOT" "$WORK_DIR/src/sub"
ALPINE_IMAGE="${MEDIA_RESTORE_IMAGE:-alpine:3.20}"
PRODUCTION_VOLUME="aoking-direct_media_data"
STATUS=0

case "$PROJECT" in
  aoking-media-restore-test-*) ;;
  *)
    echo "Refusing to run: unexpected test project name $PROJECT." >&2
    exit 1
    ;;
esac
[ "$PROJECT" != "aoking-direct" ] || exit 1

cat > "$ENV_FILE" <<EOF
POSTGRES_DB=aoking_media_test
POSTGRES_USER=aoking_media_test
POSTGRES_PASSWORD=media_restore_test_password
MIGRATION_DATABASE_URL=postgres://aoking_media_test:media_restore_test_password@db:5432/aoking_media_test
RUNTIME_DB_USER=aoking_media_runtime
RUNTIME_DB_PASSWORD=media_restore_runtime_password
DATABASE_URL=postgres://aoking_media_runtime:media_restore_runtime_password@db:5432/aoking_media_test
WEB_PORT=18999
BACKUP_RETENTION_DAYS=30
BACKUP_HOST_DIR=$BACKUP_ROOT
API_IMAGE=aoking-direct-api:4b03
MIGRATE_IMAGE=aoking-direct-migrate:4b03
WEB_IMAGE=aoking-direct-web:4b03
EOF

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker volume ls -q | grep "^${PROJECT}_media_" | while IFS= read -r volume; do
    docker volume rm -f "$volume" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

volume_manifest() {
  docker run --rm -v "$1:/data:ro" "$ALPINE_IMAGE" sh -c \
    'cd /data 2>/dev/null || exit 0; find . -type f -exec sha256sum {} + 2>/dev/null | LC_ALL=C sort'
}

expect_failure() {
  local label="$1"
  shift
  if "$@" >"$WORK_DIR/failure.log" 2>&1; then
    echo "FAIL: $label unexpectedly succeeded." >&2
    cat "$WORK_DIR/failure.log" >&2
    STATUS=1
  fi
}

restore() {
  COMPOSE_PROJECT="$PROJECT" \
  CONFIRM_MEDIA_VOLUME="${CONFIRM_MEDIA_VOLUME_OVERRIDE:-${PROJECT}_media_data}" \
  CONFIRM_RESTORE=yes \
  RESTORE_MANAGE_API=0 \
  MEDIA_RESTORE_IMAGE="$ALPINE_IMAGE" \
  BACKUP_FILE="$1" \
  bash scripts/media-restore.sh
}

assert_unchanged() {
  local label="$1"
  local expected="$2"
  local actual
  actual="$(volume_manifest "${PROJECT}_media_data")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label changed the target media volume." >&2
    STATUS=1
  fi
}

reset_media() {
  docker run --rm -v "${PROJECT}_media_data:/media" "$ALPINE_IMAGE" sh -c \
    'rm -rf /media/* /media/.[!.]* 2>/dev/null; printf "%s" "original-file" > /media/original.txt; mkdir -p /media/keep; printf "%s" "keep-me" > /media/keep/keep.txt; chown -R 1000:1000 /media'
}

echo "=== Isolated Compose project: $PROJECT ==="
if ! docker image inspect aoking-direct-api:4b03 >/dev/null 2>&1; then
  echo "NOT RUN: build the stack first so aoking-direct-api:4b03 exists." >&2
  exit 2
fi
compose create api >/dev/null
docker volume inspect "${PROJECT}_media_data" >/dev/null

PRODUCTION_MANIFEST_BEFORE=""
if docker volume inspect "$PRODUCTION_VOLUME" >/dev/null 2>&1; then
  PRODUCTION_MANIFEST_BEFORE="$(volume_manifest "$PRODUCTION_VOLUME")"
fi

printf '%s' 'new-file-content' > "$WORK_DIR/src/new.txt"
printf '%s' 'nested-content' > "$WORK_DIR/src/sub/nested.txt"
COPYFILE_DISABLE=1 tar -czf "$WORK_DIR/valid.tar.gz" -C "$WORK_DIR/src" .
chmod 600 "$WORK_DIR/valid.tar.gz"

printf '%s' 'not a gzip archive' > "$WORK_DIR/corrupt.tar.gz"
head -c 60 "$WORK_DIR/valid.tar.gz" > "$WORK_DIR/truncated.tar.gz"

python3 - "$WORK_DIR" <<'PY'
import io, sys, tarfile
root = sys.argv[1]

def add_bytes(tar, name, data):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = 0o600
    tar.addfile(info, io.BytesIO(data))

with tarfile.open(f"{root}/unsafe.tar.gz", "w:gz") as tar:
    add_bytes(tar, "./ok.txt", b"ok")
    add_bytes(tar, "../escape.txt", b"escape")

with tarfile.open(f"{root}/extract-fail.tar.gz", "w:gz") as tar:
    add_bytes(tar, "./a", b"file")
    add_bytes(tar, "./a/b", b"nested-under-file")
PY

restore_wrong_target() {
  CONFIRM_MEDIA_VOLUME_OVERRIDE="${PROJECT}_wrong_volume" restore "$@"
}

echo "=== Wrong target confirmation ==="
reset_media
BEFORE="$(volume_manifest "${PROJECT}_media_data")"
expect_failure "wrong target" restore_wrong_target "$WORK_DIR/valid.tar.gz"
assert_unchanged "wrong target" "$BEFORE"

echo "=== Missing target volume ==="
expect_failure "missing volume" env COMPOSE_PROJECT="${PROJECT}-missing" \
  CONFIRM_MEDIA_VOLUME="${PROJECT}-missing_media_data" CONFIRM_RESTORE=yes \
  RESTORE_MANAGE_API=0 MEDIA_RESTORE_IMAGE="$ALPINE_IMAGE" BACKUP_FILE="$WORK_DIR/valid.tar.gz" \
  bash scripts/media-restore.sh

for archive in corrupt.tar.gz truncated.tar.gz unsafe.tar.gz extract-fail.tar.gz; do
  echo "=== Rejected archive: $archive ==="
  reset_media
  BEFORE="$(volume_manifest "${PROJECT}_media_data")"
  expect_failure "$archive" restore "$WORK_DIR/$archive"
  assert_unchanged "$archive" "$BEFORE"
done

echo "=== Rollback after forced post-promotion verification failure ==="
reset_media
BEFORE="$(volume_manifest "${PROJECT}_media_data")"
if MEDIA_RESTORE_TEST_FORCE_VERIFY_FAILURE=1 COMPOSE_PROJECT="$PROJECT" \
  CONFIRM_MEDIA_VOLUME="${PROJECT}_media_data" CONFIRM_RESTORE=yes RESTORE_MANAGE_API=0 \
  MEDIA_RESTORE_IMAGE="$ALPINE_IMAGE" BACKUP_FILE="$WORK_DIR/valid.tar.gz" \
  bash scripts/media-restore.sh >"$WORK_DIR/rollback.log" 2>&1; then
  echo "FAIL: forced verification failure unexpectedly succeeded." >&2
  STATUS=1
fi
assert_unchanged "forced rollback" "$BEFORE"

echo "=== Valid restore and content verification ==="
reset_media
restore "$WORK_DIR/valid.tar.gz"
RESTORED_MANIFEST="$(volume_manifest "${PROJECT}_media_data")"
EXPECTED_MANIFEST="$(
  docker run --rm -v "$WORK_DIR/src:/src:ro" "$ALPINE_IMAGE" sh -c \
    'cd /src && find . -type f -exec sha256sum {} + | LC_ALL=C sort'
)"
if [ "$RESTORED_MANIFEST" != "$EXPECTED_MANIFEST" ]; then
  echo "FAIL: valid restore content does not match the archive." >&2
  STATUS=1
fi
if docker run --rm -v "${PROJECT}_media_data:/media:ro" "$ALPINE_IMAGE" sh -c 'test -e /media/original.txt'; then
  echo "FAIL: restored volume still contains pre-restore files." >&2
  STATUS=1
fi
LEFT=$(docker volume ls -q | grep -c "${PROJECT}_media_\(staging\|previous\)_" || true)
if [ "$LEFT" != "0" ]; then
  echo "FAIL: staging/previous volumes were not cleaned up." >&2
  STATUS=1
fi

echo "=== Live API: RESTORE_MANAGE_API=1 ordering, stop failure, rollback and restart ==="
REAL_DOCKER="$(command -v docker)"
FAKEBIN="$WORK_DIR/fakebin"
mkdir -p "$FAKEBIN"

start_isolated_api() {
  compose up -d --wait db >/dev/null 2>&1 || return 1
  compose up -d --no-deps --wait api >/dev/null 2>&1
}

api_container() {
  compose ps -q api 2>/dev/null | head -n1 || true
}

api_is_healthy() {
  local id
  id="$(api_container)"
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)" = "healthy" ]
}

run_live_restore() {
  local archive="$1"
  shift
  env COMPOSE_PROJECT="$PROJECT" \
    CONFIRM_MEDIA_VOLUME="${PROJECT}_media_data" \
    CONFIRM_RESTORE=yes \
    RESTORE_MANAGE_API=1 \
    MEDIA_RESTORE_IMAGE="$ALPINE_IMAGE" \
    BACKUP_FILE="$archive" \
    "$@" \
    bash scripts/media-restore.sh
}

write_fake_docker() {
  local pattern="$1"
  local action="$2"
  cat > "$FAKEBIN/docker" <<EOF
#!/bin/sh
case " \$* " in
  $pattern) $action ;;
esac
exec "$REAL_DOCKER" "\$@"
EOF
  chmod +x "$FAKEBIN/docker"
}

EXPECTED_MANIFEST="$(
  docker run --rm -v "$WORK_DIR/src:/src:ro" "$ALPINE_IMAGE" sh -c \
    'cd /src && find . -type f -exec sha256sum {} + | LC_ALL=C sort'
)"

if ! start_isolated_api; then
  echo "NOT RUN: could not start the isolated API for live restore tests." >&2
  STATUS=1
else
  for _ in $(seq 1 60); do
    api_is_healthy && break
    sleep 2
  done
  if ! api_is_healthy; then
    echo "NOT RUN: isolated API did not become healthy." >&2
    STATUS=1
  else
    LIVE_OK=1
  fi
fi

if [ "${LIVE_OK:-0}" = "1" ]; then
  echo "--- Live 1: normal restore stops the API, snapshots, promotes and restarts ---"
  reset_media
  if ! run_live_restore "$WORK_DIR/valid.tar.gz" >"$WORK_DIR/live-normal.log" 2>&1; then
    echo "FAIL: normal live restore failed." >&2
    cat "$WORK_DIR/live-normal.log" >&2
    STATUS=1
  fi
  if [ "$(volume_manifest "${PROJECT}_media_data")" != "$EXPECTED_MANIFEST" ]; then
    echo "FAIL: normal live restore content mismatch." >&2
    STATUS=1
  fi
  if ! api_is_healthy; then
    echo "FAIL: API is not healthy after a successful live restore." >&2
    STATUS=1
    start_isolated_api || true
  fi
  STOP_LINE=$(grep -n "Stopping the API before the pre-restore snapshot" "$WORK_DIR/live-normal.log" | cut -d: -f1 | head -n1)
  SNAP_LINE=$(grep -n "Snapshotting the current media volume" "$WORK_DIR/live-normal.log" | cut -d: -f1 | head -n1)
  if [ -z "$STOP_LINE" ] || [ -z "$SNAP_LINE" ] || [ "$STOP_LINE" -ge "$SNAP_LINE" ]; then
    echo "FAIL: the API was not stopped before the pre-restore snapshot." >&2
    STATUS=1
  fi

  echo "--- Live 2: stop failure rejects the restore and leaves media untouched ---"
  reset_media
  BEFORE="$(volume_manifest "${PROJECT}_media_data")"
  write_fake_docker '*"compose -p '"$PROJECT"' stop api"*' 'echo "simulated stop failure" >&2; exit 1'
  if PATH="$FAKEBIN:$PATH" run_live_restore "$WORK_DIR/valid.tar.gz" >"$WORK_DIR/live-stop.log" 2>&1; then
    echo "FAIL: restore succeeded despite a stop failure." >&2
    STATUS=1
  fi
  assert_unchanged "stop failure" "$BEFORE"
  if ! grep -q "stop api failed" "$WORK_DIR/live-stop.log"; then
    echo "FAIL: stop failure was not reported." >&2
    STATUS=1
  fi
  if ! api_is_healthy; then
    echo "FAIL: API stopped unexpectedly after a simulated stop failure." >&2
    STATUS=1
  fi

  echo "--- Live 3: promotion verification failure rolls back while writes are stopped ---"
  reset_media
  BEFORE="$(volume_manifest "${PROJECT}_media_data")"
  if run_live_restore "$WORK_DIR/valid.tar.gz" MEDIA_RESTORE_TEST_FORCE_VERIFY_FAILURE=1 \
    >"$WORK_DIR/live-rollback.log" 2>&1; then
    echo "FAIL: forced live verification failure succeeded." >&2
    STATUS=1
  fi
  assert_unchanged "live rollback" "$BEFORE"
  if ! grep -q "Rollback completed" "$WORK_DIR/live-rollback.log"; then
    echo "FAIL: live rollback did not report success." >&2
    STATUS=1
  fi
  if ! api_is_healthy; then
    echo "FAIL: API was not restarted after a successful rollback." >&2
    STATUS=1
  fi

  echo "--- Live 4: API restart command failure is reported and keeps the snapshot ---"
  reset_media
  write_fake_docker '*"compose -p '"$PROJECT"' up -d --no-deps api"*' 'echo "simulated restart failure" >&2; exit 1'
  if PATH="$FAKEBIN:$PATH" run_live_restore "$WORK_DIR/valid.tar.gz" >"$WORK_DIR/live-restart.log" 2>&1; then
    echo "FAIL: restore reported success despite a restart failure." >&2
    STATUS=1
  fi
  if ! grep -q "API restart command failed" "$WORK_DIR/live-restart.log"; then
    echo "FAIL: restart failure was not reported." >&2
    STATUS=1
  fi
  if grep -q "Media restore completed" "$WORK_DIR/live-restart.log"; then
    echo "FAIL: restore printed success after a restart failure." >&2
    STATUS=1
  fi
  if [ "$(volume_manifest "${PROJECT}_media_data")" != "$EXPECTED_MANIFEST" ]; then
    echo "FAIL: verified media was not preserved when the restart failed." >&2
    STATUS=1
  fi
  PREVIOUS_KEPT=$(docker volume ls -q | grep -c "${PROJECT}_media_previous_" || true)
  if [ "$PREVIOUS_KEPT" -lt 1 ]; then
    echo "FAIL: previous media snapshot was not preserved after a restart failure." >&2
    STATUS=1
  fi
  rm -f "$FAKEBIN/docker"
  docker volume rm -f $(docker volume ls -q | grep "${PROJECT}_media_previous_" || true) >/dev/null 2>&1 || true
  start_isolated_api || true

  echo "--- Live 5: API health-check failure is reported and keeps the snapshot ---"
  reset_media
  write_fake_docker '*"inspect -f {{if .State.Health}}"*' 'echo starting; exit 0'
  if PATH="$FAKEBIN:$PATH" run_live_restore "$WORK_DIR/valid.tar.gz" API_HEALTH_TIMEOUT_SECONDS=3 \
    >"$WORK_DIR/live-health.log" 2>&1; then
    echo "FAIL: restore reported success despite a health-check failure." >&2
    STATUS=1
  fi
  if ! grep -q "did not become healthy" "$WORK_DIR/live-health.log"; then
    echo "FAIL: health-check failure was not reported." >&2
    STATUS=1
  fi
  if grep -q "Media restore completed" "$WORK_DIR/live-health.log"; then
    echo "FAIL: restore printed success after a health-check failure." >&2
    STATUS=1
  fi
  PREVIOUS_KEPT=$(docker volume ls -q | grep -c "${PROJECT}_media_previous_" || true)
  if [ "$PREVIOUS_KEPT" -lt 1 ]; then
    echo "FAIL: previous media snapshot was not preserved after a health-check failure." >&2
    STATUS=1
  fi
  rm -f "$FAKEBIN/docker"
fi

if [ -n "$PRODUCTION_MANIFEST_BEFORE" ]; then
  if [ "$(volume_manifest "$PRODUCTION_VOLUME")" != "$PRODUCTION_MANIFEST_BEFORE" ]; then
    echo "FAIL: the production-named media volume was modified." >&2
    STATUS=1
  fi
fi

if [ "$STATUS" -eq 0 ]; then
  echo "Media restore security tests PASSED."
else
  echo "Media restore security tests FAILED." >&2
fi
exit "$STATUS"
