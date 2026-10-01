#!/usr/bin/env bash
# Updates the stack to the code in this checkout, in an order that keeps the site up if
# anything fails: back up, build, migrate, and only then replace the running app.
#
#   deploy/docker/update.sh            after `git pull`
#   deploy/docker/update.sh --pull     git pull first
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--pull" ]; then
  git -C ../.. pull --ff-only
fi

echo "== Backing up"
docker compose run --rm backup now

echo "== Building"
docker compose build

# On its own first: if a migration fails, the app still running is left alone.
# (`up` alone would remove it before finding out.)
echo "== Migrating"
docker compose run --rm migrate

echo "== Starting"
docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  if [ "$(docker compose ps app --format '{{.Health}}')" = "healthy" ]; then
    echo "== Done: app is healthy"
    exit 0
  fi
  sleep 2
done
echo "!! app is not healthy after 60 s: docker compose logs app" >&2
exit 1
