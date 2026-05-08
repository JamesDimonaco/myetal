# MyEtal API — Deployment

Operational runbook for the FastAPI backend. Production runs on a Raspberry Pi
at home, behind Caddy reverse proxy on `api.myetal.app`. Postgres is co-resident
in the same `docker compose` stack. Image is published to Docker Hub by
`.github/workflows/api-image.yml` on every push to `main` that touches
`apps/api/**`.

> **Rule of thumb for changing how prod runs:** the compose file lives on the
> Pi at `/home/pi/myetal/docker-compose.yml`, NOT in this repo. If you edit it,
> commit a copy back to `docs/` so the next deploy doesn't surprise anyone.

---

## 0. One-time host setup

Assumes a fresh Debian/Raspberry Pi OS host.

### Docker + compose plugin

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### Caddyfile

`/etc/caddy/Caddyfile` — Caddy auto-provisions a Let's Encrypt cert on first
request. DNS for `api.myetal.app` must already point at the Pi's public IP.

```caddy
api.myetal.app {
    encode zstd gzip

    # Stable request id for log correlation. RequestIDMiddleware honours it.
    header_up X-Request-ID {http.request.uuid}

    reverse_proxy localhost:8000 {
        # Real client IP for slowapi rate limiting (uvicorn started with
        # --proxy-headers --forwarded-allow-ips '*').
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # QR PNG: long cache, regenerable from the share code.
    @qr path_regexp ^/public/c/[^/]+/qr\.png$
    header @qr Cache-Control "public, max-age=86400"
}
```

```bash
sudo systemctl reload caddy
```

---

## 1. Compose stack on the Pi

The whole prod stack — API, Postgres, and (optionally) Watchtower — lives in
one compose file at `/home/pi/myetal/docker-compose.yml`. Today:

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: myetal
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: myetal
    volumes:
      - myetal_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myetal"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    image: jamesdimonaco/myetal-api:${API_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:8000:8000"
    env_file: [.env]
    environment:
      ENV: prod
      DATABASE_URL: postgresql+asyncpg://myetal:${POSTGRES_PASSWORD}@db:5432/myetal
    depends_on:
      db:
        condition: service_healthy
    command: >
      sh -c "alembic upgrade head &&
             uvicorn myetal_api.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips '*' --log-level warning"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz').read()"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  myetal_pgdata:
```

Key facts encoded above:

- **`-p 127.0.0.1:8000:8000`** — port 8000 is loopback-only. The world reaches
  the API via Caddy. Port 8000 is closed on the public IP.
- **`alembic upgrade head` runs on every container start**, before uvicorn.
  No manual migration step. See §3.
- **`API_TAG` defaults to `latest`** but can be pinned in `.env` to a specific
  SHA for a deterministic rollback target. See §4.
- **`--workers 1`** — slowapi keeps its rate-limit counter in process-local
  memory. Two workers = two independent counters. Don't override. See §6.
- The healthcheck targets `:8000/healthz`, not `/readyz` — liveness, not
  readiness. We don't want a flaky DB to crash-loop the API.

---

## 2. `.env` files on the Pi

Two files live at `/home/pi/myetal/`:

**`.env`** — read by `docker compose` itself for variable substitution AND
mounted into the API container via `env_file:`. **Mode 600, owned by your user**.

```env
# --- compose-level (substituted into the YAML) ---
POSTGRES_PASSWORD=<openssl rand -hex 32>
API_TAG=latest          # pin to a SHA for predictable rollback (see §4)

# --- API container env ---
SECRET_KEY=<openssl rand -hex 32>

PUBLIC_API_URL=https://api.myetal.app
PUBLIC_BASE_URL=https://app.myetal.app

# OAuth credentials — fill from each provider's console
ORCID_CLIENT_ID=APP-...
ORCID_CLIENT_SECRET=...
ORCID_USE_SANDBOX=false
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Observability
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_TRACES_SAMPLE_RATE=0.1

