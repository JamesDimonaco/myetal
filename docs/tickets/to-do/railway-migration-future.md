# Railway Migration (Future)

**Status:** Future — exploration / planning, no code yet
**Created:** 2026-05-08
**Owner:** James
**Depends on:** Stable Pi prod (current). Round-2 features ideally landed first so we're not migrating a moving target.

---

## TL;DR

Move production from the Raspberry Pi to Railway. Pi keeps its place as **staging/dev**. **Start clean** — no Postgres dump/restore; Railway gets a fresh DB and we cut over via DNS. Pi keeps its data so we always have a fallback.

Goal: stop relying on home internet + an SD card for the production app. Railway gives us managed Postgres, automatic TLS, internal service networking, and a deploy story that doesn't involve SSHing anywhere.

Cost ballpark: ~$10–25/month (Hobby/Pro plan + Postgres + API service running ~24/7).

---

## Current state (Pi prod)

From `apps/api/DEPLOY.md` and `project_infra.md`:

- **Where:** Raspberry Pi at home, behind Caddy on `api.myetal.app`.
- **What runs:** docker-compose stack with two services:
  - `api` — `jamesdimonaco/myetal-api:latest`, runs `alembic upgrade head && uvicorn`, single worker, slowapi rate-limit (in-process), restart-unless-stopped.
  - `db` — `postgres:16-alpine`, volume `myetal_pgdata`, healthcheck-gated.
- **Auxiliary:**
  - Caddy reverse proxy on the host (TLS via Let's Encrypt, X-Forwarded-* injected for slowapi).
  - `/etc/crontab` running refresh-token cleanup nightly + Backblaze B2 backup at 03:30.
  - Env at `/home/pi/myetal/.env` (mode 600, owned by user).
- **Image:** built and pushed by `.github/workflows/api-image.yml` on every main push.
- **Deploy:** SSH → `docker compose pull && down && up`. Migrations auto-apply on container start.

---

## Target state (Railway prod, Pi staging)

| Layer | Pi (staging) | Railway (prod) |
|---|---|---|
| FastAPI | Docker image from Hub, single worker | Same Docker image, single worker |
| Postgres | Co-resident in compose, on SD card | Railway managed Postgres |
| TLS | Caddy + Let's Encrypt | Railway-managed (free) |
| Domain | `staging.api.myetal.app` (new) | `api.myetal.app` (cut over) |
| DB ↔ API networking | localhost docker bridge | Railway private network (`*.railway.internal`) |
| Deploys | Manual SSH | Railway auto-deploy from Docker Hub OR GitHub |
| Migrations | `alembic upgrade head` on container start | Same (or Railway "release command") |
| Refresh-token cron | host crontab → `docker exec` | Railway cron service |
| Backups | nightly B2 dump | Railway native backups + (optional) keep B2 as off-site |
| Logs | Docker json-file driver | Railway log stream |
| Health | Compose healthcheck on `:8000/healthz` | Railway healthcheck |

The web app and mobile clients **don't care** which prod backend they hit, since they talk to `api.myetal.app`. The DNS cutover is the only client-facing move.

---

## Why migrate (the actual reasons)

1. **Home internet is a single point of failure.** Power flicker, ISP outage, router reboot — all visible to users. Railway's uptime is somebody-else's-problem.
2. **SD-card durability.** The DB volume lives on the Pi's SD card. Cards die. Even with B2 backups, recovery is ≥1 hour of "yes the API is down, hi sorry."
3. **Deploy ergonomics.** Right now: build image → SSH → pull → restart. With Railway: push to main → image rebuilds → Railway auto-deploys. No SSH.
4. **Postgres backups + PITR.** Railway managed Postgres has scheduled backups + point-in-time recovery built in. Today we have nightly B2 dumps and no PITR.
5. **Internal networking.** Railway's private network means the API talks to Postgres without going over the public internet (or even over the Pi's localhost). Lower latency, no egress.
6. **Staging/dev value.** Once Railway is prod, the Pi becomes a useful pre-prod environment we can break without consequences. Today there's no staging at all.

---

## Why not yet (the tradeoffs)

- **Cost.** Pi prod is "free" (electricity + a one-time SD card). Railway is ~$10–25/mo. For a solo project, that's not nothing.
- **Vendor lock-in.** Railway-specific config (their Postgres, their cron, their dashboards) is real switching cost if Railway ever raises prices or pivots. Mitigation: keep the Pi staging working, so we always have a working "elsewhere" target.
- **Discipline cost.** "It just runs on a Pi at home" is genuinely simpler to reason about than "it's deployed across managed services." Fewer moving parts when something breaks at 11pm.
- **No fix for any current bug.** Migration adds reliability, not features. If the goal right now is shipping Round-2 features, that comes first.

