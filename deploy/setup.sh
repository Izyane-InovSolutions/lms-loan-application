#!/usr/bin/env bash
# One-time server setup for Ubuntu 22.04/24.04. Run as root from a clone of the repo:
#   sudo REPO_URL=<git url> DOMAIN=loans.example.com bash deploy/setup.sh
# It installs packages, creates the database and service user, builds the app and installs
# the service, nginx site and cron job. It stops before HTTPS and the first admin (see
# DEPLOY-LINUX.md, steps 5 and 6) because those need DNS and a password from you.
set -euo pipefail
: "${REPO_URL:?set REPO_URL}" "${DOMAIN:?set DOMAIN}"
APP=/opt/los/app

apt-get update
apt-get install -y nginx postgresql git ufw certbot python3-certbot-nginx curl openssl
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id los >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/los --shell /usr/sbin/nologin los
mkdir -p /var/lib/los/blob && chown -R los:los /var/lib/los

if [ ! -f /etc/los.env ]; then
  DB_PASSWORD=$(openssl rand -hex 16)
  sudo -u postgres psql -c "CREATE USER los WITH PASSWORD '$DB_PASSWORD'" 
  sudo -u postgres psql -c "CREATE DATABASE los_db OWNER los"
  [ -d "$APP" ] || sudo -u los git clone "$REPO_URL" "$APP"
  sed -e "s#loans.example.com#$DOMAIN#" \
      -e "s#CHANGE_ME#$DB_PASSWORD#" \
      -e "s#^LOS_SECRETS_KEY=.*#LOS_SECRETS_KEY=$(openssl rand -base64 32)#" \
      -e "s#^CRON_SECRET=.*#CRON_SECRET=$(openssl rand -hex 32)#" \
      "$APP/deploy/los.env.example" > /etc/los.env
  chmod 600 /etc/los.env
  echo "Wrote /etc/los.env - edit the EMAIL_* settings before going live."
fi
[ -d "$APP" ] || sudo -u los git clone "$REPO_URL" "$APP"
chmod o+rx /opt/los

cd "$APP"
sudo -u los npm ci
sudo -u los npm run build
set -a; . /etc/los.env; set +a
sudo -u los --preserve-env=DATABASE_URL npm run db:migrate

cp deploy/los.service /etc/systemd/system/los.service
sed "s#loans.example.com#$DOMAIN#" deploy/nginx.conf > /etc/nginx/sites-available/los
ln -sf /etc/nginx/sites-available/los /etc/nginx/sites-enabled/los
rm -f /etc/nginx/sites-enabled/default
cp deploy/los-cron /etc/cron.d/los && chmod 644 /etc/cron.d/los

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl daemon-reload
systemctl enable --now los
nginx -t && systemctl reload nginx
sleep 2
curl -fsS http://127.0.0.1:3001/healthz && echo
cat <<MSG

Done. Next:
  1. Edit /etc/los.env (EMAIL_*), then: systemctl restart los
  2. Point DNS for $DOMAIN at this server, then: certbot --nginx -d $DOMAIN
  3. Create the first admin: cd $APP && set -a && . /etc/los.env && set +a && sudo -u los --preserve-env=DATABASE_URL npm run create-admin -- you@$DOMAIN "Your Name"
MSG
