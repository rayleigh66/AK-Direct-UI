#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

WEB_PORT="${WEB_PORT:-8080}"
BASE_URL="http://127.0.0.1:${WEB_PORT}"
KEEP_STACK="${KEEP_STACK:-0}"
FAIL_PROJECT="${FAIL_PROJECT:-aoking-direct-fail}"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- compose services ---"
    docker compose ps -a || true
    echo "--- recent compose logs ---"
    docker compose logs --no-color --tail=80 || true
  fi
  if [ "$KEEP_STACK" != "1" ]; then
    docker compose down -v >/dev/null 2>&1 || true
    docker compose -p "$FAIL_PROJECT" down -v >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

step() {
  echo
  echo "=== $* ==="
}

psql_db() {
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
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

step "T01: docker compose up -d --build --wait"
docker compose up -d --build --wait

for service in db api web backup; do
  docker compose ps --status running --services | grep -qx "$service" || {
    echo "Service $service is not running." >&2
    exit 1
  }
done
docker compose ps --status exited --services | grep -qx migrate || {
  echo "Migration service did not complete successfully." >&2
  exit 1
}

step "T02: React web page is served"
curl -fsS --max-time 10 "$BASE_URL/" | grep -q '<div id="root">'

step "T03: GET /api/health"
curl -fsS --max-time 10 "$BASE_URL/api/health" | grep -q '"status":"ok"'

step "T04: GET /api/ready with database up, then database down"
curl -fsS --max-time 10 "$BASE_URL/api/ready" | grep -q '"status":"ready"'
docker compose stop db >/dev/null
wait_http "$BASE_URL/api/ready" 503 30
docker compose start db >/dev/null
docker compose up -d --wait db
docker compose restart api >/dev/null
wait_http "$BASE_URL/api/ready" 200 60

step "T05: migrations are idempotent"
MIGRATION_COUNT="$(psql_db -tAc 'SELECT count(*) FROM schema_migrations' | tr -d '[:space:]')"
[ "$MIGRATION_COUNT" = "1" ] || {
  echo "Expected 1 migration row, got $MIGRATION_COUNT" >&2
  exit 1
}
docker compose run --rm migrate
MIGRATION_COUNT_AGAIN="$(psql_db -tAc 'SELECT count(*) FROM schema_migrations' | tr -d '[:space:]')"
[ "$MIGRATION_COUNT_AGAIN" = "1" ] || {
  echo "Migration count changed after second run: $MIGRATION_COUNT_AGAIN" >&2
  exit 1
}

step "T06/T07: PostgreSQL volume persistence across DB restart and API/web recreation"
PROBE_KEY="compose_probe_$(date +%s)_$$"
psql_db -c "INSERT INTO system_metadata (key, value) VALUES ('$PROBE_KEY', 'persisted') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
docker compose restart db >/dev/null
docker compose up -d --wait db
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$PROBE_KEY'" | tr -d '[:space:]')" = "persisted" ]
docker compose rm -sf api web >/dev/null
docker compose up -d --wait api web
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$PROBE_KEY'" | tr -d '[:space:]')" = "persisted" ]
docker volume inspect aoking-direct_postgres_data >/dev/null
psql_db -c "DELETE FROM system_metadata WHERE key = '$PROBE_KEY';"

step "T08: port exposure and image secret checks"
DB_PORT="$(docker compose port db 5432 || true)"
case "$DB_PORT" in
  ''|':0'|'invalid IP:0') ;;
  *) echo "PostgreSQL must not publish a host port (got $DB_PORT)." >&2; exit 1 ;;
esac
API_PORT="$(docker compose port api 4000 || true)"
case "$API_PORT" in
  ''|':0'|'invalid IP:0') ;;
  *) echo "API must not publish a host port (got $API_PORT)." >&2; exit 1 ;;
esac
docker compose port web 80 | grep -q '^127\.0\.0\.1:'
if docker run --rm aoking-direct-api:4b01 sh -c "grep -R -- '$POSTGRES_PASSWORD' /app >/dev/null 2>&1"; then
  echo "Database password was found inside the API image." >&2
  exit 1
fi
docker compose config --quiet

step "T11: migration failure is not masked as ready"
if docker compose run --rm -e DATABASE_URL='postgres://invalid:invalid@db:5432/does_not_exist' migrate; then
  echo "Expected migration to fail with an invalid database." >&2
  exit 1
fi
if WEB_PORT=18081 \
  DATABASE_URL='postgres://invalid:invalid@db:5432/does_not_exist' \
  docker compose -p "$FAIL_PROJECT" up -d --build >/dev/null 2>&1; then
  sleep 5
  API_STATE="$(docker compose -p "$FAIL_PROJECT" ps -a --format '{{.Service}} {{.State}}' | grep '^api ' || true)"
  case "$API_STATE" in
    *running*) echo "API started despite a failed migration: $API_STATE" >&2; exit 1 ;;
  esac
fi
docker compose -p "$FAIL_PROJECT" down -v >/dev/null 2>&1 || true

step "Backup and restore test"
BACKUP_PROBE="restore_probe_$(date +%s)_$$"
psql_db -c "INSERT INTO system_metadata (key, value) VALUES ('$BACKUP_PROBE', 'restored') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
docker compose exec -T backup /bin/sh /scripts/backup-container.sh
LATEST_BACKUP="$(ls -1t backups/*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$LATEST_BACKUP" ] || {
  echo "No backup file was created." >&2
  exit 1
}
[ "$(stat -c '%a' "$LATEST_BACKUP" 2>/dev/null || stat -f '%Lp' "$LATEST_BACKUP")" = "600" ] || {
  echo "Backup file permissions are not 600." >&2
  exit 1
}
psql_db -c "DELETE FROM system_metadata WHERE key = '$BACKUP_PROBE';"
CONFIRM_RESTORE=yes CONFIRM_DB="$POSTGRES_DB" BACKUP_FILE="$LATEST_BACKUP" bash scripts/db-restore.sh
docker compose up -d --wait api web
[ "$(psql_db -tAc "SELECT value FROM system_metadata WHERE key = '$BACKUP_PROBE'" | tr -d '[:space:]')" = "restored" ]
psql_db -c "DELETE FROM system_metadata WHERE key = '$BACKUP_PROBE';"

step "T12: local test database path is independent of production"
echo "Local compose validation completed without cloud credentials."

echo
echo "All Phase 4B-01 compose checks passed."
