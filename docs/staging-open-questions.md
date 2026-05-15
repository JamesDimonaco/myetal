# Staging — open questions / concerns to discuss later

**Created:** 2026-05-08
**Owner:** James (decisions); Claude (raised the concerns)

These are things that came up while wiring staging infra. None block the immediate work (Pi-side setup); they need a decision before mobile auth on staging can be exercised end-to-end.

---

## 1. Mobile auth post-BA goes through Next.js, not FastAPI directly

**Concern:** the user's framing was *"let's just play with the apps talking to staging, which is through the Pi"* — implying staging = Pi only, ignore web/Vercel. But after the Better Auth migration, mobile auth flows through **Next.js routes** (`/api/auth/sign-in/email`, `/api/auth/get-session`, `/auth/mobile-bounce`), not FastAPI directly. Without a deployed Next.js for staging, mobile sign-in / sign-up / OAuth all 404.

**Mobile call paths that depend on Next.js post-BA:**
- `signIn(email, password)` → `${WEB_BASE_URL}/api/auth/sign-in/email`
- `signUp(email, password, name)` → `${WEB_BASE_URL}/api/auth/sign-up/email`
- `signOut()` → `${WEB_BASE_URL}/api/auth/sign-out`
- `signInWith{Google,GitHub,Orcid}()` → opens `${WEB_BASE_URL}/api/auth/sign-in/social/...` then deep-links via `/auth/mobile-bounce`
- `verify-email banner` → `${WEB_BASE_URL}/api/auth/send-verification-email`
- `liftJwtFromBaResponse` → `${WEB_BASE_URL}/api/auth/get-session` and `${WEB_BASE_URL}/api/auth/token`

Mobile only talks to the FastAPI Pi for `/me` and other domain endpoints — but it needs a JWT first, and the JWT is minted by Next.js.

**Three options to resolve:**

### (A) Use Vercel preview URL for staging — free, no custom domain
Vercel auto-creates a preview deploy for every pushed branch. The `staging` branch will get a URL like `myetal-git-staging-<account>.vercel.app`. Mobile's `EXPO_PUBLIC_WEB_URL` points at that. Vercel's Preview environment-variable settings are set to the staging values from `.env.staging`. Free tier handles preview deploys fine — paid plans only kick in for custom domains, ISR resources, etc.

**Pro:** zero infra work, fully matches the prod architecture (Web on Vercel, API on Pi).
**Con:** Vercel preview URLs change per branch / per push. If you stick to a single `staging` branch, the URL is stable (`myetal-git-staging-...vercel.app`); it only changes if you rename the branch.
**Decision impact:** mobile EAS profile for staging needs `EXPO_PUBLIC_WEB_URL=https://myetal-git-staging-jamesdimonaco.vercel.app` (or whatever Vercel actually generates).

### (B) Run Next.js on the Pi too
Add a `web` service to `docker-compose.staging.yml` that builds and runs Next.js. Same Caddy reverse-proxy idea: `staging.myetal.app` (or whatever) → Pi → Next.js → BA → Pi Postgres.

**Pro:** truly self-contained staging on Pi. No Vercel involvement at all.
**Con:** more compose plumbing; another container to maintain; Next.js builds are slow on Pi arm64 (5-10 min); HMR/caching pre-built into Vercel that you don't get on Pi.
**Decision impact:** big change. Probably not worth it for staging.

### (C) Skip BA testing on mobile for now
Mobile only tests the FastAPI parts of staging. Auth bypassed (e.g., generate a test JWT manually and inject). Not a real end-to-end test, but unblocks deploy-workflow validation immediately.

**Pro:** zero blocker for confirming the GH Actions → Pi pipeline works.
**Con:** doesn't actually test BA. Defeats the point of staging-baking the BA migration.

**Recommendation: (A).** Use Vercel preview URL. It's the only path that's free, fast to set up, and matches prod architecture. The runbook (`docs/staging-and-prod-infra.md` §7) already assumes Vercel-side env vars are set; the only delta is mobile EAS config pointing at the preview URL instead of `staging.myetal.app`.

---

## 2. Pi Postgres reachable from Vercel — separate concern

Even with option (A), Better Auth's drizzle adapter writes to Postgres on every BA call. BA runs on Vercel; Postgres lives on Pi. Vercel needs network reach to Pi:5432.

Three sub-options:
- **Bind Pi Postgres to a public IP behind a strong password.** Simplest; opens an attack surface.
- **Cloudflare Tunnel** for Postgres. Cleanest. Free. Adds a small piece of infra.
- **Tailscale** with Vercel function-level access. Possible but Vercel doesn't first-class Tailscale.

**Recommendation: Cloudflare Tunnel** for Postgres-on-Pi-from-Vercel. ~30 min setup, gives a fixed hostname Vercel can hit, no public exposure.

---

## 3. Mobile EAS profile for staging

Mobile builds need `EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_API_URL` per environment. Today's `eas.json` likely has only one profile. Add:

```json
{
  "build": {
    "staging": {
      "channel": "staging",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://staging-api.myetal.app",
        "EXPO_PUBLIC_WEB_URL": "https://myetal-git-staging-jamesdimonaco.vercel.app"
      }
    },
    "production": {
      "channel": "production",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.myetal.app",
        "EXPO_PUBLIC_WEB_URL": "https://myetal.app"
      }
    }
  }
}
```

Then build with `eas build --profile staging`. Internal distribution channel ("Expo Internal Testing") works on iOS without TestFlight.

---

## 4. Auto-deploy applies destructive Alembic migrations

The first time `feat/better-auth-migration` merges into `staging`, the deploy workflow on the Pi will run `alembic upgrade head` which TRUNCATES staging's `users` table. Nothing valuable is in the staging DB yet, so this is fine for the first run. **Important** for the prod side: when Railway is set up and `main` auto-deploys, the SAME thing will happen. The runbook flags this — recommend a manual-gate flag for the first prod deploy.

---

## 5. Mobile sign-out doesn't invalidate BA's session row (carry-over from BA known-limitations)

Already documented in `docs/tickets/done/better-auth-known-limitations.md` (lives on the BA branch — visible after merging). Mentioned here so the staging test plan accounts for it: a "signed out" mobile user could in theory still have a valid session-bearing JWT for up to 15 min. Test scenario worth running: sign out on mobile, then within 15 min try to use the stored token. Should 401 on `/me` because the JWT will hit FastAPI's verification (not BA's session check), but if the session is mid-rotation the JWT might still be valid. Don't be surprised by either outcome.

---

## Decisions needed before merging `feat/better-auth-migration` → `staging`

1. Pick option A / B / C for the web side (recommend A — Vercel preview).
2. Pick a Postgres-from-Vercel networking approach (recommend Cloudflare Tunnel).
3. Confirm OK with destructive Alembic auto-applying on first staging deploy (yes, expected).
4. Decide mobile EAS staging profile env values once #1 is decided.
