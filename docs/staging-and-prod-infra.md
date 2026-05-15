# Staging & production infrastructure runbook

**Last updated:** 2026-05-08

This is the operational reference for the new staging-on-Pi + prod-on-Railway split. Anything that needs human action (DNS, console clicks, secret entry, account creation) is listed here. Anything code-side (compose files, GH Actions workflows, env templates) is already in the repo.

---

## Architecture (the picture)

```
                 ┌────────────────────────┐
                 │   GitHub                │
                 │  ┌──────────┐           │
                 │  │  staging │ ───┐      │
                 │  └──────────┘    │      │
                 │  ┌──────────┐    │      │
                 │  │   main   │ ───┼─┐    │
                 │  └──────────┘    │ │    │
                 └──────────────────│─│────┘
                                    │ │
            push to staging ────────┘ └──── push to main
                                    │ │
                                    │ │
              ┌─────────────────────┘ └────────────────────┐
              │                                            │
              ▼                                            ▼
   ┌───────────────────────┐                  ┌──────────────────────┐
   │  GH Actions runner    │                  │  Railway (prod)      │
   │  + Twingate connector │                  │  auto-deploys main   │
   │                       │                  │                      │
   │  build :staging image │                  │  api.myetal.app      │
   │  ssh ci-deploy@pi     │                  │                      │
   │  docker compose up -d │                  └──────────────────────┘
   │                       │
   │      ▼                │                  ┌──────────────────────┐
   │  Pi @ home            │                  │  Vercel              │
   │   ├ prod stack:8000   │                  │   ├ Production →     │
   │   │  api.myetal.app   │                  │   │  myetal.app      │
   │   └ staging stack:8001│                  │   └ Preview (staging)│
   │      staging-api...   │                  │      → staging.myetal│
   └───────────────────────┘                                          │
                                              └──────────────────────┘
```

**Key principle:** staging-on-Pi auto-deploys from the `staging` branch. Prod-on-Railway auto-deploys from `main`. Until Railway is provisioned, prod stays on the existing Pi stack and is deployed manually (the existing `api-image.yml` workflow publishes the image; a human runs `docker compose pull && up -d`).

---

## What's in the repo already

| File | Purpose |
|---|---|
| `.env.example` | Single template covering dev / staging / prod, with inline annotations |
| `.env.staging` | Real staging values (gitignored) |
| `.env.production` | Real prod values (gitignored) |
| `docker-compose.yml` | Existing dev / current-prod stack |
| `docker-compose.staging.yml` | New Pi-side staging stack (separate Postgres, port 8001) |
| `.github/workflows/api-image.yml` | Build+push image on push to `main` (existing) |
| `.github/workflows/api-tests.yml` | PR tests (existing) |
| `.github/workflows/deploy-staging.yml` | Build+push+deploy staging on push to `staging` (new) |

---

## Manual setup (in order)

### 1. DNS records (Cloudflare or wherever myetal.app is managed)

Add these A / CNAME records:

| Subdomain | Type | Target | Notes |
|---|---|---|---|
| `staging.myetal.app` | CNAME | `cname.vercel-dns.com` | Vercel preview/staging deploy |
| `staging-api.myetal.app` | A | Pi's public IP (or your dynamic-DNS hostname) | Routes to Caddy/Nginx on the Pi |
| `api.myetal.app` | A | Pi's public IP (today) → Railway later | Currently serves prod from Pi |

If your Pi is behind a dynamic IP and uses something like `myetal-pi.duckdns.org`, point the A record there as a CNAME instead.

### 2. Pi reverse-proxy (Caddy or Nginx)

Add a virtual host for `staging-api.myetal.app` pointing at `127.0.0.1:8001`. If you're already on Caddy:

```
staging-api.myetal.app {
    reverse_proxy 127.0.0.1:8001
}

api.myetal.app {
    reverse_proxy 127.0.0.1:8000
}
```

Reload Caddy after editing.

### 3. Pi user + SSH key for CI deploy

