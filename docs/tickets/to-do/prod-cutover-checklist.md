# Production cutover checklist — staging → main → Railway

**Status:** Backlog — execute when staging has baked enough that you trust it
**Created:** 2026-05-10 (the day staging-on-BA went green)
**Owner:** James
**Effort estimate:** ~1 hour active work; spread across 7 days for comms timing
**Depends on:** staging stable, Resend domain green (✓), Railway healthy (✓), comms list ready

---

## TL;DR

This is the moment-of-truth cutover for production. Today the system is:

- **Prod (api.myetal.app, myetal.app)**: pre-BA code on Railway + Vercel main. **Hand-rolled JWT auth still works.**
- **Staging (staging-api.myetal.app, vercel preview)**: BA code, fully tested today.

Cutting over means merging `staging` → `main`, which triggers:
- Railway rebuilds + auto-runs the destructive `0016_better_auth_cutover` Alembic. **Prod users table truncated.** Existing test users re-sign-up.
- Vercel rebuilds main → BA goes live on `myetal.app` for the first time.

Once cut over, the friction Pi-staging hit today (cookie prefix, JWT iss, OAuth redirect URIs) won't repeat — those are config issues, all already fixed in code that goes to main.

This doc is the runbook + checklist. Use the existing `better-auth-cutover-runbook.md` as a more detailed companion.

---

## Pre-cutover (T-7 days)

### 1. Comms

- [ ] Send comms email to existing prod test users:
  - Recipient list: extract before merge with `psql ... "SELECT u.email FROM users u JOIN auth_identities ai ON ai.user_id=u.id WHERE ai.provider='password';"` against current prod Postgres
  - Subject: "We're rebuilding MyEtAl auth — your account will need re-signup"
  - Body: dates, what to expect, what survives (your library re-imports via ORCID), what doesn't (your shares — re-create)
- [ ] Telegram message to anyone you've directly told to test the app
- [ ] Slack ping to brother (Resend account owner) so he's not surprised by traffic spike

### 2. Env contract on Railway

Compare what's currently set on Railway prod vs what's needed post-cutover. The Railway-side `.env.production` source of truth is `/Users/jamesdimonaco/Nextcloud/TheAPP/myetal/.env.production` on your Mac.