# CORS — exact origins, comma-separated. Empty = no CORS, which is right when
# the web app proxies via Next.js (the default setup).
CORS_ORIGINS=
```

The startup assertion in `myetal_api.core.config` refuses to boot if
`ENV != "dev"` and `SECRET_KEY` is still the placeholder. Verified by
`tests/test_health.py`.

**`backup.env`** (optional, for §7) — Postgres URL for `pg_dump`. Same
permissions as `.env`.

---

## 3. Migration safety

The container runs `alembic upgrade head` on every start. This means:

- **A clean migration is invisible** — pull, restart, done. No human step.
- **A failing migration crash-loops the container.** `restart: unless-stopped`
  retries forever; `/healthz` returns nothing; users see 502s through Caddy.
  There is no automatic fallback to the previous image.
- **Destructive migrations need extra care.** `DROP COLUMN`, `ALTER TYPE`,
  large data transforms — these can't be rolled back by re-running an older
  image, because the schema has already changed.

### Catching migration bugs before deploy

`api-image.yml` runs the test suite (which exercises the whole model graph
under SQLite) before publishing. That catches almost everything. For higher
assurance, the workflow includes a Postgres-flavoured smoke test that runs
`alembic upgrade head` against an ephemeral `postgres:16-alpine` service
container — see the workflow file. Anything reaching the Pi has already
applied cleanly to a real Postgres at least once.

### Destructive-migration runbook

For migrations that DROP, RENAME, or transform data:

1. Take a fresh `pg_dump` (§7) **before** rolling out.
2. Pin `API_TAG` to the *current* good SHA in `.env` so an emergency rollback
   is one line away.
3. Roll out (§4). Watch logs.
4. If the migration fails, `docker compose logs api` will show the alembic
   stack trace. Fix the migration, re-publish the image, redeploy. The DB
   may be in a partially-migrated state — restore from the dump rather than
   trying to hand-patch the schema.

---

## 4. Rolling out a new version

Default flow — pulling `:latest`:

```bash
ssh pi
cd /home/pi/myetal
docker compose pull
docker compose down
docker compose up -d
docker compose logs -f api    # watch alembic + uvicorn boot
```

The pull / down / up sequence applies whatever's at `:latest`. If the new
image fails (migration error, boot crash), the previous container is already
stopped — there's no automatic rollback target.

### Pinning to a SHA for predictable rollback

`api-image.yml` tags every build as `:latest`, `:<version>` (from
`pyproject.toml`), and `:<commit-sha>`. To make rollback trivial, pin the
`API_TAG` env var in `/home/pi/myetal/.env`:

```env
API_TAG=ab12cd34ef56...    # exact 40-char SHA
```

Then deploy:

```bash
docker compose pull          # pulls the SHA tag, not latest
docker compose up -d
```

To roll back: change one line in `.env` to the previous SHA, `docker compose up -d`,
done. (Note: `docker compose down` between pulls is optional with `up -d`,
which already replaces containers when the image changes.)

### Smoke test after deploy

```bash
curl -fsS https://api.myetal.app/healthz                          # liveness
curl -fsS https://api.myetal.app/readyz                           # DB reachable
curl -fsS -o /dev/null -w '%{http_code}\n' \
  'https://api.myetal.app/auth/orcid/start?platform=web&return_to=/'   # → 302
```

---

## 5. Auto-deploy (optional)

Auto-deploy on the Pi without exposing inbound ports needs a polling agent.
**Watchtower** is the lightest option:

```yaml
  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --label-enable --cleanup
