#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PRODUCTION_VOLUME="aoking-direct_postgres_data"
PRODUCTION_BACKUP_DIR="$ROOT_DIR/backups"
SENTINEL="$PRODUCTION_BACKUP_DIR/.smoke-isolation-sentinel-$$"
MANIFEST="$(mktemp "${TMPDIR:-/tmp}/aoking-direct-backup-manifest.XXXXXX")"
VOLUME_CREATED=0
VOLUME_CREATED_AT=""
STATUS=0

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

cleanup() {
  if [ "$VOLUME_CREATED" = "1" ]; then
    docker volume rm "$PRODUCTION_VOLUME" >/dev/null 2>&1 || true
  fi
  rm -f "$SENTINEL" "$MANIFEST"
}
trap cleanup EXIT

if docker volume inspect "$PRODUCTION_VOLUME" >/dev/null 2>&1; then
  echo "Existing production-named volume found; it will only be inspected, not modified."
  VOLUME_CREATED_AT="$(docker volume inspect -f '{{.CreatedAt}}' "$PRODUCTION_VOLUME")"
else
  echo "Creating a disposable sentinel volume named $PRODUCTION_VOLUME."
  docker volume create "$PRODUCTION_VOLUME" >/dev/null
  VOLUME_CREATED=1
  VOLUME_CREATED_AT="$(docker volume inspect -f '{{.CreatedAt}}' "$PRODUCTION_VOLUME")"
  docker run --rm -v "$PRODUCTION_VOLUME:/data" postgres:16.4-alpine \
    sh -c "printf 'sentinel' > /data/.smoke-isolation-marker"
fi

mkdir -p "$PRODUCTION_BACKUP_DIR"
printf 'smoke-isolation-sentinel' > "$SENTINEL"
chmod 600 "$SENTINEL"
SENTINEL_HASH_BEFORE="$(hash_file "$SENTINEL")"

# Record existing production backup files; they must remain byte-identical.
while IFS= read -r -d '' file; do
  printf '%s  %s\n' "$(hash_file "$file")" "$file"
done < <(find "$PRODUCTION_BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print0) > "$MANIFEST"

echo "=== Negative guard: production backup directory must be refused ==="
if SMOKE_BACKUP_DIR="$PRODUCTION_BACKUP_DIR" bash scripts/verify-compose.sh >/tmp/smoke-guard-backup.log 2>&1; then
  echo "FAIL: verify-compose.sh accepted the production backup directory." >&2
  STATUS=1
else
  grep -q 'must not be the production ./backups directory' /tmp/smoke-guard-backup.log || {
    echo "FAIL: production backup guard did not fail with the expected reason." >&2
    STATUS=1
  }
fi

echo "=== Negative guard: production project name must be refused ==="
if SMOKE_PROJECT="aoking-direct" bash scripts/verify-compose.sh >/tmp/smoke-guard-project.log 2>&1; then
  echo "FAIL: verify-compose.sh accepted the production project name." >&2
  STATUS=1
else
  grep -q 'SMOKE_PROJECT must start with aoking-direct-smoke-' /tmp/smoke-guard-project.log || {
    echo "FAIL: production project guard did not fail with the expected reason." >&2
    STATUS=1
  }
fi

echo "=== Running isolated smoke ==="
set +e
bash scripts/verify-compose.sh
SMOKE_STATUS=$?
set -e
if [ "$SMOKE_STATUS" -ne 0 ]; then
  STATUS=1
fi

echo "=== Verifying production-named volume and backups are untouched ==="
if ! docker volume inspect "$PRODUCTION_VOLUME" >/dev/null 2>&1; then
  echo "FAIL: production-named volume was removed." >&2
  STATUS=1
elif [ "$(docker volume inspect -f '{{.CreatedAt}}' "$PRODUCTION_VOLUME")" != "$VOLUME_CREATED_AT" ]; then
  echo "FAIL: production-named volume identity changed." >&2
  STATUS=1
elif [ "$VOLUME_CREATED" = "1" ]; then
  MARKER="$(docker run --rm -v "$PRODUCTION_VOLUME:/data" postgres:16.4-alpine \
    sh -c 'cat /data/.smoke-isolation-marker 2>/dev/null || true')"
  [ "$MARKER" = "sentinel" ] || {
    echo "FAIL: sentinel volume content was modified." >&2
    STATUS=1
  }
fi

[ -f "$SENTINEL" ] || {
  echo "FAIL: production backup sentinel file was removed." >&2
  STATUS=1
}
if [ -f "$SENTINEL" ] && [ "$(hash_file "$SENTINEL")" != "$SENTINEL_HASH_BEFORE" ]; then
  echo "FAIL: production backup sentinel file was modified." >&2
  STATUS=1
fi

while IFS= read -r line; do
  [ -z "$line" ] && continue
  expected="${line%%  *}"
  file="${line#*  }"
  if [ ! -f "$file" ] || [ "$(hash_file "$file")" != "$expected" ]; then
    echo "FAIL: existing production backup was changed or removed: $file" >&2
    STATUS=1
  fi
done < "$MANIFEST"

rm -f /tmp/smoke-guard-backup.log /tmp/smoke-guard-project.log

if [ "$STATUS" -ne 0 ]; then
  echo "Smoke isolation regression FAILED." >&2
  exit 1
fi

echo "Smoke isolation regression PASSED: production-named volume and backup files were not touched."