**Recommendation:** ship Round-2 (PR-C, PR-D), let it bake on the Pi for 2–4 weeks of real usage, then migrate. Migrating mid-feature-push is asking for outage timing trouble.

---

## Migration phases (when we do this)

### Phase 1 — Set up Railway prod alongside Pi prod (~1 day)

- Decide which Railway project to use (`just-expression`, `kind-wonder`, or a fresh one named `myetal`). The first two look like Railway-default names from earlier experiments.
- Create services:
  - `myetal-api` from Docker Hub image (`jamesdimonaco/myetal-api:latest`).
  - `myetal-db` Postgres (managed).
- Wire env vars on the API service. `DATABASE_URL` uses Railway's `${{Postgres.DATABASE_URL}}` reference (resolves to the internal `*.railway.internal` URL).
- Copy the FULL env block from the Pi's `/home/pi/myetal/.env`. Don't shorthand. Missing any of these = silent feature breakage:
  - **Core**: `ENV=prod`, `SECRET_KEY` (rotate), `PUBLIC_API_URL=https://api.myetal.app`, `PUBLIC_BASE_URL=https://app.myetal.app`
  - **R2**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=myetal-uploads`, `R2_ENDPOINT`, `R2_PUBLIC_URL`
  - **ORCID**: `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_USE_SANDBOX=false`
  - **Google OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - **GitHub OAuth**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - **Telegram (feedback flow — silently no-ops without these)**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - **Admin**: `ADMIN_EMAILS` (comma-separated)
  - **CORS**: `CORS_ORIGINS` (comma-separated; the Vercel preview domain pattern)
  - **Observability**: `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE=0.1`
- Run `alembic upgrade head` against the new Postgres (one-shot, manually via Railway run command or temporary container). Confirms the schema lands clean.
- Health-check Railway's URL: `curl https://myetal-api-production.up.railway.app/healthz`.
- Smoke test:
  - Sign in via ORCID → does the OAuth callback work? (PUBLIC_API_URL must be set to the Railway URL.)
  - PDF upload → R2 CORS rules already allow Vercel; Railway URL needs adding to the CORS allowlist.

### Phase 2 — Cut over DNS (~30 minutes + TTL wait)

- **24-48 hours BEFORE cutover**: lower the existing `api.myetal.app` DNS TTL to 60 seconds. Without this, propagation after the swap can take hours, not minutes — visitors mid-flight get a stale Pi resolution while we're trying to drain. Revert to a normal TTL (1h+) after cutover stabilises.
- Add `api.myetal.app` as a custom domain on the Railway API service. Railway auto-issues a Let's Encrypt cert.
- Update DNS: `api.myetal.app` CNAME → Railway's edge.
- Update the web app's `API_BASE_URL` env var on Vercel if it's hardcoded (it should already be `https://api.myetal.app`, in which case nothing changes).
- Mobile app keeps pointing at `api.myetal.app` — they don't know or care.
- The Pi's Caddy config can be retired OR rebound to `staging.api.myetal.app`.

### Phase 3 — Pi becomes staging (~30 min)

- New DNS: `staging.api.myetal.app` → Pi's public IP, served by Caddy as before.
- Update the Pi's `.env`: `PUBLIC_API_URL=https://staging.api.myetal.app`, `ENV=staging`.
- Add a `noindex` header in Caddy on the staging domain so search engines don't index two versions.
- Optionally: add a banner middleware on the API that injects an `X-Environment: staging` header so the web app can render a banner when it's hitting staging.

### Phase 4 — Move ancillary pieces (~1 day)

- **Cron jobs.** Refresh-token cleanup: convert to a Railway cron service that runs `python -m scripts.cleanup_refresh_tokens` on a schedule. Drop the host crontab on the Pi (the new staging Pi keeps its own version for testing).
- **Backups.** Railway Postgres has built-in backups; configure retention and verify a test restore. Decide whether to also keep the B2 nightly dump as an off-site copy. **Recommendation: yes, keep B2** — pgcrypto-the-platform-vendor is a single point of failure. Adapt the backup script to dump from Railway's Postgres instead of the Pi's.
- **Logs.** Railway streams to its own dashboard. Consider whether to forward to Sentry / Loki / Grafana Cloud — probably overkill at this scale. Sentry already captures errors.
- **Secrets rotation.** Railway env vars are encrypted at rest and easy to rotate. Use this opportunity to rotate `SECRET_KEY`, ORCID secret, R2 token. (Existing sessions will be invalidated, which is acceptable mid-migration.)