```bash
# On the Pi, as root or sudo user:
sudo useradd -m -s /bin/bash ci-deploy
sudo usermod -aG docker ci-deploy
sudo mkdir -p /home/ci-deploy/.ssh
sudo chmod 700 /home/ci-deploy/.ssh

# On your Mac (NOT the Pi), generate a fresh deploy key:
ssh-keygen -t ed25519 -f ~/.ssh/myetal-ci-deploy -C "myetal-ci-deploy"
# Copy the .pub line to the Pi:
cat ~/.ssh/myetal-ci-deploy.pub
# On the Pi, paste it into authorized_keys:
sudo tee /home/ci-deploy/.ssh/authorized_keys < <pasted-pubkey>
sudo chmod 600 /home/ci-deploy/.ssh/authorized_keys
sudo chown -R ci-deploy:ci-deploy /home/ci-deploy/.ssh
```

The PRIVATE key (the one without `.pub`) goes into the GitHub secret `PI_DEPLOY_KEY` in step 6.

### 4. Pi-side repo checkout

The CI does `git pull` on the Pi and runs compose against the working tree. Provision once:

```bash
sudo mkdir -p /opt/myetal
sudo chown ci-deploy:ci-deploy /opt/myetal
sudo -u ci-deploy git clone https://github.com/JamesDimonaco/myetal.git /opt/myetal
cd /opt/myetal
# Copy your .env.staging into place — the file is gitignored, so it must exist locally.
sudo -u ci-deploy cp /tmp/<your-env-staging-file> .env.staging
sudo -u ci-deploy chmod 600 .env.staging
# Initial bring-up (one-off — CI does this on every push thereafter):
sudo -u ci-deploy docker compose -p myetal-staging -f docker-compose.staging.yml --env-file .env.staging up -d
```

### 5. Twingate

#### 5a. Account + connector

1. Create a Twingate account: https://www.twingate.com (free tier covers 5 users / 5 networks).
2. Create a Network — call it `myetal`.
3. Install the Twingate connector ON THE PI:
   ```bash
   curl -sSL https://binaries.twingate.com/connector/setup.sh | sudo bash
   ```
   It'll ask for the network name (`myetal`) and an access token from the Twingate console.
4. In the Twingate console → Resources → Add Resource:
   - Name: `myetal-pi`
   - Address: the Pi's local IP on its LAN (e.g. `192.168.1.50`) OR `localhost` if the connector runs on the Pi itself
   - Group: leave default

#### 5b. Service account for GH Actions

