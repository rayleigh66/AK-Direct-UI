#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# This script is destructive by design (DB stop/restart, probe rows, restore).
# It must never use the production project, volume, credentials or backup dir.
RUN_ID="${SMOKE_RUN_ID:-$(date -u +%Y%m%d%H%M%S)-$$}"
SMOKE_PROJECT="${SMOKE_PROJECT:-aoking-direct-smoke-${RUN_ID}}"
FAIL_PROJECT="${FAIL_PROJECT:-aoking-direct-smoke-fail-${RUN_ID}}"

case "$SMOKE_PROJECT" in
  aoking-direct-smoke-*) ;;
  *) echo "Refusing to run: SMOKE_PROJECT must start with aoking-direct-smoke-." >&2; exit 1 ;;
esac
[ "$SMOKE_PROJECT" != "aoking-direct" ] || {
  echo "Refusing to run destructive smoke against the production project." >&2
  exit 1
}
case "$FAIL_PROJECT" in
  aoking-direct-smoke-fail-*) ;;
  *) echo "Refusing to run: FAIL_PROJECT must start with aoking-direct-smoke-fail-." >&2; exit 1 ;;
esac

REAL_BACKUP_DIR="$(cd "$ROOT_DIR" && pwd)/backups"
if [ -n "${SMOKE_BACKUP_DIR:-}" ]; then
  SMOKE_BACKUP_DIR="$(cd "$SMOKE_BACKUP_DIR" && pwd)"
  BACKUP_DIR_CREATED=0
else
  SMOKE_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aoking-direct-smoke-backups.XXXXXX")"
  BACKUP_DIR_CREATED=1
