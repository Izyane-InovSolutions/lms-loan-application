#!/bin/sh
# Runs in the `backup` service. Once a day after BACKUP_HOUR (local time, TZ): a dump of
# the database and an archive of the stored documents into /backups, deleting backups
# older than BACKUP_KEEP_DAYS. Files are written under a temporary name and renamed, so a
# backup in the folder is always complete.
#
#   docker compose run --rm backup now     one backup straight away (e.g. before an upgrade)
set -eu

HOUR=${BACKUP_HOUR:-1}
KEEP=${BACKUP_KEEP_DAYS:-14}

backup() {
  stamp=$(date +%Y-%m-%d_%H%M)
  pg_dump --format=custom --file="/backups/los-db-$stamp.dump.partial"
  mv "/backups/los-db-$stamp.dump.partial" "/backups/los-db-$stamp.dump"
  tar -czf "/backups/los-documents-$stamp.tar.gz.partial" -C /data blob
  mv "/backups/los-documents-$stamp.tar.gz.partial" "/backups/los-documents-$stamp.tar.gz"
  find /backups -maxdepth 1 -name 'los-*' -mtime "+$KEEP" -delete
  echo "[backup] los-db-$stamp.dump and los-documents-$stamp.tar.gz written"
}

if [ "${1:-}" = "now" ]; then
  backup
  exit 0
fi

echo "[backup] daily after ${HOUR}:00 ($(date +%Z)), keeping ${KEEP} days"
# A restart does not back up again a day that already has one.
last=""
if ls "/backups/los-db-$(date +%F)_"*.dump >/dev/null 2>&1; then last=$(date +%F); fi
while true; do
  today=$(date +%F)
  hour=$(date +%H | sed 's/^0//')
  if [ "${hour:-0}" -ge "$HOUR" ] && [ "$today" != "$last" ]; then
    if backup; then last=$today; else echo "[backup] failed; trying again in 10 minutes" >&2; fi
  fi
  sleep 600
done
