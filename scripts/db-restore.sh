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

: "${BACKUP_FILE:?Set BACKUP_FILE to a .dump file}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore without CONFIRM_RESTORE=yes." >&2
  exit 1
fi
if [ "${CONFIRM_DB:-}" != "$POSTGRES_DB" ]; then
  echo "Refusing to restore: CONFIRM_DB must match POSTGRES_DB ($POSTGRES_DB)." >&2
  exit 1
fi

restore_stack() {
  docker compose up -d api web >/dev/null 2>&1 || true
}

echo "Stopping API and web during restore..."
docker compose stop api web >/dev/null 2>&1 || true
if ! docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error < "$BACKUP_FILE"; then
  echo "Restore failed. API and web remain stopped; inspect the database before restarting." >&2
  exit 1
fi

restore_stack
echo "Restore completed from $BACKUP_FILE."