```

Add `labels: ["com.centurylinklabs.watchtower.enable=true"]` to the `api`
service (NOT to `db` — you don't want Watchtower restarting Postgres on
arbitrary tag updates). Watchtower polls Docker Hub every 5 minutes and
restarts only labelled services when their tag updates.

Trade-off: with Watchtower you can't run post-deploy smoke tests
automatically. The compose healthcheck still covers liveness, but a green
healthcheck doesn't prove the OAuth flow works. For higher assurance switch
to a self-hosted GitHub Actions runner on the Pi — more setup, finer control.

---

## 6. Single-worker constraint (slowapi)

**Do NOT add `--workers 2+`.** slowapi keeps its rate-limit counter in
process-local memory. Two workers = two independent counters, so the
configured `5/minute` per IP becomes effectively `10/minute`. The compose
`command:` hard-codes `--workers 1`; if you override it, keep it that way.

If a single worker isn't enough headroom, the path forward is Redis as the
slowapi backend, not more workers.

---

## 7. Refresh-token cleanup (cron)

The `refresh_tokens` table grows monotonically. Run the cleanup script
nightly via cron on the Pi:

```cron
@daily root docker exec myetal-api-1 python -m scripts.cleanup_refresh_tokens >> /var/log/myetal-cleanup.log 2>&1
```

(The container name is `myetal-api-1` under compose's default naming. Adjust
if you rename the project with `COMPOSE_PROJECT_NAME` or a `name:` directive.)

The script deletes rows where `revoked=True` OR `expires_at < now()` and
prints the row count to stdout.

---

## 8. Backups (Backblaze B2 via rclone)

The DB volume `myetal_pgdata` is on the Pi's SD card. Backups exist for two
reasons: the SD card dying, and "we screwed up the schema and need
yesterday's data."

One-time rclone setup:

```bash
sudo apt install -y rclone postgresql-client-16
rclone config   # interactive: pick "Backblaze B2", paste keyId + appKey,
                # name the remote "b2"
```

Cron — `/etc/crontab`:

```cron
30 3 * * * root /usr/local/bin/myetal-backup.sh
```

`/usr/local/bin/myetal-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/myetal-${TS}.dump

# Dump from the running compose Postgres. We exec into the db container so
# we don't need to expose port 5432 on the host.
docker exec myetal-db-1 pg_dump \
  --format=custom --no-owner --no-acl \
  -U myetal myetal > "$OUT"

rclone copyto "$OUT" "b2:myetal-backups/postgres/myetal-${TS}.dump"
rm -f "$OUT"

# Keep 30 daily backups, prune the rest.
rclone delete --min-age 30d "b2:myetal-backups/postgres"
```

Test the backup is restorable at least once before launch — an unverified
backup is theatre. Restore drill:

```bash
docker exec -i myetal-db-1 pg_restore --clean --if-exists -U myetal -d myetal < /tmp/some-old.dump
```

---

## 9. Observability

- **Sentry** — set `SENTRY_DSN` in `.env`. On startup the process logs
  `init_sentry returned True/False` (via structlog); confirm True on first
  prod boot.
- **Logs** — JSON to stdout when `ENV != "dev"`. Captured by Docker's
  json-file log driver (default). Add `--log-opt max-size=10m
  --log-opt max-file=3` to the compose service if you want rotation
  enforced; otherwise rely on the host's logrotate config.
- **Health endpoints** —
  - `GET /healthz` — liveness, never touches DB. Use for UptimeRobot.
  - `GET /readyz` — readiness, runs `SELECT 1`. Hit this from any LB
    that needs to drain a backend if Postgres is down.
  - `GET /health` — backward-compat alias to `/healthz`.
- **PostHog** — backend doesn't ingest. Add only when there's a real backend
  event worth shipping (e.g. share-created); scan analytics already go via
  the Next.js public page, not here.

---

## 9a. Better Auth migration cutover

The Phase 1 Alembic migration (`0016_better_auth_cutover.py`) is
**destructive** — it truncates `users` and every table that FKs to it,
drops `auth_identities` + `refresh_tokens`, and creates Better Auth's
core tables. Plan accordingly.

### Pre-cutover checklist

- [ ] Comms email sent **7 days** before merge — every test address
  (the small set in `auth_identities WHERE provider='password'` plus
  ORCID-only sign-ins). Include the cutover date and the link to
  `myetal.app/sign-up` for re-registration.
- [ ] Reminder comms **24h** before. Same list.
- [ ] Admin allowlist documented for re-grant. After cutover
  `users.is_admin` is `false` for everyone — set the desired admins
  by hand once they've re-signed-up. (Owner usually = James + ops.)
- [ ] Resend account live and DNS DKIM/SPF records published on
  `myetal.app`. Without this `RESEND_API_KEY` is set but no mail
  delivers.
- [ ] Vercel project (web) has `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `DATABASE_URL` pointing at the same
  Pi Postgres.

