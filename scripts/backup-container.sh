#!/usr/bin/env sh
set -u

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
case "$RETENTION_DAYS" in
  ''|*[!0-9]*)
    echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
    exit 1
    ;;
esac

mkdir -p /backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/backups/${PGDATABASE}_${STAMP}_$$.dump"

if pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$FILE"; then
  chmod 600 "$FILE"
  echo "Backup written: $FILE"
else
  echo "Backup failed for database $PGDATABASE." >&2
  rm -f "$FILE"
  exit 1
fi

# Retention applies only to this backup directory; no offsite copy is claimed.
find /backups -type f -name '*.dump' -mtime +"$RETENTION_DAYS" -delete