fi
case "$SMOKE_BACKUP_DIR" in
  "$REAL_BACKUP_DIR"|"$REAL_BACKUP_DIR"/*)
    echo "Refusing to run: SMOKE_BACKUP_DIR must not be the production ./backups directory." >&2
    exit 1
    ;;
esac

SMOKE_DB_NAME="aoking_direct_smoke"
SMOKE_DB_USER="aoking_smoke"
SMOKE_DB_PASSWORD="${SMOKE_DB_PASSWORD:-}"
if [ -z "$SMOKE_DB_PASSWORD" ]; then
  if command -v openssl >/dev/null 2>&1; then
    SMOKE_DB_PASSWORD="$(openssl rand -hex 16)"
  elif command -v python3 >/dev/null 2>&1; then
    SMOKE_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  else
    SMOKE_DB_PASSWORD="smoke-$(date +%s)-$$"
  fi
fi

free_port() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
  else
    echo 18080
  fi
}

SMOKE_WEB_PORT="${SMOKE_WEB_PORT:-$(free_port)}"
FAIL_WEB_PORT="${FAIL_WEB_PORT:-$(free_port)}"
SMOKE_API_IMAGE="aoking-direct-api-smoke:${RUN_ID}"
SMOKE_WEB_IMAGE="aoking-direct-web-smoke:${RUN_ID}"
SMOKE_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/aoking-direct-smoke-env.XXXXXX")"
chmod 600 "$SMOKE_ENV_FILE"

cat > "$SMOKE_ENV_FILE" <<EOF
POSTGRES_DB=${SMOKE_DB_NAME}
POSTGRES_USER=${SMOKE_DB_USER}
POSTGRES_PASSWORD=${SMOKE_DB_PASSWORD}
DATABASE_URL=postgres://${SMOKE_DB_USER}:${SMOKE_DB_PASSWORD}@db:5432/${SMOKE_DB_NAME}
WEB_PORT=${SMOKE_WEB_PORT}
BACKUP_HOST_DIR=${SMOKE_BACKUP_DIR}
BACKUP_RETENTION_DAYS=30
DOMAIN=
API_IMAGE=${SMOKE_API_IMAGE}
WEB_IMAGE=${SMOKE_WEB_IMAGE}
EOF

compose() {
  docker compose -p "$SMOKE_PROJECT" --env-file "$SMOKE_ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" "$@"
}
compose_fail() {
  docker compose -p "$FAIL_PROJECT" --env-file "$SMOKE_ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" "$@"
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- smoke project services ---" >&2
    compose ps -a >&2 || true
    echo "--- recent smoke logs ---" >&2
    compose logs --no-color --tail=80 >&2 || true
  fi
  if [ "${KEEP_STACK:-0}" = "1" ]; then
    echo "KEEP_STACK=1: project=$SMOKE_PROJECT env=$SMOKE_ENV_FILE backups=$SMOKE_BACKUP_DIR" >&2
  else
    compose down -v >/dev/null 2>&1 || true
    compose_fail down -v >/dev/null 2>&1 || true
    docker image rm "$SMOKE_API_IMAGE" "$SMOKE_WEB_IMAGE" >/dev/null 2>&1 || true
    if [ "$BACKUP_DIR_CREATED" = "1" ]; then
      rm -rf "$SMOKE_BACKUP_DIR"
    fi
    rm -f "$SMOKE_ENV_FILE"
  fi
  exit "$status"
}
trap cleanup EXIT

# Fail closed if Compose resolved anything other than the unique smoke project.
if ! CONFIG_JSON="$(compose config --format json)"; then
  echo "Refusing to run: Compose configuration could not be resolved." >&2
  exit 1
fi
CONFIG_NAME="$(printf '%s' "$CONFIG_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
[ "$CONFIG_NAME" = "$SMOKE_PROJECT" ] || {
  echo "Refusing to run: Compose resolved project '$CONFIG_NAME', expected '$SMOKE_PROJECT'." >&2
  exit 1
}

BASE_URL="http://127.0.0.1:${SMOKE_WEB_PORT}"

step() {
  echo
  echo "=== $* ==="
}

psql_db() {
  compose exec -T db psql -U "$SMOKE_DB_USER" -d "$SMOKE_DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

wait_http() {
  local url="$1"
  local expected="$2"
  local attempts="${3:-60}"
  local code=""
  local i=0
  while [ "$i" -lt "$attempts" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
    if [ "$code" = "$expected" ]; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "Expected HTTP $expected from $url, got $code" >&2
  return 1
}

step "T01: isolated smoke project up -d --build --wait ($SMOKE_PROJECT)"
compose up -d --build --wait

for service in db api web backup; do
  compose ps --status running --services | grep -qx "$service" || {
    echo "Service $service is not running." >&2
    exit 1
  }
done
compose ps --status exited --services | grep -qx migrate || {
  echo "Migration service did not complete successfully." >&2
  exit 1
}

step "T02: React web page is served"
curl -fsS --max-time 10 "$BASE_URL/" | grep -q '<div id="root">'

step "T03: GET /api/health"
curl -fsS --max-time 10 "$BASE_URL/api/health" | grep -q '"status":"ok"'

step "T04: GET /api/ready with database up, then database down"
curl -fsS --max-time 10 "$BASE_URL/api/ready" | grep -q '"status":"ready"'
compose stop db >/dev/null
wait_http "$BASE_URL/api/ready" 503 30
compose start db >/dev/null
compose up -d --wait db
compose restart api >/dev/null
wait_http "$BASE_URL/api/ready" 200 60

step "T05: migrations are idempotent"
MIGRATION_COUNT="$(psql_db -tAc 'SELECT count(*) FROM schema_migrations' | tr -d '[:space:]')"
[ "$MIGRATION_COUNT" = "1" ] || {
  echo "Expected 1 migration row, got $MIGRATION_COUNT" >&2
  exit 1
}
compose run --rm migrate
MIGRATION_COUNT_AGAIN="$(psql_db -tAc 'SELECT count(*) FROM schema_migrations' | tr -d '[:space:]')"
[ "$MIGRATION_COUNT_AGAIN" = "1" ] || {
  echo "Migration count changed after second run: $MIGRATION_COUNT_AGAIN" >&2
  exit 1
}

step "T06/T07: isolated PostgreSQL volume persistence"
PROBE_KEY="smoke_probe_$(date +%s)_$$"
psql_db -c "INSERT INTO system_metadata (key, value) VALUES ('$PROBE_KEY', 'persisted') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
compose restart db >/dev/null
compose up -d --wait db
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$PROBE_KEY'" | tr -d '[:space:]')" = "persisted" ]
compose rm -sf api web >/dev/null
compose up -d --wait api web
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$PROBE_KEY'" | tr -d '[:space:]')" = "persisted" ]
docker volume inspect "${SMOKE_PROJECT}_postgres_data" >/dev/null
psql_db -c "DELETE FROM system_metadata WHERE key = '$PROBE_KEY';"

step "T08: port exposure and image secret checks"
DB_PORT="$(compose port db 5432 || true)"
case "$DB_PORT" in
  ''|':0'|'invalid IP:0') ;;
  *) echo "PostgreSQL must not publish a host port (got $DB_PORT)." >&2; exit 1 ;;
esac
API_PORT="$(compose port api 4000 || true)"
case "$API_PORT" in
  ''|':0'|'invalid IP:0') ;;
  *) echo "API must not publish a host port (got $API_PORT)." >&2; exit 1 ;;
esac
compose port web 80 | grep -q "^127\\.0\\.0\\.1:${SMOKE_WEB_PORT}$"
if docker run --rm "$SMOKE_API_IMAGE" sh -c "grep -R -- '$SMOKE_DB_PASSWORD' /app >/dev/null 2>&1"; then
  echo "Database password was found inside the smoke API image." >&2
  exit 1
fi
compose config --quiet

step "T11: migration failure is not masked as ready"
if compose run --rm -e DATABASE_URL='postgres://invalid:invalid@db:5432/does_not_exist' migrate; then
  echo "Expected migration to fail with an invalid database." >&2
  exit 1
fi
if WEB_PORT="$FAIL_WEB_PORT" DATABASE_URL='postgres://invalid:invalid@db:5432/does_not_exist' \
  compose_fail up -d --build >/dev/null 2>&1; then
  sleep 5
  API_STATE="$(compose_fail ps -a --format '{{.Service}} {{.State}}' | grep '^api ' || true)"
  case "$API_STATE" in
    *running*) echo "API started despite a failed migration: $API_STATE" >&2; exit 1 ;;
  esac
fi
compose_fail down -v >/dev/null 2>&1 || true

step "Backup and restore test (isolated backup directory)"
BACKUP_PROBE="restore_probe_$(date +%s)_$$"
psql_db -c "INSERT INTO system_metadata (key, value) VALUES ('$BACKUP_PROBE', 'restored') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
compose exec -T backup /bin/sh /scripts/backup-container.sh
LATEST_BACKUP="$(ls -1t "$SMOKE_BACKUP_DIR"/*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$LATEST_BACKUP" ] || {
  echo "No backup file was created in the isolated backup directory." >&2
  exit 1
}
[ "$(stat -c '%a' "$LATEST_BACKUP" 2>/dev/null || stat -f '%Lp' "$LATEST_BACKUP")" = "600" ] || {
  echo "Backup file permissions are not 600." >&2
  exit 1
}
psql_db -c "DELETE FROM system_metadata WHERE key = '$BACKUP_PROBE';"
compose stop api web >/dev/null 2>&1 || true
if ! compose run --rm --no-deps \
  -v "$SMOKE_BACKUP_DIR:/restore:ro" \
  -e PGPASSWORD="$SMOKE_DB_PASSWORD" \
  --entrypoint pg_restore db \
  -h db \
  -U "$SMOKE_DB_USER" \
  -d "$SMOKE_DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error "/restore/$(basename "$LATEST_BACKUP")"; then
  echo "Restore failed inside the isolated smoke project." >&2
  exit 1
fi
compose up -d --wait api web
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$BACKUP_PROBE'" | tr -d '[:space:]')" = "restored" ]
psql_db -c "DELETE FROM system_metadata WHERE key = '$BACKUP_PROBE';"

step "T12: isolated local smoke completed without cloud/production credentials"
echo "Smoke project: $SMOKE_PROJECT"
echo "Isolated backup directory: $SMOKE_BACKUP_DIR"

echo
echo "All Phase 4B-01 isolated compose checks passed."