1. Twingate console → Settings → Services → Add Service.
2. Name: `myetal-github-deploy`.
3. Generate a new key — DOWNLOAD the JSON file (you only see it once).
4. Grant the service account access to the `myetal-pi` resource.
5. The downloaded JSON file is the value of the `TWINGATE_SERVICE_KEY` GitHub secret in step 6 — paste the WHOLE FILE CONTENT (it's a single JSON object).

### 6. GitHub secrets

Settings → Secrets and variables → Actions → New repository secret. Add all of these:

| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | (already set — confirm it's there) |
| `DOCKERHUB_TOKEN` | (already set — confirm) |
| `TWINGATE_SERVICE_KEY` | the full JSON from step 5b |
| `PI_DEPLOY_HOST` | `myetal-pi` (the resource name from step 5a) |
| `PI_DEPLOY_USER` | `ci-deploy` |
| `PI_DEPLOY_KEY` | the contents of `~/.ssh/myetal-ci-deploy` (PRIVATE key, including the BEGIN/END lines) |
| `PI_DEPLOY_PATH` | `/opt/myetal` |

### 7. Vercel staging deploy

In Vercel project settings:

1. Settings → Git → Production Branch is `main` (default).
2. Settings → Domains → Add `staging.myetal.app`. Assign it to the `staging` branch (Vercel calls this a "Branch Domain").
3. Settings → Environment Variables → for the **Preview** environment, add every variable marked `[WEB]` in `.env.example`:
   - `BETTER_AUTH_SECRET` = the staging value from `.env.staging`
   - `BETTER_AUTH_URL` = `https://staging.myetal.app`
   - `RESEND_API_KEY` = the same value
   - `EMAIL_FROM` = `onboarding@resend.dev` (until verified) → flip later
   - `DATABASE_URL` = NOT NEEDED on Vercel until BA's drizzle adapter writes (which it does on every BA request — see note below)
   - All OAuth client_id / secret pairs (use staging Google/GitHub once created; ORCID can reuse prod)
   - `NEXT_PUBLIC_POSTHOG_KEY` etc. for observability
4. For the **Production** environment, set the same vars but with prod values from `.env.production`.

**Important note on DATABASE_URL on Vercel:** Better Auth's catch-all route handler runs on Vercel and writes to the same Postgres your API talks to. For the BA staging flow to work end-to-end, Vercel needs network reach to the Pi's Postgres on `:5432`. Options:
- (a) Open the Pi's Postgres to the public internet on `:5432` (NOT recommended — even with strong password, it's an exposed surface).
- (b) Use Cloudflare Tunnel or Tailscale Funnel to expose only `staging.myetal.app/api/auth/*` traffic at a fixed origin you give Vercel.
- (c) Run BA's catch-all on the Pi (via a small Next.js sidecar) instead of Vercel for staging only.

The cleanest is (c): on staging, the entire web app runs on Vercel BUT the BA catch-all proxies through a Next.js route handler that hits a Pi-hosted Better Auth instance. This is more work than you want for staging alone — recommend (a) for staging with the password being strong, and revisit when Railway lands.

### 8. Resend domain verification (blocked on brother)

When brother gets to it:
1. https://resend.com/domains → Add Domain → `myetal.app`.
2. Resend shows DKIM + SPF + DMARC records. Add them to Cloudflare DNS.
3. Wait for "Verified" status (usually 5-30 min).
4. Then in `.env.staging` AND `.env.production` flip:
   ```
   EMAIL_FROM=MyEtAl <noreply@myetal.app>
   ```
5. Restart the web side (Vercel auto-redeploys when env changes).

### 9. OAuth provider redirect URIs

After staging DNS resolves and Vercel is wired:

- **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 client → Authorized redirect URIs. Add:
  - `https://staging.myetal.app/api/auth/callback/google`
  - `https://staging.myetal.app/auth/mobile-bounce`
  - (and the prod ones for `myetal.app` if not already there)
- **GitHub** → Settings → Developer settings → OAuth Apps → your app → Authorization callback URL. Note: GitHub OAuth apps allow only one callback URL per app, so create a SEPARATE OAuth app for staging:
  - New OAuth app: `MyEtAl (staging)` with callback `https://staging.myetal.app/api/auth/callback/github`
  - Mobile-bounce gets handled because GH redirects to BA's callback first, which then redirects to mobile-bounce — only the BA callback needs to be in GH's config.
  - Update `.env.staging` with the new staging GitHub creds.
- **ORCID** → https://orcid.org/developer-tools → your app → Redirect URIs. Add:
  - `https://staging.myetal.app/api/auth/oauth2/callback/orcid`
  - `https://staging.myetal.app/auth/mobile-bounce`

### 10. Railway (when you're ready to migrate prod)

This is a separate ticket — `docs/tickets/to-do/railway-migration-future.md`. Not part of this staging setup. When you do it:

```bash
# On your Mac:
brew install railway
railway login              # opens browser
railway init               # in the repo root, links to a new Railway project
railway add postgresql     # provisions Postgres plugin
railway up                 # deploys current branch (main)

# Bulk-import env vars from the file:
railway variables set --from-file .env.production
```

Railway auto-deploys on push to whichever branch you tell it to (default: main). It builds from the Dockerfile in `apps/api/Dockerfile`. The API image we already publish to Docker Hub is unused by Railway — Railway builds its own.

Until Railway is provisioned, leave `.env.production` as a documentation-only artefact.

### 11. Branch hygiene

Recommended Git flow once staging is wired:

```
main (prod)
  ↑
  staging (Pi)
  ↑
  feat/* (PRs)
```

PRs always target `staging`. After a few hours/days of staging baking, fast-forward `staging` → `main` to promote to prod. The `feat/better-auth-migration` branch will be the first thing to flow through this — merge it into `staging` (not main) when you're ready to test on Pi.

### 12. Mobile environment

Mobile (Expo) builds need to know which API + web URL to hit. Add to your EAS config or `.env`:

| Build profile | `EXPO_PUBLIC_API_URL` | `EXPO_PUBLIC_WEB_URL` |
|---|---|---|
| dev | `http://localhost:8000` | `http://localhost:3000` |
| staging | `https://staging-api.myetal.app` | `https://staging.myetal.app` |
| production | `https://api.myetal.app` | `https://myetal.app` |

EAS profiles live in `eas.json` at the repo root.

---

## Concerns I have (read before pushing)

1. **Pi as both staging and prod simultaneously.** Until Railway is up, the Pi runs both. Disk fill, CPU contention, Postgres connection limits — all "real but small" risks. The compose stacks are project-isolated (`-p myetal` vs `-p myetal-staging`) so they can't interfere at the docker level, but they share the same kernel + disk. Watch `docker stats` and `df -h` during the first week.

2. **Auto-deploying the BA migration to staging means it WILL truncate the staging DB on first deploy.** That's exactly what we want for staging (it's the "bake" environment), but understand: the moment you push `feat/better-auth-migration` → `staging`, the staging DB's `users` / `auth_identities` / `refresh_tokens` are wiped. There's nothing of value there yet, so this is fine. Just don't be surprised.

