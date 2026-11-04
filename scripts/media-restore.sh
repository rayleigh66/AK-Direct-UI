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

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Media backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore media without CONFIRM_RESTORE=yes." >&2
  exit 1
fi

BACKUP_DIR="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
BACKUP_NAME="$(basename "$BACKUP_FILE")"

echo "Stopping API during media restore..."
docker compose stop api >/dev/null 2>&1 || true

# The API container already mounts the media volume at /app/media. Extract the
# archive there inside a one-shot container; the backup directory is read-only.
if ! docker compose run --rm --no-deps \
  -v "$BACKUP_DIR:/restore:ro" \
  --entrypoint sh api \
  -c 'rm -rf /app/media/* /app/media/.[!.]* /app/media/..?* 2>/dev/null; tar -xzf "/restore/'"$BACKUP_NAME"'" -C /app/media; chown -R node:node /app/media'; then
  echo "Media restore failed. The API remains stopped; inspect /app/media before restarting." >&2
  exit 1
fi

docker compose up -d api >/dev/null 2>&1 || true
echo "Media restore completed from $BACKUP_FILE."
