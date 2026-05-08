# Better Auth Migration

**Status:** Planning  
**Priority:** Medium (no user-facing urgency, but blocks MFA / password reset / magic links)  
**Estimated effort:** 3-4 weeks (1 week spike, 2-3 weeks implementation + migration)

---

## Context

MyEtAl currently uses a hand-rolled auth system:

- **Passwords:** Argon2-hashed, stored in `auth_identities` table with `provider=password`
- **JWTs:** HS256 access tokens (15 min TTL) signed with a shared `SECRET_KEY`
- **Refresh tokens:** Opaque, SHA-256 hashed at rest in `refresh_tokens` table, with family-based rotation and reuse detection
- **OAuth:** Custom FastAPI routes for GitHub, Google, ORCID (sandbox) via manual code exchange + userinfo fetch
- **Web:** httpOnly cookies (`myetal_access` / `myetal_refresh`), SameSite=Lax, with Next.js middleware gating `/dashboard/*`
- **Mobile:** `expo-secure-store` for native, `localStorage` fallback for Expo web dev

This works, but we're missing table-stakes features: password reset, email verification, MFA/2FA, magic links, account linking, and session management UI. Building all of those on top of the hand-rolled system means re-inventing what Better Auth already provides.

## What Better Auth gives us

Better Auth is a TypeScript-first, framework-agnostic auth library (v1.6+). It runs as a server-side handler mounted at `/api/auth/*` and manages its own database tables.

**Features we don't have and would get immediately:**

| Feature | Current state | Better Auth |
|---|---|---|
| Password reset | Not implemented | Built-in with configurable email callback |
| Email verification | Not implemented | Built-in, can require before login |
| MFA / 2FA | Not implemented | Built-in (TOTP, backup codes) |
| Magic links | Not implemented | Built-in plugin |
| Session management | Basic (list/revoke refresh tokens) | Full: list devices, revoke, session freshness, auto-refresh |
| Account linking | Not implemented (deliberately avoided for security) | Built-in with verification |
| Rate limiting | Custom slowapi on auth routes | Built-in at framework level |
| CSRF protection | Manual | Built-in token management |
| Passkeys / WebAuthn | Not implemented | Plugin available |

**Features that are already equivalent:**

- Email/password sign-up and sign-in
- OAuth with GitHub and Google
- Cookie-based sessions (Better Auth uses traditional sessions rather than JWTs by default)

## Architecture implications

This is the core design question: Better Auth is a **JS/TS library**. It cannot run inside FastAPI. The migration forces a rethink of where auth lives.

### Option A: Auth moves to Next.js, FastAPI becomes a pure data API

```
Browser/Mobile --> Next.js (Better Auth at /api/auth/*)
                      |
                      +--> FastAPI (validates Better Auth session tokens)
```

- Better Auth handler mounted in Next.js App Router at `app/api/auth/[...all]/route.ts`
- Better Auth manages its own tables (`user`, `session`, `account`, `verification`) in the same Postgres database
- FastAPI receives requests with the Better Auth session cookie or a Bearer token (Better Auth supports JWT-encoded cookie caches)
- FastAPI validates the session by either:
  - (a) Querying the `session` table directly (FastAPI already has SQLAlchemy access to the same Postgres)
  - (b) Validating a signed JWT cookie cache that Better Auth can produce (stateless, no DB query needed)
  - (c) Calling a lightweight validation endpoint on the Next.js side (adds latency)

**Recommended: Option (b)** -- configure Better Auth's `cookieCache` with `jwt` strategy, then FastAPI validates the JWT signature. This is very similar to what we do today, just with Better Auth minting the tokens instead of our hand-rolled code.

### Option B: Keep auth in FastAPI, use Better Auth only for the web client

This doesn't work well. Better Auth expects to own the auth flow end-to-end. Splitting it creates two sources of truth for sessions and users.

### Option C: Replace FastAPI entirely with a Node.js backend

Out of scope -- the FastAPI backend has substantial non-auth business logic (shares, discovery, works library, admin queue). Not worth rewriting.

**Recommendation: Option A.** Auth moves to Next.js. FastAPI becomes a session-validating data API.

## The ORCID question

