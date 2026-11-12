#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PRODUCTION_VOLUME="aoking-direct_postgres_data"
PRODUCTION_BACKUP_DIR="$ROOT_DIR/backups"
MANIFEST="$(mktemp "${TMPDIR:-/tmp}/aoking-direct-backup-manifest.XXXXXX")"
SIMULATED_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aoking-direct-simulated-backups.XXXXXX")"
SIMULATED_SENTINEL="$SIMULATED_BACKUP_DIR/sentinel"
CONTROL_ENV="$(mktemp "${TMPDIR:-/tmp}/aoking-direct-control-env.XXXXXX")"
CONTROL_CONFIG="$(mktemp "${TMPDIR:-/tmp}/aoking-direct-control-config.XXXXXX")"
CONTROL_PROJECT="aoking-direct-smoke-control-$$"
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
  rm -rf "$SIMULATED_BACKUP_DIR"
  rm -f "$MANIFEST" "$CONTROL_ENV" "$CONTROL_CONFIG"
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

# Read-only manifest of real production backups. The isolation test never
# writes a sentinel into the real backup directory.
if [ -d "$PRODUCTION_BACKUP_DIR" ]; then
  while IFS= read -r -d '' file; do
    printf '%s  %s\n' "$(hash_file "$file")" "$file"
  done < <(find "$PRODUCTION_BACKUP_DIR" -maxdepth 1 -type f \
    \( -name '*.dump' -o -name '*_media_*.tar.gz' \) -print0) > "$MANIFEST"
else
  : > "$MANIFEST"
fi

echo "=== Negative guard: production backup directory must be refused ==="
if [ -d "$PRODUCTION_BACKUP_DIR" ]; then
  if SMOKE_BACKUP_DIR="$PRODUCTION_BACKUP_DIR" bash scripts/verify-compose.sh >/tmp/smoke-guard-backup.log 2>&1; then
    echo "FAIL: verify-compose.sh accepted the production backup directory." >&2
    STATUS=1
  else
    grep -q 'must not be the production ./backups directory' /tmp/smoke-guard-backup.log || {
      echo "FAIL: production backup guard did not fail with the expected reason." >&2
      STATUS=1
    }
  fi
else
  echo "Real ./backups does not exist; production backup guard executed only in CI/local setup where it exists."
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

printf 'simulated-production-backup-sentinel' > "$SIMULATED_SENTINEL"
chmod 600 "$SIMULATED_SENTINEL"
SIMULATED_HASH_BEFORE="$(hash_file "$SIMULATED_SENTINEL")"

cat > "$CONTROL_ENV" <<EOF
POSTGRES_DB=aoking_direct_smoke
POSTGRES_USER=aoking_smoke
POSTGRES_PASSWORD=control_smoke_password
MIGRATION_DATABASE_URL=postgres://aoking_smoke:control_smoke_password@db:5432/aoking_direct_smoke
RUNTIME_DB_USER=aoking_runtime_smoke
RUNTIME_DB_PASSWORD=control_runtime_password_123
DATABASE_URL=postgres://aoking_runtime_smoke:control_runtime_password_123@db:5432/aoking_direct_smoke
COOKIE_SECURE=false
CUSTOMER_SESSION_IDLE_HOURS=24
CUSTOMER_SESSION_ABSOLUTE_DAYS=30
INTERNAL_SESSION_IDLE_HOURS=2
INTERNAL_SESSION_ABSOLUTE_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_MINUTES=15
LOGIN_LOCK_MINUTES=15
TRUST_PROXY=0
VITE_REAL_AUTH=false
WEB_PORT=19999
BACKUP_HOST_DIR=/tmp/aoking-control-backups
BACKUP_RETENTION_DAYS=30
API_IMAGE=aoking-direct-api-smoke:control
MIGRATE_IMAGE=aoking-direct-migrate-smoke:control
WEB_IMAGE=aoking-direct-web-smoke:control
EOF
chmod 600 "$CONTROL_ENV"