### Phase 5 — Decommission or repurpose Pi (~ongoing)

- Pi keeps running as staging. CI builds the same image; we can deploy it to the Pi for pre-prod testing.
- The Pi's `.env` should be sanitised — no production credentials. Use staging-tier OAuth apps where possible (sandbox ORCID, separate Google/GitHub OAuth apps with `localhost:8000` + `staging.api.myetal.app` redirects).
- Eventually the Pi could become a CI runner or just a compose host for ephemeral dev work.

---

## Open questions for owner

These need answers before any phase starts.

1. **Which Railway project?** `just-expression`, `kind-wonder`, or a new project named `myetal`? The first two look like Railway's default project names — were they exploratory? Probably create a fresh named project.
2. **Plan tier.** Hobby ($5/mo + usage) or Pro ($20/mo + usage)? Hobby has limits on resources/uptime guarantees. For a solo-dev side-project, Hobby is probably fine until it isn't.
3. **Region.** Railway has US-East (Virginia), US-West (Oregon), EU-West (Amsterdam), Asia-Southeast (Singapore). Most of your users are likely UK/EU; pick **EU-West (Amsterdam)** unless something says otherwise. Postgres latency from API is the dominant factor — keep them in the same region.
4. **Cutover timing.** Mid-week morning is safest (any drama is fixable during work hours). Weekend deploys feel chill but you're alone if something breaks.
5. **Data migration: confirm "start from scratch."** You said start clean, no dump/restore. That means **all current Pi accounts and data effectively become staging-only**. Real users sign up fresh on Railway. Confirm — this is irreversible without a migration plan.
6. **Custom domain timing.** Add `api.myetal.app` as a Railway custom domain BEFORE the cutover (zero-downtime DNS swap), or AFTER (brief downtime while DNS propagates)? Railway supports adding the domain anytime; do it early.
7. **R2 CORS update.** Railway service URL needs adding to the R2 bucket's CORS allowlist alongside `myetal.app` and the localhost dev origin. Trivial config change but easy to forget.
8. **Sentry.** Are we OK with Railway prod's Sentry DSN being the same as Pi's? Or do we want a separate Sentry project for environment separation? **Recommendation: separate projects.** Otherwise prod errors get lost in Pi staging noise.
9. **Cron approach.** Railway cron-as-a-service vs in-process APScheduler vs a separate worker container? Railway native cron is simplest if it covers our needs (refresh-token cleanup, daily backup is the only ones).
10. **Auto-deploy from Docker Hub or from GitHub?** Two options:
    - **Docker Hub:** Railway watches `jamesdimonaco/myetal-api:latest`, redeploys when it changes. Same flow as Pi today (no behavioural change for CI; image is the artifact). **Recommended.**
    - **GitHub:** Railway builds from the connected repo on every push. We lose our existing CI pipeline (or duplicate it). Don't do this.

---

## What this future ticket is NOT

- A web migration. Vercel is already managed; not in scope.
- A mobile migration. Expo's already managed.
- A user-data migration. We're starting clean on Railway by owner direction.
- A short-term plan. Recommended after Round-2 (PR-C, PR-D) ships and bakes for 2–4 weeks.
- A precondition for any current feature work. PR-C and PR-D ship to Pi prod first; Railway adopts them later.

---

## Cost ballpark

Per Railway's pricing (verify before committing — these can change):

| Component | Hobby | Pro |
|---|---|---|
| Plan | $5/mo (or first $5 of usage included) | $20/mo |
| API service (~24/7, small) | ~$5/mo | same |
| Postgres (small) | ~$5/mo | same |
| Bandwidth | metered, low at our scale | metered |
| **Total ballpark** | **~$15/mo** | **~$30/mo** |

Hobby is fine until you hit a service limit (e.g., max memory). Realistic minimum cost is ~$10/mo, realistic ceiling under load is ~$50/mo. Compare against:

- Pi electricity + SD card amortisation: ~$3/mo
- Pi outage cost: hard to quantify but real once you have users

---

## When to actually do this

Soonest sensible window: **after PR-C and PR-D ship and bake for ~2 weeks**. By then we'll have stress-tested PDF upload + comments under real load on the Pi, and the Railway migration will be a deployment exercise rather than a feature-shipping exercise.

Don't rush. The Pi is fine. It just won't be fine forever.
