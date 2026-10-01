# Deploying with Docker

The recommended way to run the workspace on your own servers. One `docker compose`
stack holds everything, and every piece of data lives in a Docker volume, so containers
can be rebuilt, replaced and updated without touching it.

| Service | What it does | Data |
| --- | --- | --- |
| `app` | The site and its API (`server.js`), plus the daily maintenance | — |
| `migrate` | Brings the database schema up to date, then exits. Runs before every start of `app` | — |
| `postgres` | Users, applications, rules, settings, audit log | volume `postgres` |
| `redis` | Drafts, sign-in codes, locks, rate limits. Written to disk, never evicted | volume `redis` |
| `cloudflared` | Cloudflare Tunnel: the site on the internet with no open ports (profile `tunnel`, the default) | — |
| `caddy` | Instead of the tunnel: HTTPS with Let's Encrypt on ports 80/443 (profile `https`) | volumes `caddy-data`, `caddy-config` |
| `backup` | Nightly database dump and documents archive | `deploy/docker/backups/` |
| `clamav` | Virus scanning of uploads (profile `clamav`, optional) | volume `clamav` |

Uploaded documents (NRCs, payslips, bank statements, signed offers) are in the volume
`documents`. They are never served directly: only through the signed-in routes.

Everything for the stack is in [`deploy/docker/`](deploy/docker). Run the commands below
from that folder.

## Before you start

- A Linux server with Docker Engine and the Compose plugin (`docker compose version`).
  2 GB of memory is enough without ClamAV; add 2 GB for it.
