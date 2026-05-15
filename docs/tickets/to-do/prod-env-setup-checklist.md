# Production environment & providers setup checklist

**Status:** Pre-prod gate — work through this BEFORE running the cutover-day runbook
**Created:** 2026-05-11
**Owner:** James
**Companion to:** [`prod-cutover-checklist.md`](./prod-cutover-checklist.md) — that doc is the timeline / shipping runbook (T-7 comms → merge → smoke matrix). This doc is the supplementary "every third-party console I have to log into" list, structured by provider.

When both docs disagree, the cutover checklist wins for ordering; this doc wins for the per-provider detail.

---

## How to use this

- Work top to bottom — sections are roughly in dependency order (Vercel/Railway envs depend on OAuth client IDs being created, OAuth callbacks depend on DNS resolving, etc).
- `(owner: confirm)` = a decision the codebase doesn't answer. James must make the call before that line can be ticked.
- For env-var names + scopes, source of truth is `turbo.json` (web build) + `apps/api/src/myetal_api/core/config.py` (api Settings) + `.env.example`.

---

## 1. Vercel (prod web — myetal.app)

### Project + domain

- [ ] Confirm the Vercel project exists and is linked to the `JamesDimonaco/myetal` GitHub repo — `(owner: confirm)` whether prod runs from a separate Vercel project or the same project as staging with branch routing
- [ ] Project Root Directory = `apps/web`, framework preset = Next.js (auto-detected from `apps/web/next.config.ts`)
- [ ] Production Branch = `main` (Settings → Git)
- [ ] Add domain `myetal.app` AND `www.myetal.app` to the project (Settings → Domains); set canonical to apex `myetal.app` with `www` 308-redirecting to apex
- [ ] Confirm domain attach shows "Valid Configuration" with the Vercel-provided A / CNAME records (see §4 DNS for the records to add)
- [ ] Branch Domain: `staging.myetal.app` pinned to the `staging` branch (already wired per `docs/staging-and-prod-infra.md` §7 — confirm it's still pinned, not auto-attaching every preview)

### Build settings

- [ ] Node version = `>= 20` (root `package.json` `engines.node`). Vercel default is fine; pin to `20.x` if Vercel offers a dropdown
- [ ] Build Command = default (`pnpm build` via turbo) — pnpm is detected from `pnpm-lock.yaml`
- [ ] Install Command = `pnpm install --frozen-lockfile`
- [ ] Output mode = Next.js default (Vercel handles this; do NOT set `output: 'export'`)
- [ ] Confirm pnpm workspaces are honoured (the build at `apps/web` depends on no shared packages today, but the lockfile is at the repo root)

### Environment variables (Production scope)

Every var listed in `turbo.json` `tasks.build.env` is whitelisted for the Next build. Each row below = one env var → set under Settings → Environment Variables, scoped to **Production** (use Preview for staging values, Development is for `vercel dev` and rarely needed).

Order: BA secrets → BA URLs → DB → OAuth → email → analytics → public URLs.

- [ ] `BETTER_AUTH_SECRET` — fresh 32+ char value, MUST differ from staging (`openssl rand -base64 32`). Same value also set on Railway API. (Production scope only)
- [ ] `BETTER_AUTH_URL=https://myetal.app` — exact, no trailing slash. JWKS + issuer auto-derive from this (`apps/web/src/lib/auth.ts:57`, `apps/api/src/myetal_api/core/config.py:108-121`).
- [ ] `BETTER_AUTH_JWKS_URL` — leave UNSET so it auto-derives to `https://myetal.app/api/auth/jwks`. Only set if behind a path-rewriting proxy.
- [ ] `BETTER_AUTH_ISSUER` — leave UNSET so it equals `BETTER_AUTH_URL`.
- [ ] `DATABASE_URL` — Railway Postgres public connection string (`postgresql://...:5432/railway` from Railway → Postgres → Connect → Public Network). BA's drizzle adapter writes from Vercel to this on every auth request.
- [ ] `DATABASE_URL_SYNC` — same DB but `postgresql://` (no `+asyncpg`). Used by drizzle on the web side. `(owner: confirm)` whether this is currently set — drizzle reads `DATABASE_URL` only per `apps/web/src/lib/db.ts:22`; the `_SYNC` form is API-side.
- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — see §3 for whether these reuse staging or are net-new
- [ ] `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` — see §3 (GitHub OAuth Apps allow only one callback URL → separate prod app required)
- [ ] `ORCID_CLIENT_ID` + `ORCID_CLIENT_SECRET` — prod ORCID app, NOT sandbox
- [ ] `ORCID_USE_SANDBOX=false`
- [ ] `RESEND_API_KEY` — see §5; the Resend account is owned by James's brother, so a key may need to be issued to you
- [ ] `EMAIL_FROM=MyEtAl <noreply@myetal.app>` — only flip from `onboarding@resend.dev` once §5 says the domain is Verified
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` — separate PostHog **project** for prod (see §8)
- [ ] `NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com`
- [ ] `NEXT_PUBLIC_API_URL=https://api.myetal.app` — used by `apps/web/src/lib/api.ts:19`
- [ ] `NEXT_PUBLIC_APP_URL=https://myetal.app` — referenced via turbo allow-list; treat as canonical web URL
- [ ] `NEXT_PUBLIC_SITE_URL=https://myetal.app` — used by `robots.ts`, `sitemap.ts`, `layout.tsx`, `qr-modal.tsx`, `c/[code]/page.tsx`. Without this, the prod build hardcodes `https://myetal.app` as the fallback — so setting it explicitly is belt-and-braces. `(owner: confirm)` add to `turbo.json` build env array (currently NOT in the allow-list; the fallback works but env-driven override won't reach the bundle without this).
- [ ] `API_URL` — server-only equivalent of `NEXT_PUBLIC_API_URL`, used by SSR `api()` calls (`apps/web/src/lib/api.ts:20`). Set to `https://api.myetal.app`.
- [ ] `GITHUB_TOKEN` — optional, bumps GitHub API rate limit (60 → 5000/h) for the share-card GitHub repo enrichment route (`apps/web/src/lib/github.ts:29`). `(owner: confirm)` net-new PAT for prod or skip
- [ ] `NODE_ENV` — Vercel sets this automatically to `production`; don't override

### Preview scope (carry-over for branch previews)

- [ ] Mirror the above on the **Preview** scope with staging values, so feature-branch previews still build. The `staging` branch domain already has these from `docs/staging-and-prod-infra.md` §7.

---

## 2. Railway (prod API + Postgres)

### Project + services

- [ ] Confirm the Railway project exists and is connected to GitHub `JamesDimonaco/myetal`. Cross-ref the existing `apps/api/railway.json`.
- [ ] Service: `myetal-api`, builder = `DOCKERFILE`, dockerfile path = `Dockerfile` (Railway picks up `apps/api/railway.json` automatically), root directory = `apps/api`
- [ ] Service: Postgres plugin attached. Confirm Postgres version is `16+` (Railway plugin defaults vary; you want 16.x for `gen_random_uuid()` to be built-in)
- [ ] Auto-deploy on push to `main` enabled (`Service Settings → Source → Branch = main`)
- [ ] Healthcheck path `/healthz`, healthcheck timeout 180s, port 8000 — already declared in `apps/api/railway.json`. Confirm Railway is honouring it (Service → Settings → Healthcheck shows `/healthz`)
- [ ] Start command — no override needed; the Dockerfile shell-form CMD honours `$PORT` (Railway sets `$PORT` to a random value; uvicorn binds to it). Confirm Service → Settings → Deploy → Start Command is BLANK.
- [ ] Numero of replicas = 1 (slowapi keeps rate-limit counter in process memory — see `apps/api/DEPLOY.md` §6). Already in `railway.json`. Don't override.

### Postgres extensions

Apply once, BEFORE first `alembic upgrade head` run on Railway. Connect via `railway connect Postgres` or the Railway Postgres "Query" tab:

- [ ] `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — provides `gen_random_uuid()` used by every UUID-defaulting column (Postgres 16 has it built-in; this is documentation defence)
- [ ] `CREATE EXTENSION IF NOT EXISTS pg_trgm;` — used by share search, tags autocomplete, user-search autocomplete (Alembic 0007 / 0012 / 0013 also `CREATE EXTENSION IF NOT EXISTS pg_trgm` defensively, so this is technically idempotent — but pre-creating means migration 0007 doesn't need extra privileges)
- [ ] Confirm both with `SELECT extname FROM pg_extension;` — expect `plpgsql`, `pgcrypto`, `pg_trgm` at minimum

### Migrations on deploy

- [ ] `alembic upgrade head` runs automatically on container start — declared in the Dockerfile's CMD? `(owner: confirm)` — `apps/api/DEPLOY.md` §1 documents `sh -c "alembic upgrade head && uvicorn ..."` for the Pi compose file, BUT the Dockerfile CMD doesn't include it. Railway needs the migration step explicit: either set Start Command to `sh -c "alembic upgrade head && uvicorn myetal_api.main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*' --log-level info"` OR update the Dockerfile CMD. **Decision needed before first prod deploy.**
- [ ] Per `staging-and-prod-infra.md` §"Concerns" #3: decide whether the destructive `0016_better_auth_cutover` runs auto-on-deploy or as a manual gate. `(owner: confirm)` — recommendation in that doc is "manual is safer for the first destructive prod deploy"
- [ ] If auto-migrate: the cutover checklist's snapshot step is non-negotiable — see `prod-cutover-checklist.md` §"Pre-cutover Postgres snapshot"

### API environment variables (Production)

Every field on `Settings` in `apps/api/src/myetal_api/core/config.py` is an env var. Each row below maps to one Railway service variable. (Mirror the .env.example annotations.)

- [ ] `ENV=production`
- [ ] `SECRET_KEY` — `openssl rand -hex 32`. Process refuses to boot in non-dev if this is the placeholder (`config.py:104-106`)
- [ ] `DATABASE_URL` — Railway auto-sets this when Postgres plugin is attached. Use `${{ Postgres.DATABASE_URL }}` reference syntax so it tracks the plugin. **Format check:** must use `postgresql+asyncpg://` driver for `apps/api/src/myetal_api/db.py`. If Railway hands you `postgresql://`, prepend `+asyncpg` either via a variable transform or wrap with `DATABASE_URL` = `${{ Postgres.DATABASE_URL_ASYNCPG }}` — `(owner: confirm)` Railway naming
- [ ] `DATABASE_URL_SYNC` — same DB but `postgresql://` (no driver). Used by Alembic's sync engine.
- [ ] `BETTER_AUTH_SECRET` — **same value as Vercel Production**, 32+ chars
- [ ] `BETTER_AUTH_URL=https://myetal.app`
- [ ] `BETTER_AUTH_JWKS_URL` — leave unset, auto-derives
- [ ] `BETTER_AUTH_ISSUER` — leave unset, auto-derives
- [ ] `PUBLIC_BASE_URL=https://myetal.app`
- [ ] `PUBLIC_API_URL=https://api.myetal.app`
- [ ] `ADMIN_EMAILS=["james@example.com"]` — JSON array form (Railway env vars are container env, not .env file — pydantic-settings requires JSON for list types when sourced from container env per `.env.example:91-95`). `(owner: confirm)` the prod admin email list — include yourself + any ops
- [ ] `CORS_ORIGINS` — leave UNSET unless the web side calls `api.myetal.app` directly from the browser. Today the Next.js proxy fronts everything (`apps/web/src/lib/api.ts`), so CORS is not exercised. If set, JSON-array form: `CORS_ORIGINS=["https://myetal.app","https://www.myetal.app"]`
- [ ] `ORCID_CLIENT_ID` + `ORCID_CLIENT_SECRET` — prod app
- [ ] `ORCID_USE_SANDBOX=false`
- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
- [ ] `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`
- [ ] `RESEND_API_KEY`
- [ ] `EMAIL_FROM=MyEtAl <noreply@myetal.app>`
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — for feedback notifications. `(owner: confirm)` reuse staging bot or net-new
- [ ] `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=myetal-uploads`, `R2_ENDPOINT`, `R2_PUBLIC_URL` — `(owner: confirm)` reuse staging bucket or provision a separate prod bucket per `.env.example:69-77` recommendation
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` — `(owner: confirm)` API doesn't currently ingest to PostHog (`apps/api/DEPLOY.md` §9 "backend doesn't ingest"); these may be unnecessary on Railway

### Scheduled tasks (cron)

Railway "Cron Schedules" feature OR a self-hosted scheduler. Each script lives in `apps/api/scripts/` and is bundled into the image (`apps/api/Dockerfile:42`). Invocation pattern: `python -m scripts.<name>` against the running api service.

- [ ] `scripts.refresh_similar_shares` — @nightly (script docstring line 8). Truncates + rebuilds the `share_similar` precompute table. Cron expression: `0 3 * * *` (3am UTC)
- [ ] `scripts.refresh_trending` — @hourly (preferred, per docstring line 17) or @nightly. Idempotent (no truncate). Cron: `0 * * * *`
- [ ] `scripts.gc_tombstoned_shares` — @daily. Permanently deletes shares tombstoned >30 days ago. Cron: `15 3 * * *`
- [ ] `scripts.prune_share_views` — @daily. Deletes share_views rows >90 days old. Cron: `30 3 * * *`
- [ ] Document the chosen mechanism — Railway Cron (paid plan feature) vs `railway run` from a GH Action vs sidecar service. `(owner: confirm)` — Railway Cron is the path of least resistance but check Railway plan tier supports it

---

## 3. OAuth providers (prod redirect URIs)

Callback paths verified from `apps/web/src/lib/auth.ts` (Better Auth defaults `/api/auth/callback/<provider>` for socialProviders + `/api/auth/oauth2/callback/<provider>` for genericOAuth).

### Google Cloud Console

- [ ] Pick the OAuth client → `(owner: confirm)` reuse the existing prod Google client used by the pre-BA prod app, OR create net-new (recommended: REUSE — same `client_id` keeps the OAuth consent screen scope unchanged; just add new redirect URIs)
- [ ] Authorized redirect URIs → add:
  - `https://myetal.app/api/auth/callback/google` (Better Auth canonical callback)
  - `https://myetal.app/auth/mobile-bounce` (mobile deep-link bridge — see `apps/api/DEPLOY.md` §"OAuth provider allow-lists for mobile")
- [ ] Authorized JavaScript origins → `https://myetal.app`
- [ ] OAuth consent screen status: `(owner: confirm)` move from `Testing` to `In Production` + complete brand verification. If staying in Testing, the app is capped at 100 unique users and gets a "unverified" interstitial.
- [ ] Scopes — `openid email profile` (BA's default for Google). No verification needed for these.
- [ ] Client ID → Vercel `GOOGLE_CLIENT_ID` (Production scope) + Railway `GOOGLE_CLIENT_ID`. Client Secret → `GOOGLE_CLIENT_SECRET` on both.

### GitHub OAuth App

- [ ] GitHub OAuth apps allow only **one** callback URL per app — `(owner: confirm)` create a new prod OAuth app `MyEtAl (production)` separate from staging (recommended), do NOT reuse staging
- [ ] Homepage URL: `https://myetal.app`
- [ ] Authorization callback URL: `https://myetal.app/api/auth/callback/github` (only field; mobile-bounce isn't a separate redirect URI in GH's model — the bounce is a 302 from BA itself)
- [ ] Client ID → Vercel + Railway `GITHUB_CLIENT_ID`. Client Secret → `GITHUB_CLIENT_SECRET`.

### ORCID

- [ ] Use the existing prod ORCID app (not sandbox). `(owner: confirm)` whether you have one — if only a sandbox app exists today, register a prod app at https://orcid.org/developer-tools
- [ ] Redirect URIs → add:
  - `https://myetal.app/api/auth/oauth2/callback/orcid` (Better Auth genericOAuth canonical)
  - `https://myetal.app/auth/mobile-bounce`
- [ ] Scope: `/authenticate` (was `/read-limited` pre-cutover, narrowed in commit `574ba97`). Works for both Public API and Member API per `apps/web/src/lib/auth.ts:328`.
- [ ] API type: **Public API** (not Member API) — Public is free and sufficient for OIDC sign-in + the works-sync ORCID read flow this app does.
- [ ] Client ID → Vercel + Railway `ORCID_CLIENT_ID`. Client Secret → `ORCID_CLIENT_SECRET`.

---

## 4. DNS

Source of truth: Cloudflare (registrar + DNS provider, per the Resend warning in `apps/api/DEPLOY.md` §9a). Records to confirm or add:

- [ ] `myetal.app` apex → Vercel A records (76.76.21.21) OR ANAME/ALIAS / CNAME flattening per Vercel's "Add Domain" page. Cloudflare supports CNAME-at-apex via flattening
- [ ] `www.myetal.app` → CNAME `cname.vercel-dns.com`
- [ ] `api.myetal.app` → already CNAME'd somewhere — `(owner: confirm)` flip from Pi (current) to Railway by replacing the A record / CNAME with the Railway-issued CNAME target. Per `prod-cutover-checklist.md` §"DNS — already done" the Railway target is in place; double-check before merge
- [ ] `staging.myetal.app` → already CNAME → `cname.vercel-dns.com` (per `staging-and-prod-infra.md` §1)
- [ ] `staging-api.myetal.app` → Pi A record (keep as-is until Pi staging is decommissioned)
- [ ] Resend SPF: `TXT @` value `v=spf1 include:_spf.resend.com ~all` — coordinate with existing SPF if any
- [ ] Resend DKIM: 3 CNAME records under `resend._domainkey.myetal.app` etc — exact values come from the Resend dashboard
- [ ] Resend DMARC: `TXT _dmarc.myetal.app` value `v=DMARC1; p=none; rua=mailto:dmarc-reports@myetal.app` — start with `p=none` for monitoring, tighten to `p=quarantine` after 2 weeks of clean reports `(owner: confirm)` the mailbox
- [ ] Cloudflare SSL/TLS mode = **Full (strict)** — both Vercel (myetal.app) and Railway (api.myetal.app) serve valid TLS, so strict is correct. `(owner: confirm)` confirm Cloudflare → SSL/TLS → Overview shows "Full (strict)" not "Flexible" (Flexible would HTTPS-to-HTTP downgrade between Cloudflare and origin, breaking BA cookie security)
- [ ] Cloudflare proxy (orange cloud) — `(owner: confirm)` whether to proxy `myetal.app` + `api.myetal.app` through Cloudflare or DNS-only. Proxied = WAF + bot protection but adds another hop; DNS-only (grey cloud) is simpler for first launch

---

## 5. Email (Resend)

- [ ] Confirm `myetal.app` is verified in Resend dashboard (was "blocked on brother" per `staging-and-prod-infra.md` §8 reminders) — Resend → Domains → `myetal.app` should show **Verified** for SPF + DKIM
- [ ] Sender identity `noreply@myetal.app` — `EMAIL_FROM=MyEtAl <noreply@myetal.app>` set on Vercel + Railway production scopes
- [ ] Send a test transactional email from the Resend dashboard to confirm DNS green BEFORE the cutover-day password-reset smoke test
- [ ] Sending tier: `(owner: confirm)` current Resend plan (free = 100/day, 3000/month; Pro starts at 50k/month). Pre-launch volume is tiny — free is fine — but check the cap won't bite during the cutover comms email
- [ ] `RESEND_API_KEY` — `(owner: confirm)` net-new key issued per environment vs reuse staging key. Recommendation: new key for prod so you can revoke staging without touching prod
- [ ] `EMAIL_FROM` envelope — keep as `MyEtAl <noreply@myetal.app>`; the reply-to addressbook for outbound is `noreply@` (don't expect inbound)

---

## 6. Postgres data

### Destructive migration confirmation

- [ ] Confirm Railway Postgres is fresh / empty enough to accept the destructive `0016_better_auth_cutover` alembic. Per `docs/tickets/done/better-auth-migration.md`: the migration `TRUNCATE`s every FK-dependent table and `DROP`s `auth_identities` + `refresh_tokens`. The Pi prod currently still has hand-rolled auth, so the schema there is pre-0016. Railway Postgres must be in the same pre-0016 state at migration time.
- [ ] `(owner: confirm)` whether the Railway Postgres has already been seeded with pre-cutover migrations. If yes, `0016` will fire and wipe testers' rows (intended). If Railway Postgres is brand-new, `alembic upgrade head` runs the whole chain 0001 → 0016 in one go (also fine — the truncate hits empty tables and is a no-op).

### Backups + version

- [ ] Railway Postgres "Backups" enabled — Railway → Postgres → Settings → Backups. `(owner: confirm)` Railway plan tier supports automated backups (Hobby includes daily snapshots, retained 7d)
- [ ] Pre-cutover manual snapshot per `prod-cutover-checklist.md` §"Pre-cutover Postgres snapshot" — `railway run pg_dump ... > prod-pre-ba-cutover-<date>.sql`. Keep 30 days.
- [ ] Postgres version 16+ — confirm via `SELECT version();` on the Railway Postgres
- [ ] `(owner: confirm)` storage size + projected growth — Railway's default plan caps shouldn't bite for a year+

### Connection pool sizing

- [ ] FastAPI's async SQLAlchemy engine — defaults at `apps/api/src/myetal_api/db.py` `(owner: confirm)` pool size. Likely fine at defaults (pool_size=5, max_overflow=10) for a single replica. Railway Postgres connection limits are 100+ on all plans — no immediate concern.
- [ ] Vercel BA's drizzle on `apps/web/src/lib/db.ts` opens its own `pg` Pool — confirm it's not creating a new pool per request (it isn't; `db` is a module-level const). Vercel serverless cold-starts cap concurrent connections — fine for v1 volume.

---

## 7. Secrets to rotate / set net-new for prod

Hard rule: **no staging value crosses into prod**. The Pi staging stack and any leaked staging secret are treated as compromised by default.

- [ ] `BETTER_AUTH_SECRET` — generate fresh: `openssl rand -base64 32`. Must be ≥32 chars (`apps/api/src/myetal_api/core/config.py:131`). Set identical on Vercel Production AND Railway prod.
- [ ] `SECRET_KEY` (API) — generate fresh `openssl rand -hex 32`. Refuses to boot if dev placeholder (`config.py:104`)
- [ ] Postgres password — Railway-managed (auto-generated), do not reuse the staging Pi DB password (which has been distributed and is logged in `.env.staging` on multiple machines)
- [ ] OAuth client_secrets — `(owner: confirm)` for each of Google/GitHub/ORCID, decide: reuse the staging app's secrets (if the OAuth app is shared) OR new app + new secrets. Per §3: Google = recommend reuse, GitHub = MUST be net-new (1 callback per app), ORCID = use prod app (separate from sandbox)
- [ ] PostHog API key — separate prod project (§8). Net-new key.
- [ ] `RESEND_API_KEY` — recommend net-new (§5)
- [ ] `TELEGRAM_BOT_TOKEN` — `(owner: confirm)` reuse staging bot for feedback or new bot — the bot routes to a chat ID; if `TELEGRAM_CHAT_ID` differs, the same bot can serve both
- [ ] R2 keys — `(owner: confirm)` recommend separate `myetal-uploads` (prod) and `myetal-uploads-staging` buckets with separate API tokens per `.env.example:69-71`
- [ ] `GITHUB_TOKEN` — net-new PAT (or skip — only enriches the GitHub share-card rate limit)
- [ ] Store all of the above in a password manager BEFORE pasting into Vercel / Railway. Never echo to terminal scrollback.

---

## 8. Observability

- [ ] PostHog: create a **second** project at https://eu.posthog.com for prod (do NOT reuse the dev/staging project). `(owner: confirm)` project name `MyEtAl Production` vs `MyEtAl`
- [ ] Capture the prod project's API key → set as `NEXT_PUBLIC_POSTHOG_KEY` on Vercel Production scope
- [ ] PostHog → Settings → Authorized URLs add `https://myetal.app`
- [ ] PostHog → Insights — `(owner: confirm)` re-create the staging-side dashboards (sign-in funnel, share-create funnel) against the prod project, or wait until prod has volume
- [ ] Uptime monitoring on `https://api.myetal.app/healthz` — `(owner: confirm)` the existing Uptime Kuma instance is on the Pi and Pi-staging only; for prod, use a third-party (UptimeRobot free, BetterStack, or Cloudflare Health Checks) so an outage on Pi/home internet doesn't also kill the uptime alerts
- [ ] Uptime monitoring on `https://myetal.app/api/auth/jwks` — secondary check, confirms the web side AND BA boot is healthy (the API depends on this URL being reachable to verify JWTs)
- [ ] Sentry: removed in commit `574ba97` per task brief — confirmed. No action.
- [ ] Railway logs — set up log drain to a long-term store? `(owner: confirm)` Railway retains logs ~7 days by default; ship to Better Stack / Axiom / Logtail if you want longer retention

---

## 9. CI/CD

### GitHub Actions workflows

- [ ] `api-tests.yml` runs on PRs touching `apps/api/**` or the web↔BA glue files. Includes a `web-integration` job that spins up testcontainers Postgres + runs the BA ↔ Postgres integration tests. **Confirm "Required" status check** for `staging` and `main` branches (Settings → Branches → Branch protection rules)
- [ ] `api-image.yml` runs on push to `main` paths `apps/api/**`. Builds + pushes Docker image to Docker Hub (`jamesdimonaco/myetal-api:latest`, `:<version>`, `:<sha>`). Railway does NOT consume this image (builds its own from the Dockerfile), so this workflow is for: legacy Pi prod deployment AND deterministic-SHA rollback target. `(owner: confirm)` keep publishing or skip — recommend keep for now (free GHA minutes, image is useful as a fallback)
- [ ] `deploy-staging.yml` runs on push to `staging` paths `apps/api/**` or compose. SSHes Pi via Twingate, pulls image, restarts compose. Stays in place after prod cutover — `staging` is still useful as a bake environment.
- [ ] Branch protection on `main`: require PR review (`(owner: confirm)` 1 reviewer or self-merge?), require `api-tests / test` AND `api-tests / web-integration` to be green
- [ ] Branch protection on `staging`: same rules as `main` minus reviewer count

### Railway auto-deploy

- [ ] Railway service `myetal-api` → Settings → Source → Branch `main`, auto-deploy `ON`
- [ ] Railway → Service → Deploys tab — set up Slack / Discord notification on deploy failure `(owner: confirm)`
- [ ] First-deploy guard: if running the destructive `0016` migration as a manual step (§2 above), temporarily disable auto-deploy during the cutover merge, run migration manually, then re-enable

### GHCR vs Docker Hub image tag strategy

- [ ] Docker Hub image (current): `jamesdimonaco/myetal-api:{latest,<version>,<sha>}` — published from `api-image.yml`. Pi compose pulls these.
- [ ] `(owner: confirm)` migrate publish target to GHCR (`ghcr.io/jamesdimonaco/myetal-api`)? Same workflow, swap registry; benefit is one-less-secret (uses `GITHUB_TOKEN`) and better integration with the repo. Not blocking for prod cutover.
- [ ] Image tag pinning on Railway = irrelevant (Railway builds its own image from source). Pinning on Pi compose = covered by `apps/api/DEPLOY.md` §4 `API_TAG` env var.

---

## 10. Comms / UX final pass

- [ ] T-7 comms email drafted — cross-reference `better-auth-cutover-runbook.md` lines 17-20 ("MyEtAl auth rebuild — your account will be wiped on <DATE>") AND `prod-cutover-checklist.md` §1 (recipient list extraction SQL). `(owner: confirm)` whether the email body is drafted somewhere or needs writing
- [ ] T-1 reminder email scheduled
- [ ] Telegram message to direct testers — list `(owner: confirm)` who needs the heads-up
- [ ] 404 page (`apps/web/src/app/not-found.tsx`) — prod-ready, copy reviewed, links work (`/`, `/dashboard/search`) ✓
- [ ] Error boundary (`apps/web/src/app/error.tsx`) — captures to PostHog conditionally, prod-ready ✓
- [ ] Privacy policy at `/privacy` exists (`apps/web/src/app/privacy/page.tsx`) — `(owner: confirm)` reviewed for prod (no staging URLs, no placeholder dates)
- [ ] Terms at `/terms` exists (`apps/web/src/app/terms/page.tsx`) — `(owner: confirm)` reviewed similarly
- [ ] `robots.ts` exposes `https://myetal.app` (env `NEXT_PUBLIC_SITE_URL` controlled, with fallback) — disallows `/dashboard/`, `/api/`, `/admin/`, `/sign-in`, `/sign-up`. Reviewed ✓
- [ ] `sitemap.ts` fetches `/public/sitemap-shares` from the API — confirm `NEXT_PUBLIC_API_URL` resolves to `https://api.myetal.app` in the prod build so the sitemap populates with real shares
- [ ] Open Graph metadata in `layout.tsx` — `metadataBase` reads `NEXT_PUBLIC_SITE_URL`; reviewed ✓
- [ ] QR code generation (`qr-modal.tsx`) uses `NEXT_PUBLIC_SITE_URL` — confirm QRs scanned post-cutover go to `myetal.app/c/<code>`, not staging
- [ ] Email templates (BA password-reset, verify-email) — `(owner: confirm)` rendered HTML uses `BETTER_AUTH_URL` which = `https://myetal.app` in prod, so deep links land on prod. Quick sanity by triggering a password-reset against staging first and reading the email URL.
- [ ] OAuth provider consent screen branding — Google's consent screen shows the app name + logo `(owner: confirm)` matches the prod brand, not the staging app name
- [ ] Mobile EAS build env per `prod-cutover-checklist.md` §"Mobile EAS production build env" — separate doc, not duplicated here

---

## Final pre-flight (do NOT skip)

- [ ] Walk this checklist top-to-bottom one final time the morning of cutover
- [ ] Confirm every `(owner: confirm)` is resolved (or deliberately deferred with a note)
- [ ] Hand off to `prod-cutover-checklist.md` for the actual merge / deploy timeline

---

## Open decisions tracker (for quick scan)

Every `(owner: confirm)` flag rolled up:

1. Vercel project — separate prod project or shared with staging via branch routing?
2. `NEXT_PUBLIC_SITE_URL` — add to `turbo.json` env allow-list?
3. `GITHUB_TOKEN` for prod — net-new PAT or skip?
4. `DATABASE_URL` driver string on Railway — `+asyncpg` prefix needed manually?
5. `alembic upgrade head` on Railway — Start Command override OR Dockerfile change?
6. Destructive migration `0016` on prod — auto-run or manual gate?
7. `ADMIN_EMAILS` final list for prod
8. CORS_ORIGINS — needed at all? (proxy fronts everything today)
9. `TELEGRAM_*` reuse staging or net-new?
10. R2 — shared bucket or separate prod bucket?
11. PostHog/Telegram on Railway — necessary at all (API doesn't ingest)?
12. Railway Cron tier supports the 4 scheduled scripts?
13. Google OAuth — reuse staging client or net-new prod client?
14. Google consent screen — Testing → In Production verification?
15. ORCID — confirm prod app exists (not just sandbox)?
16. Cloudflare — proxy on (orange) or DNS-only (grey)?
17. Cloudflare SSL/TLS mode confirmed Full (strict)?
18. DMARC `rua` mailbox — who receives the reports?
19. Resend plan tier — free covers comms blast?
20. Resend API key — net-new for prod?
21. Railway plan supports automated Postgres backups?
22. DB connection pool — defaults OK or tune?
23. PostHog prod project name + dashboard re-creation?
24. Uptime monitor service choice?
25. Long-term log shipping target?
26. Branch protection reviewer count?
27. Deploy notification channel (Slack/Discord/email)?
28. GHCR migration — now or later?
29. Comms email body — drafted or TBD?
30. Direct-tester Telegram list — who?
31. `/privacy` + `/terms` reviewed for prod copy?
32. OAuth consent branding — prod brand vs staging brand?