ORCID is not a built-in Better Auth provider (the 40+ built-in providers don't include it). However, Better Auth has a **Generic OAuth Plugin** that supports any OAuth 2.0 / OIDC-compliant provider.

ORCID supports both OAuth 2.0 and OpenID Connect, so it is compatible. Configuration would look like:

```typescript
import { genericOAuth } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [
    genericOAuth({
      config: [{
        providerId: "orcid",
        clientId: process.env.ORCID_CLIENT_ID!,
        clientSecret: process.env.ORCID_CLIENT_SECRET!,
        discoveryUrl: "https://orcid.org/.well-known/openid-configuration",
        // or explicit endpoints for sandbox:
        // authorizationUrl: "https://sandbox.orcid.org/oauth/authorize",
        // tokenUrl: "https://sandbox.orcid.org/oauth/token",
        // userInfoUrl: "https://sandbox.orcid.org/oauth/userinfo",
        scopes: ["openid", "/read-limited"],
        mapProfileToUser: (profile) => ({
          name: profile.name,
          email: profile.email,
          image: null,
        }),
      }],
    }),
  ],
});
```

The sandbox vs production toggle would need env-based configuration, similar to what `orcid_use_sandbox` does today in `core/config.py`.

## Database schema changes

Better Auth creates and manages four core tables:

| Better Auth table | Our current equivalent | Migration notes |
|---|---|---|
| `user` | `users` | Can customize table name to `users`. Need to map `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`. Our `is_admin` and `avatar_url` become additional fields. |
| `session` | `refresh_tokens` | Different model. Better Auth sessions are server-side with token + expiry + IP + userAgent. Our refresh token rotation / family model goes away (Better Auth handles this internally). |
| `account` | `auth_identities` | Maps `provider` + `subject_id` + `password_hash`. Better Auth stores OAuth access/refresh tokens in this table too (we currently discard them). |
| `verification` | (doesn't exist) | New table for email verification tokens, password reset tokens, etc. |

### Migration strategy for existing data

1. **Users:** Map `users.id` (UUID) to Better Auth's user table. Better Auth supports UUID IDs. Our `is_admin` field becomes a custom additional field. `email` stays. `avatar_url` maps to `image`.

2. **Auth identities (password accounts):** For each `auth_identities` row with `provider=password`, create an `account` row with `providerId=credential`, `accountId=email`, and the existing `password_hash`. **Caveat:** Better Auth uses scrypt by default; our passwords are Argon2. We must configure Better Auth with a custom `hash`/`verify` that understands Argon2, or run a lazy re-hash on first login.

3. **Auth identities (OAuth accounts):** For each `auth_identities` row with `provider` in (github, google, orcid), create an `account` row with the matching `providerId` and `accountId` = `subject_id`.

4. **Refresh tokens / sessions:** These are ephemeral. We can drop all existing refresh tokens and force a re-login. Users sign in again and get Better Auth sessions. This is the simplest approach and acceptable given the small user base at this stage.

5. **Foreign keys:** Many tables reference `users.id`. If Better Auth takes over the `users` table (even with the same name and UUID PKs), existing FK relationships to shares, comments, favorites, works, etc. must be preserved. This is achievable if we keep the same UUIDs and table name.

## Impact by platform

### Next.js (apps/web)

**Changes needed:**

- Add Better Auth server config (`lib/auth.ts`) with database adapter pointing at existing Postgres
- Mount the handler at `app/api/auth/[...all]/route.ts`
- Replace `auth-cookies.ts` -- Better Auth manages its own session cookies
- Replace `server-api.ts` `getAccessToken()` -- use Better Auth's `auth.api.getSession()` server-side instead
- Replace `middleware.ts` -- use Better Auth's session check instead of raw cookie check
- Replace sign-in / sign-up pages to use `createAuthClient()` from `better-auth/react`
- Add new pages: password reset, email verification, MFA setup
- OAuth flow simplifies dramatically -- Better Auth handles the full redirect chain, no more `/auth/finish` fragment parsing

**Effort:** Medium-high. Most of the web auth code gets replaced, but with simpler Better Auth equivalents.

### React Native (apps/mobile)

**This is the tricky part.** Better Auth is designed for web (cookie-based sessions). Mobile apps can't use httpOnly cookies.

Options:
1. **Bearer token mode:** Better Auth has a `bearer` plugin that issues tokens for non-browser clients. The mobile app would authenticate via the Better Auth API and receive a bearer token to store in expo-secure-store.
2. **Keep the current mobile auth flow** hitting Better Auth's endpoints instead of our custom ones. The API surface is similar (POST to sign in, get back a session/token).
3. **Use the Better Auth React Native client** -- Better Auth provides a `createAuthClient` that can be configured for React Native with custom storage.

The mobile OAuth flow (expo-web-browser opening the API's `/auth/{provider}/start`) would need to be redirected to the Next.js Better Auth handler instead. The `mobile_redirect` deep-link bounce pattern we built might need adaptation.

**Effort:** Medium. The `useAuth` hook gets rewritten against Better Auth's client, but the UX flow is similar.

### FastAPI (apps/api)

**Changes needed:**

- Remove: `routes/auth.py`, `routes/oauth.py`, `services/auth.py`, `services/oauth.py`, `core/security.py` (most of it), `core/oauth.py`, `oauth_providers/`
- Remove: `auth_identities` and `refresh_tokens` models (Better Auth owns these tables now)
- Keep: `User` model, but it now reads from Better Auth's user table
- Add: Session validation middleware that extracts the Better Auth session cookie (or bearer token for mobile) and resolves it to a user ID. If using JWT cookie cache, this is just JWT decode with the Better Auth secret.
- Update: `CurrentUser` dependency to use the new session validation
- Update: `core/config.py` -- remove OAuth credentials (they move to Next.js env), keep `SECRET_KEY` (or share Better Auth's secret for JWT validation)

**Effort:** Medium. Lots of deletion, modest new code for session validation.

## Migration plan (phased)

### Phase 0: Spike (1 week)

- Set up Better Auth in a branch with the Next.js app
- Connect it to the dev Postgres
- Verify email/password, GitHub OAuth, and ORCID (generic plugin) all work
- Verify FastAPI can validate Better Auth JWT cookie cache
- Document any blockers

### Phase 1: Dual-mode auth (1 week)

- Deploy Better Auth alongside the existing auth system
- New sign-ups go through Better Auth
- Existing users can still sign in with old tokens (FastAPI accepts both)
- Run a data migration script that backfills Better Auth tables from `auth_identities` / `users`

### Phase 2: Cut over (1 week)

- Switch all clients (web + mobile) to Better Auth endpoints
- Remove old auth routes from FastAPI
- Force re-login for any sessions that weren't migrated
- Remove old `auth_identities` and `refresh_tokens` tables (keep a backup)

### Phase 3: New features (ongoing)

- Enable email verification requirement
- Add password reset flow
- Add MFA/2FA
- Add magic links
- Add account linking UI

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Better Auth doesn't support our Argon2 password hashes | Low (custom hash/verify is documented) | Configure custom password verifier on day 1 of spike |
| Mobile OAuth flow breaks | Medium | Spike must include mobile testing with expo-web-browser |
| Better Auth session validation adds latency to every FastAPI request | Low (JWT cookie cache is local decode) | Use JWT cookie cache strategy, benchmark during spike |
| Better Auth introduces breaking changes (it's pre-2.0) | Medium | Pin version, read changelogs, have rollback plan |
| ORCID generic OAuth plugin has edge cases | Medium | Test thoroughly in spike; ORCID sandbox is available |
| User ID mismatch after migration | Low (UUIDs, same DB) | Write migration script with dry-run mode, verify FK integrity |

## Rollback plan

- Keep the old auth code on a branch (don't delete it from git history)
- Keep old `auth_identities` and `refresh_tokens` tables for 30 days after cutover (renamed with `_deprecated` suffix)
- If Better Auth fails in production, revert the web/mobile deploys and re-enable old FastAPI auth routes
- Users would need to re-login (sessions are not cross-compatible), but no data is lost

## Open questions

1. **Should we wait for Better Auth 2.0?** The library is actively developed. If a stable 2.0 with breaking changes is imminent, it might be worth waiting. Check the roadmap.

2. **Do we need the FastAPI backend at all long-term?** If the app's data layer is simple enough, Next.js server actions + direct DB access could replace FastAPI entirely. This is a bigger architectural question beyond auth.

3. **How does this interact with the Neon migration?** Better Auth needs a database. If we migrate to Neon first, Better Auth connects to Neon. If we do Better Auth first, we migrate its tables along with everything else. **Recommendation:** Do the Neon migration first -- it's lower risk and Better Auth doesn't care which Postgres it connects to.

4. **Expo Router / Universal Links:** The mobile OAuth flow currently uses `expo-web-browser` with a `mobile_redirect` bounce. Better Auth may have a different pattern for mobile OAuth. Needs investigation in the spike.

5. **Email delivery:** Better Auth needs an email sender for password reset, verification, and magic links. We don't have email infrastructure yet. Options: Resend, Postmark, SES. This is a dependency that needs to be solved before Phase 3.