3. **The destructive Alembic for prod is NOT auto-run.** Same migration, same code, but `main` doesn't have an auto-deploy hook (yet). When Railway is provisioned and `main` auto-deploys, Railway WILL auto-run `alembic upgrade head` on container start (the same way the dev compose does). **Before that day comes, decide whether you want auto-migrate-on-deploy for prod or a manual gate.** My recommendation: for the first prod deploy with a destructive migration, manual is safer. Add a feature flag or a compose override that disables the migration step on prod first-deploy, then re-enable.

4. **Resend domain verification blocks the BA cutover.** Without it, sign-up + password-reset emails 403. You can technically test BA's flows in staging by using `onboarding@resend.dev` and only sending to brother's email, but real testing needs `myetal.app` verified.

5. **Vercel-Postgres networking.** See the note in step 7. If staging Vercel can't reach Pi Postgres, BA's drizzle writes fail and sign-up dies. The simplest path is to bind Pi Postgres to a public IP on a non-default port behind a strong password — works but exposes a surface. Tailscale/Cloudflare Tunnel are cleaner. Pick before you push BA → staging.

6. **Twingate connector on the Pi adds a moving piece.** If the connector dies, deploys silently fail (CI hangs at SSH). Add a simple `systemctl is-active twingate` cron on the Pi that pings you on Telegram if it's down.

7. **GitHub Actions runner limits.** Free tier is 2,000 min/month for private repos. The build+push+deploy workflow is ~5 min/run; comfortable headroom but watch if you start pushing to staging multiple times per hour.

8. **Vercel preview deploys vs the staging branch.** Vercel by default makes a unique preview URL for EVERY branch. You only want `staging.myetal.app` on the `staging` branch. Configure Vercel → Settings → Git → "Ignored Build Step" or use the Branch Domain feature to pin staging.myetal.app to the staging branch only. Other branches get auto-generated preview URLs (fine for dev).

---

## Reminders (the user is a goldfish today)

These are things I keep tracking that will matter when you come back to them:

### BA cutover blockers (from earlier today)

- **Resend `myetal.app` DKIM/SPF — blocked on brother.** Until then, BA emails (verify, password reset) will not deliver to anyone except `nicholas@dimonaco.co.uk`.
- **OAuth provider allowlists for mobile-bounce** — once staging DNS resolves, add `https://staging.myetal.app/auth/mobile-bounce` to Google + GitHub + ORCID consoles. Mobile OAuth breaks without this.
- **The pre-cutover comms email** — for prod, whenever you merge `staging → main`. Test users get wiped.
- **The 10-row ORCID smoke matrix** — at `docs/tickets/done/better-auth-orcid-flow.md` §3 (this doc lives on the BA branch; visible after staging merge). Run it on staging first, then re-run on prod after the cutover.

### What still wants your attention

- **Staging branch on origin** — I push it after this. You can immediately merge `feat/better-auth-migration` → `staging` to get the BA + staging-infra changes onto the Pi.
- **Better Auth follow-ups ticket** at `docs/tickets/to-do/better-auth-followups.md` — explicit account-linking UI is the priority item there.
- **`staging.myetal.app` and `staging-api.myetal.app` DNS** — I cannot do this for you; needs Cloudflare or whatever your DNS host is.