echo "=== P0-03: polluted parent env control and isolated smoke ==="
set +e
(
  export DATABASE_URL='postgres://production_user:production_password@sentinel.invalid:5432/production_db'
  export POSTGRES_DB='production_db'
  export POSTGRES_USER='production_user'
  export POSTGRES_PASSWORD='production_password'
  export MIGRATION_DATABASE_URL='postgres://production_user:production_password@sentinel.invalid:5432/production_db'
  export RUNTIME_DB_USER='production_runtime'
  export RUNTIME_DB_PASSWORD='production_runtime_password_123'
  export BACKUP_HOST_DIR="$SIMULATED_BACKUP_DIR"
  export BACKUP_RETENTION_DAYS='9999'
  export API_IMAGE='production-api:latest'
  export MIGRATE_IMAGE='production-migrate:latest'
  export WEB_IMAGE='production-web:latest'
  export WEB_PORT='1'
  export DOMAIN='production.invalid'

  echo "--- control: unsanitized Compose config must show polluted values ---"
  if ! docker compose -p "$CONTROL_PROJECT" --env-file "$CONTROL_ENV" \
    -f docker-compose.yml config --format json > "$CONTROL_CONFIG" 2>/tmp/smoke-control.err; then
    echo "FAIL: unable to render the unsanitized control Compose config." >&2
    cat /tmp/smoke-control.err >&2 || true
    exit 1
  fi
  grep -Fq 'sentinel.invalid' "$CONTROL_CONFIG" || {
    echo "FAIL: control config did not demonstrate DATABASE_URL precedence." >&2
    exit 1
  }
  grep -Fq 'production_db' "$CONTROL_CONFIG" || {
    echo "FAIL: control config did not demonstrate POSTGRES_DB precedence." >&2
    exit 1
  }
  grep -Fq "$SIMULATED_BACKUP_DIR" "$CONTROL_CONFIG" || {
    echo "FAIL: control config did not demonstrate BACKUP_HOST_DIR precedence." >&2
    exit 1
  }
  grep -Fq 'production-api:latest' "$CONTROL_CONFIG" || {
    echo "FAIL: control config did not demonstrate API_IMAGE precedence." >&2
    exit 1
  }
  grep -Fq 'production-migrate:latest' "$CONTROL_CONFIG" || {
    echo "FAIL: control config did not demonstrate MIGRATE_IMAGE precedence." >&2
    exit 1
  }

  echo "--- isolated smoke with polluted parent env ---"
  bash scripts/verify-compose.sh
)
SMOKE_STATUS=$?
set -e
if [ "$SMOKE_STATUS" -ne 0 ]; then
  STATUS=1
fi

echo "=== Verifying simulated production backup and real backups are untouched ==="
[ -f "$SIMULATED_SENTINEL" ] || {
  echo "FAIL: simulated production backup sentinel was removed." >&2
  STATUS=1
}
if [ -f "$SIMULATED_SENTINEL" ] && [ "$(hash_file "$SIMULATED_SENTINEL")" != "$SIMULATED_HASH_BEFORE" ]; then
  echo "FAIL: simulated production backup sentinel was modified." >&2
  STATUS=1
fi
if find "$SIMULATED_BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' | grep -q .; then
  echo "FAIL: smoke wrote a backup into the simulated production backup directory." >&2
  STATUS=1
fi

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

while IFS= read -r line; do
  [ -z "$line" ] && continue
  expected="${line%%  *}"
  file="${line#*  }"
  if [ ! -f "$file" ] || [ "$(hash_file "$file")" != "$expected" ]; then
    echo "FAIL: existing production backup was changed or removed: $file" >&2
    STATUS=1
  fi
done < "$MANIFEST"

rm -f /tmp/smoke-guard-backup.log /tmp/smoke-guard-project.log /tmp/smoke-control.err

if [ "$STATUS" -ne 0 ]; then
  echo "Smoke isolation regression FAILED." >&2
  exit 1
fi

echo "Smoke isolation regression PASSED: polluted parent env did not redirect the smoke; production volume, simulated backup sentinel and real backups were untouched."