### New env vars on the Pi

Append to `/home/pi/myetal/.env`:

```env
# Better Auth — must match the value set on Vercel for the web app
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://myetal.app
# BETTER_AUTH_JWKS_URL / BETTER_AUTH_ISSUER auto-derive from BETTER_AUTH_URL.
# Override only if running BA behind a path-rewriting proxy.

# Resend — https://resend.com → API Keys
RESEND_API_KEY=re_...
EMAIL_FROM="MyEtAl <noreply@myetal.app>"

# Already present, double-check:
ORCID_USE_SANDBOX=false
```

### Deploy command sequence

```bash
ssh pi
cd /home/pi/myetal

# Fresh DB dump first — destructive migration ahead.
sudo /usr/local/bin/myetal-backup.sh

docker compose pull
docker compose down
# `up -d` runs `alembic upgrade head` as part of the API container's
# startup command. Watch the logs to confirm 0016 applied:
docker compose up -d
docker compose logs -f api
```

You should see `INFO  [alembic.runtime.migration] Running upgrade
0015 -> 0016, better auth cutover — fresh-start, single revision`
followed by the uvicorn boot.

### Verification

```bash
# JWKS doc serves (signed-key set Better Auth manages):
curl -s https://myetal.app/api/ba-auth/jwks | jq '.keys | length'
# expect: 1 (or more after rotations)

# Fetch a JWT for an authenticated session, then verify cross-stack:
JWT="<paste the token from the cookie / token endpoint>"
curl -s https://api.myetal.app/healthz/ba-auth \
  -H "Authorization: Bearer $JWT" | jq .
# expect: { ok: true, claims: { sub, email, is_admin: false, ... } }
```

### Rollback

If the deploy fails or sign-up is broken in ways we can't hot-fix:

```bash
# Web side — revert the cutover commit on main and let Vercel redeploy.
git revert <cutover commit SHA>
git push

# API side — IMPORTANT: run `alembic downgrade -1` while still on the
# NEW image (the one that contains revision 0016 in its alembic chain).
# Running downgrade against the old image walks 0015→0014 because 0016
# isn't known there.
docker compose run --rm api uv run alembic downgrade -1

# Now re-pin to the previous SHA and bring the old image up.
sed -i 's/^API_TAG=.*/API_TAG=<previous SHA>/' /home/pi/myetal/.env
docker compose pull
docker compose up -d
```

The downgrade recreates `auth_identities` and `refresh_tokens` empty.
Test users will need to sign up a third time once we redeploy forward
— accept this; rolling back data is out of scope.

---

## 10. Things still to wire up

- **Auto-deploy** — Watchtower (§5) is the simplest answer. Adopt when you
  trust the test gate enough to skip the manual SSH step.
- **Redis backend for slowapi** when single-worker isn't enough headroom.
- **`/metrics` endpoint** (`prometheus-fastapi-instrumentator`) once there's
  somewhere to scrape it.
- **Postgres on a USB SSD instead of the SD card** — much better write
  durability for not much money. Requires moving `myetal_pgdata` to a
  bind-mount on the SSD, which is a one-time downtime window.
