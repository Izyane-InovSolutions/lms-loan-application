#!/usr/bin/env bash
# Pull, rebuild, migrate and restart. Run as root (or via sudo) on the server:
#   sudo /opt/los/app/deploy/update.sh
set -euo pipefail
APP=/opt/los/app
cd "$APP"
sudo -u los git pull --ff-only
sudo -u los npm ci
sudo -u los npm run build
set -a; . /etc/los.env; set +a
sudo -u los --preserve-env=DATABASE_URL npm run db:migrate
systemctl restart los
sleep 2
curl -fsS http://127.0.0.1:3001/healthz && echo