- A domain on Cloudflare, for the [Cloudflare Tunnel](#cloudflare-tunnel). The server
  only needs outgoing internet access: no open ports, no public IP. (Or, with
  [Caddy instead](#caddy-instead-of-the-tunnel), a hostname pointing at the server with
  ports 80 and 443 open.) HTTPS is required either way: session cookies are `Secure` in
  production, so sign-in fails over plain HTTP.
- SMTP credentials for the email codes and invitations.

## First install

```bash
git clone https://github.com/Izyane-InovSolutions/lms-loan-application.git /opt/los
cd /opt/los/deploy/docker
cp .env.example .env
chmod 600 .env
```

Fill in `.env`. At least:

- `APP_URL`, the address people will open, for example `https://loans.example.com`
- `TUNNEL_TOKEN`, from creating the tunnel (below)
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD` (each `openssl rand -hex 24`) and `LOS_SECRETS_KEY`
  (`openssl rand -base64 32`). Generate them once and store them somewhere safe. A new
  `LOS_SECRETS_KEY` makes saved credentials unreadable. `POSTGRES_PASSWORD` is only applied
  when the database is first created.
- `LOS_ADMIN_EMAIL`, `LOS_ADMIN_PASSWORD`, `LOS_ADMIN_NAME` for the first administrator
- the `EMAIL_*` settings

### Cloudflare Tunnel

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel →
   Cloudflared**. Name it (e.g. `los`), then copy the token from the install command it
   shows (the long string after `--token`) into `TUNNEL_TOKEN`. You don't need to install
   anything it suggests: the `cloudflared` container is the connector.
2. On the tunnel's **Public Hostname** tab, add the hostname from `APP_URL` (e.g. `loans`
   on `example.com`) with service type **HTTP** and URL **`app:3001`**.
3. In the domain's settings, turn on **SSL/TLS → Edge Certificates → Always Use HTTPS**.

Keep `CLIENT_IP_HEADER=cf-connecting-ip` as it is in `.env.example`. Behind Cloudflare
the visitor's address arrives in that header, and `X-Forwarded-For` can be forged by the
visitor; without the setting, rate limits on passwords and codes could be dodged and the
audit log would record made-up addresses.

AI document checks must finish within Cloudflare's 100-second limit, so they are given 85
seconds (`AI_TIMEOUT_SECONDS`).

Then build and start:

```bash
docker compose up -d --build
docker compose ps          # app, postgres and redis "healthy", cloudflared "running"
```

The tunnel shows as **Healthy** in the Cloudflare dashboard within a minute. Open
`APP_URL/admin` and sign in as the first administrator. Then clear
`LOS_ADMIN_PASSWORD` from `.env` and run `docker compose up -d` (the account stays), and
invite everyone else from **Team**.

To create an administrator without the `.env` settings (it asks for the password):

```bash
docker compose run --rm app node scripts/create-admin.js you@example.com "Your Name"
```

Finish the setup in the workspace: publish your real terms and privacy notice, set the
loan products, replace the placeholder credit rule thresholds, and turn on two-step
sign-in for admins and officers. **Admin → System health** shows whether the database,
Redis, document storage, email and the rest are working.

## Updating

```bash
cd /opt/los
deploy/docker/update.sh --pull
```

[`update.sh`](deploy/docker/update.sh) pulls the code, backs up, builds the new image and
applies any new migrations, and only then replaces the running app. If a step fails, it
stops there and the old version keeps serving. A plain `docker compose up -d --build`
also migrates, but it removes the running app before it finds out whether the migration
worked, so a failed migration takes the site down. Use the script.

A stopping `app` finishes the requests in flight and its background work (an LMS
hand-off, for example) before it exits, for up to 20 seconds.

Values starting with `VITE_` are built into the site, so changing one needs a rebuild
(`update.sh`). Every other setting needs only `docker compose up -d`.

## Daily jobs

There is no cron to install. The app runs the daily maintenance itself, after
`LOS_MAINTENANCE_HOUR` (default 03:00, in `TZ`, default Africa/Lusaka): expired
sessions, drafts and offers, data retention, LMS retries and payouts, the overdue digest,
and the files of abandoned drafts. A lock in Redis makes it run once a day, however many
`app` containers there are. **Admin → System health** shows the last run and has
**Run now**.

## Backups

The `backup` service writes two files every night after `BACKUP_HOUR` (default 01:00)
into `deploy/docker/backups/`, and deletes ones older than `BACKUP_KEEP_DAYS` (default 14):

- `los-db-<date>.dump`: the database (`pg_dump` custom format)
- `los-documents-<date>.tar.gz`: every stored document

**Copy that folder off the server** (rsync, object storage, your backup system). A backup
on the same disk does not survive the disk. Redis is not backed up. It holds only
short-lived data: drafts expire after 7 days and codes after minutes.

To back up on demand: `docker compose run --rm backup now`.

### Restoring

```bash
docker compose stop app
# The database. --clean replaces what is there.
docker compose exec -T postgres pg_restore -U los -d los --clean --if-exists < backups/los-db-2026-10-01_0100.dump
# The documents.
docker compose run --rm --no-deps --entrypoint sh -v "$PWD/backups:/backups:ro" app \
  -c 'rm -rf /data/blob/* && tar -xzf /backups/los-documents-2026-10-01_0100.tar.gz -C /data'
docker compose start app
```

Test a restore on a spare machine now and then. A backup you have never restored is a hope.

## Caddy instead of the tunnel

Without Cloudflare, Caddy serves HTTPS itself with a free Let's Encrypt certificate. In
`.env`: `COMPOSE_PROFILES=https`, `DOMAIN=` the hostname (it must point at the server,
with ports 80 and 443 open), and remove `CLIENT_IP_HEADER`. Then `docker compose up -d`.

## Using your own reverse proxy

If the server already runs nginx, Traefik or a load balancer that handles TLS, remove
`tunnel` and `https` from `COMPOSE_PROFILES` in `.env`. The app then listens only on
`127.0.0.1:3001` (`APP_PORT`). Point the proxy at it and:

- set `X-Forwarded-For` to the client's address (replacing any the client sent), and
  `X-Forwarded-Proto` and `Host`. The app uses the address for rate limits and the audit log.
- allow request bodies up to 6 MB and responses up to 90 seconds (the AI checks take up
  to 85 s)
- return 404 for `/api/cron/` (the daily jobs run inside the app)

[`deploy/nginx.conf`](deploy/nginx.conf) is a starting point. Replace its `root` and
`location /` with `proxy_pass http://127.0.0.1:3001;`, because the app serves the site
itself.

## Virus scanning

Set `COMPOSE_PROFILES=tunnel,clamav` and `CLAMAV_HOST=clamav` in `.env`, then
`docker compose up -d`. ClamAV downloads its signatures on first start, which takes a few
minutes. Until it is ready, uploads are accepted and the failure is logged, unless
`CLAMAV_REQUIRED=true`.

## More than one app container

The app keeps no state of its own: Postgres, Redis and the `documents` volume are shared.
`docker compose up -d --scale app=2` runs two on this server. First remove the `ports:`
line from `app` (two containers cannot share the port). The tunnel reaches them through
the name `app`, though it keeps connections open, so the load may not split evenly. With
Caddy instead, replace in the Caddyfile
`reverse_proxy app:3001` with the following, so requests are spread across both:

```
	reverse_proxy {
		dynamic a app 3001
	}
```
Containers on **other** servers would need the same Postgres and Redis (set `DATABASE_URL`
and `REDIS_URL` to them) and shared document storage. A local volume is per-server, so
that means an NFS mount or an S3-compatible store, which the app does not support yet.

Keep `app containers × DB_POOL_MAX` (default 10) below Postgres's `max_connections` (100).

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| `app` keeps restarting | `docker compose logs app`. A message naming a missing variable (`DATABASE_URL`, `REDIS_URL`, `LOS_SECRETS_KEY`) means `.env` lacks it. |
| `app` never starts, `migrate` exited with an error | `docker compose logs migrate` |
| The site doesn't open; tunnel "Down" in Cloudflare | `docker compose logs cloudflared`. "Provided Tunnel token is not valid" means `TUNNEL_TOKEN` is missing or wrong. |
| Cloudflare error 502 or 1033 | The tunnel's public hostname must point at `http://app:3001` (not `localhost`). |
| Cloudflare error 524 | A request took over 100 s. Lower `AI_TIMEOUT_SECONDS` if it was an AI check. |
| Certificate errors (Caddy) | `docker compose logs caddy`. Let's Encrypt must reach port 80 on `DOMAIN`. |
| Sign-in works, then "session expired" at once | The site is being opened over plain HTTP, or the proxy does not send `X-Forwarded-Proto`. |
| Emailed links point to the wrong address | `APP_URL` in `.env` |
| A setting changed but nothing happened | `VITE_*` needs a rebuild (`update.sh`); anything else needs `docker compose up -d`. |
| Database shell | `docker compose exec postgres psql -U los` |
| Redis shell | `docker compose exec redis redis-cli` |

`docker compose down` stops and removes the containers and keeps the data.
**`docker compose down -v` deletes the volumes: the database and every document.**
