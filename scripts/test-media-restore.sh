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
  docker volume rm -f "${PROJECT}_media_data" "${PROJECT}_media_staging_"* "${PROJECT}_media_previous_"* >/dev/null 2>&1 || true
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
