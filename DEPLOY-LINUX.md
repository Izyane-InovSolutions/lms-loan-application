# Deploying to a Linux server

This guide puts the whole app on one Ubuntu 22.04/24.04 server: nginx serves the built
site and proxies `/api` to a small Node process (`server.js`), backed by local Postgres.
For Vercel, see [Deploying to Vercel](README.md#deploying-to-vercel).

| Piece | On Vercel | On this server |
| --- | --- | --- |
| Frontend | CDN | `npm run build`, served by nginx from `dist/` |
| `/api/*` | Serverless functions | `server.js`, run by systemd |
| Postgres | Neon | Local Postgres via `DATABASE_URL` |
| Redis (drafts, email codes, rate limits) | Upstash | Built-in JSON file (`LOS_LOCAL_KV_FILE`) |
| Documents | Vercel Blob | Files on disk (`LOS_LOCAL_BLOB_DIR`) |
| Daily job | `vercel.json` cron | `/etc/cron.d/los` |

Everything for the server lives in [`deploy/`](deploy).

## Before you start

- A server with a sudo user, and a public HTTPS address for it. HTTPS is required: with
  `NODE_ENV=production` session cookies are `Secure`, so sign-in fails over plain HTTP.
  No domain? See [No domain: getting a public address](#no-domain-getting-a-public-address).
- SMTP credentials for the email codes and invitations.

## No domain: getting a public address

Testers at home need a public HTTPS address. You don't have to buy a domain. Pick the
option that matches where the server is.

| Where the server is | Use | Address you get |
| --- | --- | --- |
| Cloud VM or VPS with a public IP (DigitalOcean, AWS, Hetzner…) | **DuckDNS** (free subdomain) | `https://yourname.duckdns.org` |
| A machine in your office or home, behind a router | **Tailscale Funnel** (free) | `https://yourmachine.your-tailnet.ts.net` |
| Either, for a quick one-off demo | **Cloudflare quick tunnel** | `https://random-words.trycloudflare.com` (changes on every restart) |

Whichever you choose, that hostname is your `DOMAIN`: use it for `YOUR.DOMAIN` in the
steps, for `DOMAIN=` when running `setup.sh`, and in `APP_URL` in `/etc/los.env`.

### Option A: cloud server + DuckDNS

This is the most reliable way for outside testers. Every step in this guide works
unchanged, including certbot.

1. Sign in at <https://www.duckdns.org> (with Google or GitHub). Create a subdomain, for
   example `loan-origination`, and set its IP to the server's public IP. Keep the token shown
   on the page.
2. Keep the IP up to date (optional on a VPS, where it rarely changes):
   ```bash
   echo '*/5 * * * * root curl -fsS "https://www.duckdns.org/update?domains=loan-origination&token=YOUR_TOKEN" >/dev/null' | sudo tee /etc/cron.d/duckdns
   ```
3. Check it resolves: `dig +short loan-origination.duckdns.org` should print the server IP.
4. Allow ports 80 and 443 in the cloud provider's firewall or security group as well as
   `ufw`. Let's Encrypt must be able to reach port 80.
5. Run the [Quick path](#quick-path) with `DOMAIN=loan-origination.duckdns.org`, then
   `sudo certbot --nginx -d loan-origination.duckdns.org`.

### Option B: office or home machine + Tailscale Funnel

Nothing is opened on your router, and HTTPS is provided for you, so skip certbot and
step 11.

1. Create a free account at <https://tailscale.com>, then on the server:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up                      # open the printed link to sign in
   tailscale status --json | grep -m1 DNSName     # e.g. "yourmachine.tail1234.ts.net."
   ```
2. Run the [Quick path](#quick-path) with that name, without the trailing dot, as
   `DOMAIN`.
3. Publish nginx (port 80) to the internet over HTTPS:
   ```bash
   sudo tailscale funnel --bg 80
   ```
   If it prints a link to enable Funnel for your tailnet, open it and approve, then run
   the command again. `tailscale funnel status` shows the public URL.
4. Testers open `https://yourmachine.tail1234.ts.net`. The URL stays the same across
   reboots. The machine must stay on and connected.

### Option C: Cloudflare quick tunnel (short demos only)

No account is needed, but the URL changes every time the tunnel restarts. Each time,
you must update `APP_URL` in `/etc/los.env` and restart `los`, or emailed links break.

```bash
curl -fsSL -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://localhost:80   # prints https://….trycloudflare.com
```

Keep that terminal open while people test. For anything longer than a demo, use A or B.

### For a test server

- **Email must work.** Testers sign in with codes sent by email, so set the `EMAIL_*`
  values (a Gmail account with an [app password](https://myaccount.google.com/apppasswords)
  is enough). Codes printed to the server log don't help someone at home.
- **Sample roles (optional).** On a server that will never hold real customer data, you
  can set `LOS_DEMO_ENABLED=true` in `/etc/los.env` so testers can try each staff role
  from the sign-in page. Remove it before any real data goes in: it lets anyone sign in
  as any role.
- **Tell testers:** the wizard only accepts emails ending in `.com`, and uploads are
  capped at 4 MB.

## Quick path

On the server, as a sudo user:

```bash
git clone <your-repo-url> /tmp/los && cd /tmp/los
sudo REPO_URL=<your-repo-url> DOMAIN=loans.example.com bash deploy/setup.sh
```

For a private repository, use a URL with a token or a deploy key (see manual step 4).
`deploy/setup.sh` can be re-run to repair an install once `/etc/los.env` exists. It installs Node 22, nginx and Postgres, creates the
`los` user and database, generates `/etc/los.env` with fresh secrets, clones to
`/opt/los/app`, builds, migrates, and installs the service, nginx site, cron job and
firewall rules. Then it prints the remaining steps:

1. Edit `/etc/los.env` (at least `EMAIL_*`), then `sudo systemctl restart los`.
2. Point DNS at the server, then `sudo certbot --nginx -d loans.example.com`.
3. Create the first admin (prompts for a 12+ character password):
   ```bash
   cd /opt/los/app && set -a && . /etc/los.env && set +a
   sudo -u los --preserve-env=DATABASE_URL npm run create-admin -- you@example.com "Your Name"
   ```

Set any `VITE_*` variables in `/opt/los/app/.env.production` and rebuild
(`sudo /opt/los/app/deploy/update.sh`); they are baked in at build time.

## The database URL

Postgres runs on the same server, so the URL is:

```
DATABASE_URL=postgres://los:<PASSWORD>@127.0.0.1:5432/los_db
```

- `los` is the database user, `los_db` the database, `5432` the default port.
- `setup.sh` generates the password and writes the finished URL into `/etc/los.env`. To
  read it: `sudo grep DATABASE_URL /etc/los.env`.
- Doing it by hand, you choose the password in step 3 below. Use letters and digits only
  (`openssl rand -hex 16`). Characters such as `@ : / # ?` must be percent-encoded in a
  URL, and a bad one shows up as a connection error.
- No SSL setting is needed for a local connection. If you use a managed Postgres on another
  host instead, use its connection string and append `?sslmode=require`.
- Test it: `psql "$DATABASE_URL" -c 'select 1'` (after `set -a; . /etc/los.env; set +a`).

## Manual steps (what `setup.sh` automates)

Use these if you don't want the script, or to understand or repair what it did. Run as a
sudo user.

**1. Install packages.**

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx postgresql git ufw certbot python3-certbot-nginx curl openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v        # must be 20.19+ or 22.12+
```

**2. Create the service user and state directories.**

```bash
sudo useradd --system --create-home --home-dir /opt/los --shell /usr/sbin/nologin los
sudo chmod o+rx /opt/los
sudo mkdir -p /var/lib/los/blob && sudo chown -R los:los /var/lib/los
```

**3. Create the database.**

```bash
DB_PASSWORD=$(openssl rand -hex 16); echo "$DB_PASSWORD"     # keep this
sudo -u postgres psql -c "CREATE USER los WITH PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -c "CREATE DATABASE los_db OWNER los"
```

**4. Get the code.** For a private repository, `git clone` needs credentials. Either use an
HTTPS URL with a personal access token
(`https://<token>@github.com/<org>/<repo>.git`), or create a read-only deploy key:
`sudo -u los ssh-keygen -t ed25519 -f /opt/los/.ssh/id_ed25519 -N ""`, add the `.pub` file
under the repository's Settings, then Deploy keys, and clone over SSH.

```bash
sudo -u los git clone <your-repo-url> /opt/los/app
cd /opt/los/app && sudo -u los git checkout main      # or the branch you deploy
```

**5. Write the environment file.**

```bash
sudo cp /opt/los/app/deploy/los.env.example /etc/los.env
sudo chown root:root /etc/los.env && sudo chmod 600 /etc/los.env
sudo nano /etc/los.env
```

Fill in `APP_URL`, `DATABASE_URL` (previous section), `LOS_SECRETS_KEY`
(`openssl rand -base64 32`), `CRON_SECRET` (`openssl rand -hex 32`) and the `EMAIL_*`
settings. Values go on one line with no quotes needed. The optional settings (AI, credit
bureau, virus scanning, geocoder) are explained in `.env.example` and the
[README](README.md).

**6. Set build-time variables.** Anything starting with `VITE_` is baked into the site at
build time. Put them in `/opt/los/app/.env.production`, for example:

```
VITE_CRB_ENABLED=false
VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

**7. Install, build and migrate.**

```bash
cd /opt/los/app
sudo -u los npm ci
sudo -u los npm run build
set -a; . /etc/los.env; set +a
sudo -u los --preserve-env=DATABASE_URL npm run db:migrate     # prints "Migrations applied."
```

**8. Install and start the service.**

```bash
sudo cp deploy/los.service /etc/systemd/system/los.service
sudo systemctl daemon-reload && sudo systemctl enable --now los
systemctl status los --no-pager
curl -s http://127.0.0.1:3001/healthz                          # {"ok":true}
```

**9. Configure nginx.**

```bash
sudo sed "s#loans.example.com#YOUR.DOMAIN#" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/los
sudo ln -sf /etc/nginx/sites-available/los /etc/nginx/sites-enabled/los
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**10. Firewall.**

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Postgres (5432) and the API (3001) stay closed to the internet.

**11. DNS and HTTPS.** Create an A record for your domain pointing at the server's public IP,
wait for it to resolve (`dig +short YOUR.DOMAIN`), then:

```bash
sudo certbot --nginx -d YOUR.DOMAIN
sudo certbot renew --dry-run          # renewal is scheduled automatically; this checks it
```

**12. Install the daily job.**

```bash
sudo cp deploy/los-cron /etc/cron.d/los && sudo chmod 644 /etc/cron.d/los
```

**13. Create the first administrator.** It prompts for a password of 12+ characters.

```bash
cd /opt/los/app && set -a && . /etc/los.env && set +a
sudo -u los --preserve-env=DATABASE_URL npm run create-admin -- you@example.com "Your Name"
```

**14. Sign in and configure.** Open `https://YOUR.DOMAIN/admin/login` and follow
[Verify](#verify) below. In the workspace, then set up Settings: the terms and privacy
notice, loan products, credit rules, 2FA for staff, and the LMS connection once the LMS
team gives you credentials.

## Verify

```bash
curl -s https://loans.example.com/healthz          # {"ok":true} once Postgres answers
journalctl -u los -f                                # live logs
```

Then in a browser:

1. Sign in at `/admin/login`. The "try a role" demo sign-in must not appear.
2. Open **Admin → System health**. All checks should be green.
3. Submit a test application: the email code arrives, a document uploads, and you can open
   it from the case page.
4. Follow [README step 6](README.md#deploying-to-vercel): publish terms and privacy, set
   products, replace the placeholder credit thresholds, turn on 2FA for staff.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `curl /healthz` gives 503 | `journalctl -u los -n 50`. Usually a wrong `DATABASE_URL`, Postgres not running (`systemctl status postgresql`), or migrations not applied. |
| `password authentication failed` | The password in `DATABASE_URL` differs from the one set in `CREATE USER`, or it has unencoded special characters. Reset: `sudo -u postgres psql -c "ALTER USER los PASSWORD 'new'"` and update `/etc/los.env`. |
| Site loads but sign-in loops or fails | You are on plain HTTP. Secure cookies need HTTPS (step 11). |
| 502 Bad Gateway from nginx | The service is down: `systemctl status los`. |
| No emails arrive | Check `EMAIL_*` in `/etc/los.env`, then `journalctl -u los`. Gmail needs an app password. |
| Upload fails with 413 | nginx `client_max_body_size` too small, or the file is over 4 MB. |
| Edits to `/etc/los.env` have no effect | `sudo systemctl restart los`. |
| Every form fails with "Cross-origin requests are not allowed" | The tunnel is changing the `Host` header. In `/etc/nginx/sites-available/los`, replace `proxy_set_header Host $host;` with `proxy_set_header Host YOUR.DOMAIN;` and reload nginx. |
| certbot fails (DuckDNS) | Port 80 blocked by the cloud firewall, or DNS not updated yet (`dig +short`). |
| `.local-pg/` appears in `/opt/los/app` | `DATABASE_URL` is not reaching the service. Check the `EnvironmentFile` line and the file's contents. |

## Updating

```bash
sudo /opt/los/app/deploy/update.sh
```

It pulls, installs, builds, applies new migrations, restarts the service and checks
`/healthz`.

## Backups

Back up all three; the database alone is not enough.

```bash
sudo -u postgres pg_dump los_db | gzip > /backups/los_db_$(date +%F).sql.gz
sudo tar czf /backups/los_files_$(date +%F).tgz /var/lib/los /etc/los.env
```

Losing `LOS_SECRETS_KEY` means re-entering the LMS, SMS and AI credentials in Settings.

## Things to know

- **A missing `DATABASE_URL` does not fail loudly here.** The "not configured" errors
  only fire when the `VERCEL` variable is set. Without `DATABASE_URL` the app quietly
  uses a local PGlite database in `.local-pg/`. If that directory appears in
  `/opt/los/app`, the variable is not being read.
- **`LOS_DEV_LOG_CODES` must be `false`** (the example file does this). It is only ignored
  on Vercel, so elsewhere it would print sign-in codes to the logs.
- **Run one instance.** The JSON-file Redis stand-in is not safe across processes or
  servers. Scaling out means a Redis that speaks the Upstash REST API and shared object
  storage, which needs changes in `api/_lib/kv.js` and `api/_lib/blob.js`.
- **Files of expired drafts stay on disk.** The orphan sweep in the daily job only runs
  with a Vercel Blob token.
- **Never serve `/local-blob/`.** It holds NRCs and bank statements; the nginx config
  returns 404 for it. Documents are opened through the signed-in routes.
- **New API route?** Add it to the table in both `server.js` and `vite.config.js`.
- **Uploads:** limited to 4 MB per file; nginx allows 6 MB.
