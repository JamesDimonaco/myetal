# Ceteris API — Deployment

This is the operational runbook for the FastAPI backend. v1 deploy target is
James's always-on Linux box behind Caddy, talking to Neon Postgres in
`eu-west-2`. Image is published to GHCR by `.github/workflows/api-image.yml`
on every push to `main` that touches `apps/api/**`.

---

## 0. One-time host setup

Assumes a fresh Debian/Ubuntu LTS server.

### Docker

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

`/etc/caddy/Caddyfile` — Caddy auto-provisions a Let's Encrypt cert for the
domain on first request. DNS for `api.ceteris.app` must already point at the
host's public IP.

```caddy
api.ceteris.app {
    encode zstd gzip

    # Add a stable request id so backend logs and client traces correlate.
    # The backend's RequestIDMiddleware honours this header if present.
    header_up X-Request-ID {http.request.uuid}

    reverse_proxy localhost:8000 {
        # Pass through real client IP so slowapi rate-limits by the right key
        # (uvicorn is started with --proxy-headers --forwarded-allow-ips '*').
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Helpful for humans: bind a tighter cache header on the QR PNG endpoint.
    @qr path_regexp ^/public/c/[^/]+/qr\.png$
    header @qr Cache-Control "public, max-age=86400"
}
```

```bash
sudo systemctl reload caddy
```

---

## 1. Environment file

The API reads a `.env`-style file. Production lives at `/etc/ceteris/.env`,
NOT in the repo. **Mode 600, owned root:root**, mounted read-only into the
container.

```bash
sudo install -d -m 700 /etc/ceteris
sudo install -m 600 -o root -g root /dev/stdin /etc/ceteris/.env <<'EOF'
ENV=production
SECRET_KEY=<openssl rand -hex 32>
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@<project>-pooler.eu-west-2.aws.neon.tech/ceteris?ssl=require

PUBLIC_API_URL=https://api.ceteris.app
PUBLIC_BASE_URL=https://app.ceteris.app

# OAuth — fill from each provider's console
ORCID_CLIENT_ID=...
ORCID_CLIENT_SECRET=...
ORCID_USE_SANDBOX=false
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Observability
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_TRACES_SAMPLE_RATE=0.1

# CORS — exact origins, comma-separated. Empty = no CORS (the default and
# the right answer when the web app proxies via Next.js).
CORS_ORIGINS=
EOF
```

The startup assertion will refuse to boot if `ENV != "dev"` and `SECRET_KEY`
is still the placeholder — verified by `tests/test_health.py`.

---

## 2. Neon Postgres

1. Create a project in **Neon dashboard → eu-west-2**.
2. Use the **pooled** connection string (the one with `-pooler` in the
   hostname) for `DATABASE_URL`. Direct connections exhaust quickly under
   load; pooled survives.
3. Format MUST be `postgresql+asyncpg://...?ssl=require` — note the
   driver prefix and the `ssl=require` query, which asyncpg needs to enable
   TLS against Neon.
4. From your dev machine, run baseline migrations once:

   ```bash
   DATABASE_URL='postgresql+asyncpg://...neon.tech/ceteris?ssl=require' \
     uv run alembic upgrade head
   ```

   The container does NOT run `alembic upgrade` automatically in prod (only
   in `docker-compose.yml` for dev). Migrations are an explicit deploy step.

---

## 3. First-time `docker run`

Pull the latest image from GHCR (login first if the repo is private:
`echo $CR_PAT | docker login ghcr.io -u <username> --password-stdin`):

```bash
docker pull ghcr.io/jamesdimonaco/ceteris-api:latest
```

Run it:

```bash
docker run -d \
  --name ceteris-api \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  -p 127.0.0.1:8000:8000 \
  -v /etc/ceteris/.env:/app/.env:ro \
  ghcr.io/jamesdimonaco/ceteris-api:latest
```

Notes:
- `-p 127.0.0.1:8000:8000` binds to loopback only — the world reaches the API
  through Caddy, never directly. Closes off port 8000 on the public IP.
- `--restart unless-stopped` survives host reboots but respects manual `stop`.
- The image's `CMD` already starts uvicorn with `--workers 1 --proxy-headers`.

---