- [ ] Verify Railway has all of:
  - `BETTER_AUTH_SECRET` (the production value, not staging)
  - `BETTER_AUTH_URL=https://myetal.app` (matches the prod web URL exactly)
  - `RESEND_API_KEY`
  - `EMAIL_FROM=MyEtAl <noreply@myetal.app>` (verified domain)
  - `ORCID_CLIENT_ID` / `ORCID_CLIENT_SECRET` — prod ORCID, NOT sandbox
  - `ORCID_USE_SANDBOX=false`
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — prod Google
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — prod GitHub
  - All R2 / Telegram / `NEXT_PUBLIC_POSTHOG_*` vars
  - `DATABASE_URL` — Railway-managed, points at Railway Postgres (don't touch)
- [ ] Verify Vercel **Production** env scope has matching values (BA secret, Resend key, OAuth client_ids, etc.). Copy from Railway except `DATABASE_URL` which on Vercel-prod points at Railway's public Postgres URL.

### 3. OAuth provider redirect URIs

For each provider, add the **production** redirect URIs:

- [ ] **Google Cloud Console** → prod OAuth client → Authorized redirect URIs:
  - `https://myetal.app/api/auth/callback/google`
  - `https://myetal.app/auth/mobile-bounce`
- [ ] **GitHub** → prod OAuth app → Authorization callback URL:
  - `https://myetal.app/api/auth/callback/github`
- [ ] **ORCID** → prod client → Redirect URIs:
  - `https://myetal.app/api/auth/oauth2/callback/orcid`
  - `https://myetal.app/auth/mobile-bounce`

These should already exist for the legacy paths on prod. Add the new BA paths. Don't remove the legacy paths until cutover is verified — they'll just be unused.

### 4. Mobile EAS production build env

- [ ] Verify `eas.json` `production` profile has:
  - `EXPO_PUBLIC_API_URL=https://api.myetal.app`
  - `EXPO_PUBLIC_WEB_URL=https://myetal.app`
- [ ] If users have v0.1.0 builds installed already, those are pre-BA. Either:
  - Push a new TestFlight / internal build with the BA flow, OR
  - Accept that current installed apps will fail to sign in until updated

### 5. Pre-cutover Postgres snapshot (Railway)

- [ ] Take a Railway Postgres snapshot via Railway dashboard (or `railway run pg_dump ...`). Name it `prod-pre-ba-cutover-<date>.sql`. Keep for at least 30 days.
- [ ] Confirm you can restore: do a quick `railway run psql -f /tmp/prod-pre-ba-cutover-...` against a TEMPORARY Postgres service to make sure the dump is valid. (Optional but lowers anxiety.)

---

## Cutover day

### T-1 day reminder

- [ ] Second comms email to test users — "tomorrow"
- [ ] Confirm staging hasn't broken in the last 24h:
  - `curl -fsS https://staging-api.myetal.app/healthz` → 200
  - Sign in via staging Vercel URL → land on dashboard

### Merge staging → main

- [ ] On your Mac:
  ```
  git checkout main
  git pull
  git merge staging --no-ff   # keep merge commit for traceability
  git push origin main
  ```
- [ ] Watch GitHub Actions:
  - `api-image.yml` builds the Docker image (don't actually need this image since Railway builds its own, but it's harmless)
- [ ] Watch Railway dashboard:
  - api service → Deployments tab → new deploy starts
  - Build phase: ~3 min
  - Deploy phase: container starts, runs `alembic upgrade head` — **this is the destructive moment**, wiping `users` and dropping `auth_identities`/`refresh_tokens`
  - Healthcheck: `/healthz` should return 200 in ~30s

### Verify Railway after deploy

- [ ] `curl -fsS https://api.myetal.app/healthz` → `{"status":"ok","env":"production","version":"0.1.0"}`
- [ ] `curl -i https://api.myetal.app/me` → 401 with `Bearer` challenge (expected — no token attached)

### Vercel main rebuild

Vercel auto-rebuilds main on push. Verify:

- [ ] Vercel dashboard → Production → latest deploy is the merge commit, status "Ready"
- [ ] `curl -fsS https://myetal.app/api/auth/jwks` → returns JWKS doc with the production keys (BA mints these on first request after deploy)

### Re-grant admin

After the migration, `is_admin` is FALSE for everyone (column was reset by the alembic). The runtime check is `user.email in settings.admin_emails`, so admin authority is via the env var allowlist not the DB column. **You'll be admin again automatically when you re-sign-up because your email is in `ADMIN_EMAILS`.**

- [ ] Verify `ADMIN_EMAILS` on Railway env contains your email
- [ ] Sign up at https://myetal.app/sign-up with that email
- [ ] Verify `/admin/*` works (e.g., `https://myetal.app/admin/share-reports`)

### Mobile sanity (later, separate)

- [ ] Use latest dev build of mobile, point at prod via `EXPO_PUBLIC_API_URL=https://api.myetal.app`, `EXPO_PUBLIC_WEB_URL=https://myetal.app`. Sign-up should work end-to-end.
- [ ] Don't promote the new mobile build to TestFlight until web cutover is confirmed clean.

---

## Smoke matrix (run all after cutover)

These are the same scenarios from `docs/tickets/done/better-auth-orcid-flow.md` §3 but pointing at **prod URLs** instead of staging.

Each row should produce the expected outcome with no console errors:

| # | Path | Action | Expected |
|---|---|---|---|
| 1 | Web | Fresh sign-up via email + password | Land on dashboard, `users` row created, BA `session` row created, `__Secure-myetal_session` cookie set on `myetal.app` |
| 2 | Web | Sign in via Google (existing client) | Same; OAuth callback succeeds, `account` row created with `providerId='google'` |
| 3 | Web | Sign in via GitHub | Same |
| 4 | Web | Sign in via ORCID | Same; `users.orcid_id` populated |
| 5 | Web | ORCID hijack: sign up user A with ORCID iD X, sign up user B (no ORCID), B tries ORCID-X | Redirect to `/sign-in?error=orcid_already_linked` |
| 6 | Web | Password reset → check email arrives via Resend | Reset email lands at the user's inbox from `noreply@myetal.app` |
| 7 | Web | Email verification email arrives on signup | Same |
| 8 | Mobile | Email sign-in (assuming Expo Go quirk fixed by then) | Land on home, JWT stored in secure-store |
| 9 | Mobile | ORCID OAuth via mobile-bounce | JWT lifted, deep link returns to app, signed in |
| 10 | Pi-side check | After cutover, `psql ...` to Railway Postgres → `\dt` should show 20 tables | Same as staging — no leftover `auth_identities` / `refresh_tokens` |
| 11 | Admin | Re-sign-up with `ADMIN_EMAILS` email, hit `/admin/share-reports` | 200, not 403 |

---

## Rollback (if anything goes wrong)

If the cutover deploy on Railway fails healthcheck OR sign-in is comprehensively broken in a way that blocks all users:

1. Don't panic. Pi staging is still healthy with BA — that's a known-good environment to compare against.
2. **Revert the merge commit** on main:
   ```
   git checkout main
   git revert -m 1 <merge-commit-hash>
   git push origin main
   ```
3. Railway auto-redeploys with the pre-BA code.
4. **The destructive Alembic doesn't roll back data automatically.** Restore from the snapshot you took in step 5:
   ```
   railway run psql --from-file /tmp/prod-pre-ba-cutover-<date>.sql
   ```
5. Send a comms email to anyone who tried to sign up post-cutover: "We rolled back. Your re-signup didn't take — sign in with your old credentials again."

Tested by rolling back staging at least once before doing prod, ideally.

---

## DNS — already done

`api.myetal.app` already CNAME'd to Railway. No DNS changes needed for cutover. (Pi prod is no longer serving prod traffic — it's just sitting there as a hot fallback.)

---

## Post-cutover (T+1 day)

- [ ] Watch Railway logs for unexpected 401 / 500 spikes
- [ ] Watch Resend dashboard for email bounces
- [ ] Watch PostHog for sign-in failure rate (saved insight TODO — see `better-auth-followups.md`)
- [ ] Verify `/api/auth/jwks` is being fetched periodically by Railway (means JWT verification is happening — sign-ins are flowing)

If everything looks good after 48h:

- [ ] Take down Pi prod stack (`docker compose -f docker-compose.yml down`). It's no longer needed for prod traffic.
- [ ] Repurpose Pi for staging only.

---

## What this checklist deliberately does NOT cover

- The deeper "Better Auth follow-ups" (account linking UI, mobile sign-out server-revoke, etc.) — that's a separate feature ticket
- Code cleanup (Sentry SDK, UploadThing) — separate ticket
- Mobile Expo Go deep-link issue — fix in dev build before relying on it for prod testing
- 2FA, magic links, passkeys — all post-cutover features

This checklist is the operational gate for "BA is live in prod." Everything else is product work.
