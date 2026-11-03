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

if ! docker compose ps --status running --services | grep -qx backup; then
  echo "The backup service is not running. Start the stack with docker compose up -d --build." >&2
  exit 1
fi

docker compose exec -T backup /bin/sh /scripts/backup-container.sh
LATEST="$(ls -1t backups/*.dump 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST" ]; then
  echo "Backup command completed but no dump file was found." >&2
  exit 1
fi
echo "Latest backup: $LATEST"