## 4. Single-worker constraint (slowapi)

**Do NOT add `--workers 2+`.** slowapi keeps its rate-limit counter in
process-local memory. Two workers = two independent counters, so the
configured `5/minute` per IP becomes effectively `10/minute`. The Dockerfile
hard-codes `--workers 1`; if you override `CMD`, keep it that way.

If a single worker isn't enough headroom, the path forward is Redis as the
slowapi backend, not more workers. That's a v1.x change, not v1.

---

## 5. Rolling out a new version

The CI workflow tags both `:latest` and `:<sha>`. For predictability, prefer
the SHA tag on the host so you have an exact rollback target:

```bash
NEW_SHA=<the-sha-from-the-merge-commit>
docker pull ghcr.io/jamesdimonaco/ceteris-api:$NEW_SHA

# If a migration is part of the release, run it FIRST against Neon:
DATABASE_URL='postgresql+asyncpg://...' uv run alembic upgrade head

# Then swap containers — `docker compose up -d` re-creates the container
# with the new image and removes the old one.
docker compose up -d --pull always

# Verify.
curl -fsS https://api.ceteris.app/healthz
curl -fsS https://api.ceteris.app/readyz
```

To roll back: `docker compose stop api && docker run … <previous SHA>`.

---

## 6. Refresh-token cleanup (cron)

The `refresh_tokens` table grows monotonically. Run the cleanup script
nightly via cron on the host:

```cron
# /etc/crontab — runs as root, output mailed via cron-mailto
@daily root docker exec ceteris-api python -m scripts.cleanup_refresh_tokens >> /var/log/ceteris-cleanup.log 2>&1
```

The script deletes rows where `revoked=True` OR `expires_at < now()` and
prints the row count to stdout.

---

## 7. Backup recipe (Backblaze B2 via rclone)

Neon already does 24h PITR; this is the second layer for "we screwed up
the schema and need yesterday's data" recovery.

One-time rclone setup:

```bash
sudo apt install -y rclone postgresql-client-16
rclone config  # interactive — pick "Backblaze B2", paste keyId + appKey,
               # name the remote "b2"
```

Cron — `/etc/crontab`:

```cron
30 3 * * * root /usr/local/bin/ceteris-backup.sh
```

`/usr/local/bin/ceteris-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/ceteris-${TS}.dump
# Use the Neon DIRECT (non-pooled) URL for pg_dump — pooled mode rejects
# replication-style commands. Source from a root-owned file with mode 600.
source /etc/ceteris/backup.env
pg_dump --format=custom --no-owner --no-acl "$NEON_DIRECT_URL" > "$OUT"
rclone copyto "$OUT" "b2:ceteris-backups/postgres/ceteris-${TS}.dump"
rm -f "$OUT"
# Keep 30 daily backups, prune the rest
rclone delete --min-age 30d "b2:ceteris-backups/postgres"
```

Test the backup is restorable at least once before launch — an unverified
backup is theatre.

---

## 8. Observability checklist

- **Sentry** — set `SENTRY_DSN` in `/etc/ceteris/.env`. On startup the
  process logs `init_sentry returned True/False` (via structlog); confirm
  True on first prod boot.
- **Logs** — JSON to stdout when `ENV != "dev"`. Captured by Docker's
  json-file log driver, rotated at 10MB × 3. Forward to Loki / Grafana
  Cloud later if log volume justifies it.
- **Health endpoints** —
  - `GET /healthz` — liveness, never touches DB. Use for UptimeRobot.
  - `GET /readyz` — readiness, runs `SELECT 1`. Hit this from any LB
    that needs to drain a backend if Postgres is down.
  - `GET /health` — backward-compat alias to `/healthz`.
- **PostHog** — backend doesn't ingest yet. Add only when there's a
  real backend event worth shipping (e.g. share-created); scan analytics
  go through the Next.js public page, not here.

---

## 9. Things still to wire up (post-v1)

- SSH-based GitHub Actions deploy job — currently the deploy step is
  manual `docker pull && docker compose up -d`.
- Redis backend for slowapi if/when single-worker becomes a bottleneck.
- A `/metrics` endpoint (prometheus-fastapi-instrumentator) once there's
  somewhere to scrape it.
