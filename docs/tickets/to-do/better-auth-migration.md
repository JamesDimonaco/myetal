# Better Auth Migration

**Status:** Approved — ready to start (post Round-2 bake)
**Created:** original ticket pre-dated Round 2; planning notes folded in here.
**Last updated:** 2026-05-08 (rewritten — fresh-start path locked, FK audit added, decisions resolved)
**Owner:** James
**Effort estimate:** ~2 weeks (fresh-start path, no live users)
**Depends on:** none — this should land **before** the Railway migration so we're not migrating two foundations at once

---

## TL;DR

We have no real production users yet. Existing accounts are James + a handful of test rows on the Pi. That makes this the cheapest possible moment to rip out hand-rolled auth and replace it with Better Auth — because we get to do it as a **fresh-start cutover**, not a gradual dual-mode migration. One PR, one deploy, one email to the existing test users telling them to re-sign-up.

Better Auth runs as a Next.js Route Handler at `apps/web/src/app/api/auth/[...all]/route.ts`. **It does not replace FastAPI.** FastAPI keeps every domain endpoint it owns today (shares, library, browse, admin, feedback, tags, ORCID sync). The two communicate via a short-lived signed JWT in an httpOnly cookie that FastAPI's `get_current_user` verifies — same shape as today's `myetal_access` cookie, just minted by Better Auth instead of `core/security.py`.

After cutover we get email verification, password reset, and proper session management for free, and we can drop ~700 lines of custom auth code (`services/auth.py`, `services/oauth.py`, `core/security.py`'s password/JWT helpers, `oauth_providers.py`, `auth_identities` and `refresh_tokens` tables, the entire mobile manual-paste devjson dance).

---

## Why now

The cost curve only goes up. Every new user, every new FK to `users.id`, every comment / collection / collaboration feature that gets built on top of the hand-rolled `auth_identities` + `refresh_tokens` model is more rope to untangle later. Round 2 is done; Round 3 hasn't started; the table list is the smallest it will ever be again.

The owner's framing is the dispositive bit:

> *"Yeah let's start scoping out the better auth migration because that's something I would like to prioritise quickly actually. Before we go, proper users with Prod Prod, we should kind of use this instead to help us."*

Translation: nuking test accounts is fine. That single fact removes the three hardest pieces of work this ticket used to call for — dual-mode, account migration, and Argon2-aware lazy re-hash on first login.

---

## Scope: fresh-start, not gradual

**The plan:**

1. Cutover lands as a single PR + single deploy. New auth on Next.js, new schema in Postgres, new clients in web + mobile.
2. **All existing user rows are dropped.** Anyone with a test account (James, owner, a few invited testers) signs up again afterwards. ORCID sign-in then re-populates `orcid_id` automatically on first login.
3. Pre-cutover email goes to every test address from `auth_identities WHERE provider='password'` and `users WHERE email IS NOT NULL`: *"We're rebuilding the auth layer. Your account will be wiped on <date>. Please re-sign-up at myetal.app/sign-up after that — your library and any shares you created will need to be re-imported (ORCID sync handles works automatically)."*
4. The migration that creates Better Auth tables also `TRUNCATE`s every table that FK's `users.id` (see [FK audit](#fk-audit)). This is intentional — there is no half-state where a share row points at a dead user UUID.

**Why fresh-start is correct here, not just convenient:**

- The set of users we'd preserve is small enough that the social cost of "you need to re-sign-up" is one Slack message + one email.
- Dual-mode auth doubles the surface area of every endpoint that reads identity, and the bugs only show up under cross-mode sessions. Hard to test, easy to ship a footgun. With no real users, the whole problem class disappears.
- Argon2 → Better Auth verifier compatibility becomes a non-issue. We don't need to teach Better Auth to read our hashes; we just configure it with Argon2id from day one and every new sign-up uses the same scheme we use today.
- Rollback is simpler: revert the PR, redeploy, the prior schema is still in git. We accept "users lose their (test) sessions a second time" as the rollback cost.

**What dies in the cutover SQL:**

- All rows in `users`, `auth_identities`, `refresh_tokens`.
- All rows in every table downstream of `users.id` (see [FK audit](#fk-audit) — they all CASCADE or are explicitly truncated).
- The tables `auth_identities` and `refresh_tokens` are dropped entirely.

---

## Architecture

```
                  ┌─────────────────────────────────────────────┐
                  │  Next.js (apps/web) — Vercel-bound           │
                  │                                              │
   browser ──────►│  /api/auth/[...all]  ← Better Auth handler   │
                  │      • email/password (Argon2id)             │
                  │      • Google + GitHub built-in providers    │
                  │      • ORCID via genericOAuth plugin         │
                  │      • password reset + email verification   │
                  │      • mints session JWT, sets httpOnly      │
                  │        cookie `myetal_session`               │
                  │                                              │
                  │  app/(authed)/* + middleware.ts read session │
                  │  via Better Auth's server helper             │
                  └─────────────────────────────────────────────┘
                                       │
                                       │  forwards `myetal_session`
                                       │  cookie + (mobile) Bearer
                                       ▼
                  ┌─────────────────────────────────────────────┐
                  │  FastAPI (apps/api) — Pi → Railway           │
                  │                                              │
                  │  api/deps.py::get_current_user               │
                  │      verifies JWT signature with shared      │
                  │      BETTER_AUTH_JWT_PUBLIC_KEY (or HS256    │
                  │      shared secret), reads `sub` = user.id   │
                  │                                              │
                  │  Domain endpoints unchanged: shares, papers, │
                  │  library, browse, admin, feedback, tags,     │
                  │  ORCID sync.                                 │
                  └─────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  Postgres         │
                              │  Better Auth      │
                              │  tables + our     │
                              │  domain tables    │
                              └──────────────────┘

   Mobile (apps/mobile) hits Better Auth's REST endpoints directly
   (POST /api/auth/sign-in/email, /sign-up/email, OAuth via
   WebBrowser.openAuthSessionAsync), receives the same session JWT
   in a Bearer token, stores it in expo-secure-store. FastAPI
   accepts both Authorization: Bearer <jwt> and the cookie.
```

**Why the JWT-in-cookie pattern, not Better Auth's default DB sessions:**

- FastAPI does not run Better Auth and cannot call its `auth.api.getSession()`. To verify a DB session it would have to query the `session` table directly on every request — fine, but it makes us couple FastAPI to Better Auth's schema in a way that breaks when BA upgrades.
- A signed JWT is verifiable with the public key alone. Stateless, no DB hit, no schema coupling. Better Auth has a [JWT plugin](https://www.better-auth.com/docs/plugins/jwt) that issues a JWT alongside the session and rotates the key automatically. Lock that.
- We lose server-side revocation granularity: revoking a Better Auth session doesn't immediately kill its JWT (until expiry). Solve by keeping JWT TTL short (~15 min, same as today), and by issuing only short-lived access JWTs while Better Auth holds the long-lived session row that mints them.

---

## User table strategy: Better Auth's `additionalFields`

**Decision: option (a) — Better Auth's `user` table is canonical, with our domain columns added via `additionalFields`.**

Better Auth supports adding custom columns to its core tables through the [`user.additionalFields`](https://www.better-auth.com/docs/concepts/database#extending-core-schema) config. We use this to keep `is_admin`, `avatar_url`, `orcid_id`, `last_orcid_sync_at` on the same row Better Auth manages. The shape:

```typescript
// apps/web/src/lib/auth.ts (new file)
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),

  user: {
    additionalFields: {
      is_admin:           { type: "boolean", defaultValue: false, input: false },
      avatar_url:         { type: "string",  required: false,    input: false },
      orcid_id:           { type: "string",  required: false,    input: false, unique: true },
      last_orcid_sync_at: { type: "date",    required: false,    input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    password: {
      hash:   (password) => argon2.hash(password, ARGON2_PARAMS),
      verify: ({ password, hash }) => argon2.verify(hash, password),
    },
  },

  // ...providers, plugins below
});
```

`input: false` means the columns are not settable via the public sign-up API — only by server code (the ORCID hijack-hardening helper, the admin allowlist sync, etc).

**Why not (b) `user_profile` table:** every join we do today (`Share.owner_id` → `users.id` joining for `user.name` on browse) would gain a second join. No upside; just slower and uglier.

**Why not (c) keep our `users`, mirror BA into it:** Better Auth's drizzle adapter expects to own the table. Pretending otherwise puts us back in the same custom-glue territory we're trying to delete.

**Column mapping (final shape of the `user` table after migration):**

| Column | Source | Notes |
|---|---|---|
| `id` | Better Auth core | UUID, primary key |
| `name` | Better Auth core | nullable |
| `email` | Better Auth core | unique, validated by BA |
| `email_verified` | Better Auth core | new — we don't track this today |
| `image` | Better Auth core | renamed from `avatar_url`; see below |
| `created_at` / `updated_at` | Better Auth core | replaces our `TimestampMixin` columns |
| `is_admin` | additionalField | preserved |
| `avatar_url` | additionalField | **kept under our name** (Better Auth's `image` is a separate column we ignore for now — saves a rename across the codebase) |
| `orcid_id` | additionalField | preserved with `unique: true` |
| `last_orcid_sync_at` | additionalField | preserved |

The duplication of `image`/`avatar_url` is deliberate: it keeps every existing FastAPI selection (`User.avatar_url`) and every web/mobile component working without a rename pass. We can collapse to `image` post-cutover if it bothers us.

---

## OAuth providers

**Three providers, two integration paths:**

```typescript
// apps/web/src/lib/auth.ts (continued)

import { betterAuth } from "better-auth";
import { genericOAuth, jwt } from "better-auth/plugins";

export const auth = betterAuth({
  // ...

  socialProviders: {
    google: {
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId:     process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  plugins: [
    jwt({ /* see Sessions section below */ }),

    genericOAuth({
      config: [
        {
          providerId:   "orcid",
          clientId:     process.env.ORCID_CLIENT_ID!,
          clientSecret: process.env.ORCID_CLIENT_SECRET!,

          // Sandbox-vs-prod toggle: read at config time. Better Auth
          // re-reads the config on each request, so process.env changes
          // pick up without a redeploy if we ever flip the env var.
          ...(process.env.ORCID_USE_SANDBOX === "true"
            ? {
                authorizationUrl: "https://sandbox.orcid.org/oauth/authorize",
                tokenUrl:         "https://sandbox.orcid.org/oauth/token",
                userInfoUrl:      "https://sandbox.orcid.org/oauth/userinfo",
              }
            : {
                discoveryUrl: "https://orcid.org/.well-known/openid-configuration",
              }),

          scopes: ["openid", "/read-limited"],

          // Run our hijack-hardening logic before the user row is created.
          // This is the one piece of services/oauth.py that survives — pulled
          // into a small helper at lib/auth-orcid-claim.ts.
          mapProfileToUser: async (profile) => {
            await assertOrcidIdNotClaimedElsewhere(profile.sub); // throws on dup
            return {
              name:     profile.name,
              email:    profile.email ?? null,
              orcid_id: profile.sub,           // additionalField
            };
          },
        },
      ],
    }),
  ],
});
```

**ORCID hijack-hardening preserved.** The current `services/oauth.py::_find_or_create_user` refuses to create or attach a user when the ORCID iD is already linked to another account. That logic moves verbatim into a small TS helper (`lib/auth-orcid-claim.ts`) called from `mapProfileToUser`. Same security property: a malicious ORCID account that returns someone else's email cannot hijack their MyEtAl account. We deliberately do **not** auto-link by email post-cutover either — same posture as today.

**Sandbox toggle.** Today's `core/config.py::orcid_use_sandbox` becomes `process.env.ORCID_USE_SANDBOX` on the Next.js side. Default is prod ORCID. Set in `.env.local` for the Pi dev environment.

---

## Password hashing: Argon2id (custom verifier)

Lock Argon2id end-to-end. Better Auth's `emailAndPassword.password` config takes a `hash` and `verify` pair — we point both at `argon2` (Node binding to the same `argon2` algorithm we use server-side today via passlib).

```typescript
import argon2 from "argon2";

const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19_456,  // 19 MiB — same as passlib defaults; benchmark on Vercel
  timeCost: 2,
  parallelism: 1,
};

emailAndPassword: {
  enabled: true,
  password: {
    hash:   (password) => argon2.hash(password, ARGON2_PARAMS),
    verify: ({ password, hash }) => argon2.verify(hash, password),
  },
},
```

**Note on Vercel cold starts:** Argon2id is intentionally CPU-expensive. Benchmark `argon2.hash()` in a Vercel function during the spike — if p99 sign-in goes over ~500 ms we step memoryCost down. Worst case we accept slightly weaker params on the web than on the API; the threat model is "stop offline cracking of a stolen DB dump" and the params we pick still need to make that infeasible.

**No lazy re-hash logic needed.** Because we're nuking the existing `auth_identities.password_hash` rows in the cutover, we never need to verify a passlib-formatted hash against a Better Auth `verify`. Fresh-start is doing real work for us here.

---

## Sessions: JWT in httpOnly cookie

Better Auth's defaults are DB sessions. For us, the [JWT plugin](https://www.better-auth.com/docs/plugins/jwt) is correct because FastAPI needs to verify identity statelessly.

```typescript
import { jwt } from "better-auth/plugins";

plugins: [
  jwt({
    jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
    jwt: {
      expirationTime: "15m",
      definePayload: ({ user }) => ({
        sub:      user.id,
        email:    user.email,
        is_admin: user.is_admin,
      }),
    },
  }),
],
```

- Better Auth issues a session-bound JWT alongside its normal session cookie. FastAPI verifies the JWT using JWKS exposed at `/api/auth/jwks`.
- Cookie name: `myetal_session` (rename from today's `myetal_access` so middleware can't accidentally use the wrong code path during overlap).
- TTL: 15 min (matches today). The Better Auth session row backing it lives 30 days (matches today's refresh).
- Refresh: Better Auth handles. The web middleware shrinks to ~10 lines (just check session, don't roll its own refresh dance).

**Mobile.** `expo-secure-store` stores the JWT as a Bearer. FastAPI's `get_current_user` already accepts `Authorization: Bearer <token>` (see `apps/api/src/myetal_api/api/deps.py:11`). The change there is what to verify — JWKS public key instead of `SECRET_KEY` HS256 — not the protocol.

---

## Email provider: Resend

**Lock Resend.** Reasons:

- React-Email–native templating. Ships well with Next.js.
- 3,000 emails/month on the free tier — vastly more than v1 password-reset traffic.
- Founder-maintained, current. Active on roadmap.
- Postmark and SES both work fine but Resend's API is by far the simplest for the volume we're at.

Env vars:

```bash
RESEND_API_KEY=re_xxx
EMAIL_FROM="MyEtAl <noreply@myetal.app>"
```

**What we send in v1:**

1. **Password reset** — Better Auth's built-in flow, callback wires Resend.
2. **Email verification** — *recommended but optional for v1*. See [open questions](#open-questions-for-owner). If we enable it, sign-up sends the verification email; sign-in works without verification (i.e. soft requirement).

That's it. No magic links, no 2FA, no marketing in v1. Resend account + DNS (DKIM/SPF on the `myetal.app` domain) is a one-time setup, ~30 minutes.

---

## FK audit

Every table in `apps/api/src/myetal_api/models/` that references `users.id`, with the migration outcome.

| Table | FK column | On-delete | Outcome in cutover |
|---|---|---|---|
| `auth_identities` | `user_id` | CASCADE | **DROP TABLE.** Replaced by Better Auth's `account` table. |
| `refresh_tokens` | `user_id` | CASCADE | **DROP TABLE.** Replaced by Better Auth's `session` table. |
| `shares` | `owner_id` | CASCADE | TRUNCATE (no real share data; testers re-create after re-sign-up). FK preserved — points at the new BA `user` table, same UUID type. |
| `share_views` | `viewer_id` | SET NULL | TRUNCATE (analytics; nothing to keep). |
| `share_reports` | `reporter_id` | SET NULL | TRUNCATE. |
| `share_reports` | `resolved_by_id` | SET NULL | TRUNCATE (same table). |
| `share_papers` | `created_by_id` | SET NULL | TRUNCATE. |
| `user_papers` | `user_id` | CASCADE | TRUNCATE (test library entries; ORCID re-imports populate after re-login). |
| `orcid_sync_runs` | `user_id` | CASCADE | TRUNCATE (audit log; nothing to preserve). |
| `feedback` | `user_id` | (no FK — column-only `Uuid`, nullable) | **TRUNCATE** explicitly even though no FK enforces it. Otherwise we leave dangling UUIDs. |

**Tables that do NOT FK to `users.id` and survive intact:**
- `papers` (canonical Crossref-keyed work metadata — owner-agnostic)
- `tags`, `share_tags` (topical labels — share-keyed only)
- `share_similar`, `trending_share` (denormalised discovery caches — re-populate on next worker run)

**Migration order in the single Alembic step:**

1. `TRUNCATE feedback;` (no FK; do explicitly)
2. `TRUNCATE share_reports, share_views, share_papers, user_papers, orcid_sync_runs, shares, refresh_tokens, auth_identities, users RESTART IDENTITY CASCADE;`
3. `DROP TABLE auth_identities;`
4. `DROP TABLE refresh_tokens;`
5. `ALTER TABLE users` to match Better Auth's expected schema. Add `email_verified BOOLEAN`, ensure `created_at` / `updated_at` column names match BA's expectations (today they're `TimestampMixin`'s — verify naming matches `createdAt`/`updatedAt` or add a column-name override in the Drizzle schema).
6. Better Auth runs its own migration for `session`, `account`, `verification`, and the JWKS table (`jwks`) on first boot of the Next.js handler.

**Note on `users.id` UUID compatibility:** Better Auth's drizzle adapter can be told the ID column type. Set it to `uuid` to keep our existing FK columns (which are `Uuid` in SQLAlchemy / `uuid` in Postgres) compatible. Verify in Phase 0 spike.

---

## Phases (concrete)

### Phase 0 — spike (1 day)

- New branch. Add `better-auth` + `argon2` + drizzle deps in `apps/web`.
- Create `apps/web/src/lib/auth.ts` minimally: email+password, drizzle pointed at the dev Postgres on the Pi, additionalFields stub.
- Mount `/api/auth/[...all]/route.ts`.
- Curl `POST /api/auth/sign-up/email` → confirm a session cookie returns and a `user` row exists.
- Stand up the JWT plugin. Curl `/api/auth/token` → confirm a JWT comes back.
- In FastAPI: write a single throwaway route `/healthz/auth` that calls a new `verify_better_auth_jwt(token)` helper and returns the decoded `sub`. Curl that route with the JWT from the previous step. **Goal: prove cross-stack identity.**
- Document anything weird (drizzle pg type choice, BA version pinned).

**Exit criterion:** signed JWT minted in Next.js, verified in Python.

### Phase 1 — data model (2 days)

- Write the new Drizzle schema for the `user` table with additionalFields.
- Write the Alembic migration that does the full FK audit work above (truncate, drop, alter).
- Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `ORCID_USE_SANDBOX` to `.env.example` and `core/config.py`.
- Migrate `core/config.py` to remove `SECRET_KEY`'s password-hashing role (keep it only for any non-auth signing we still need; audit usage).
- Add `BETTER_AUTH_JWKS_URL` and the JWKS verify helper in `apps/api/src/myetal_api/core/security.py`.

**Exit criterion:** `alembic upgrade head` on a fresh dev DB produces a Better-Auth-shaped schema; `pytest` still green for non-auth tests; auth tests are red (expected).

### Phase 2 — server cutover (3 days)

- Rewrite `api/deps.py::get_current_user` to verify the BA JWT (cookie or Bearer) via JWKS. Drop `decode_access_token`.
- Delete `services/auth.py`, `services/oauth.py`, `core/oauth.py`, `oauth_providers.py`, `api/routes/auth.py`, `api/routes/oauth.py`.
- Delete `models/auth_identity.py`, `models/refresh_token.py`, the `models/__init__.py` exports for them.
- Delete `core/security.py`'s password and refresh-token helpers; keep only what's still used elsewhere (probably nothing — `SECRET_KEY` for OAuth state JWTs goes away with `services/oauth.py`).
- Move ORCID hijack-hardening into `lib/auth-orcid-claim.ts` on the **web** side. Keep PATCH `/auth/me { orcid_id }` flow on FastAPI for *manual* ORCID iD entry — that is not an OAuth flow and still needs the dup check. Today's `services/auth.py::set_user_orcid_id` is the function that survives; move it to `services/users.py`.
- Rewrite `pytest` auth fixtures to mint test BA-style JWTs (sign with the JWKS dev key).

**Exit criterion:** every existing pytest passes; `auth_identities` and `refresh_tokens` not in the codebase; `grep -r "decode_access_token" apps/api` returns nothing.

### Phase 3 — web cutover (3 days)

- Replace `apps/web/src/lib/auth-cookies.ts` with calls into Better Auth's session helpers. Delete the file.
- Rewrite `apps/web/src/middleware.ts` — drop the JWT-decode-and-refresh dance; replace with `auth.api.getSession()` server-side.
- Delete `apps/web/src/app/api/auth/cookie-set/route.ts` and the `login` / `logout` / `register` route handlers under `apps/web/src/app/api/auth/` — Better Auth's catch-all replaces them.
- Rewrite `/sign-in`, `/sign-up`, `/auth/finish` to call `authClient.signIn.email()` / `authClient.signIn.social({ provider })` from `better-auth/react`.
- Delete the OAuth fragment-parsing logic — Better Auth's redirect chain handles cookies.
- Add new pages: `/forgot-password`, `/reset-password`, `/verify-email`. Use Better Auth's React components or hand-roll thin UI.

**Exit criterion:** sign-up, sign-in, sign-out, password reset, ORCID OAuth, Google OAuth, GitHub OAuth all work end-to-end on dev. `next build` clean. `tsc --noEmit` clean.

### Phase 4 — mobile cutover (2 days)

- Rewrite `apps/mobile/hooks/useAuth.ts`. The shape stays similar (`signIn`, `signUp`, `signOut`, `signInWith{Google,GitHub,Orcid}`) but each calls Better Auth's REST endpoints directly:
  - `POST /api/auth/sign-in/email` → returns session JWT + user.
  - `POST /api/auth/sign-up/email` → same.
  - For OAuth, hit `/api/auth/sign-in/social/{provider}` with `callbackURL` pointing at the mobile redirect — same `WebBrowser.openAuthSessionAsync` flow as today, just hitting the Next.js handler instead of FastAPI's `/auth/{provider}/start`.
- `lib/api.ts`: drop the refresh-on-401 logic; let Better Auth's session cookie path handle that. Keep the Bearer header injection.
- `lib/auth-storage.ts`: drop the `refresh_token` field; only the JWT lives now.
- Delete the dev-only "manual paste" devjson code path entirely (`consumeDevJsonTokens`). Better Auth's deep-link redirect makes it unnecessary.

**Exit criterion:** Expo Go and dev build can sign-in / sign-up / OAuth on the Pi backend. `tsc --noEmit` in `apps/mobile` clean.

### Phase 5 — ORCID re-attach (1 day)

- ORCID sandbox sign-in end-to-end on dev: empty user → ORCID redirect → returns to web with session → `users.orcid_id` populated.
- Manual ORCID iD entry via PATCH `/auth/me` still works (the surviving `services/users.py::set_user_orcid_id`).
- ORCID hijack: try to sign in with a second account via the same ORCID iD on a fresh user → expect the `assertOrcidIdNotClaimedElsewhere` error, expect a clean redirect to `/sign-in?error=orcid_already_linked`.
- `last_orcid_sync_at` set-to-NULL semantics on iD change still works.

**Exit criterion:** the ORCID smoke matrix from `done/orcid-integration-and-account-linking.md` passes against the new flow.

### Phase 6 — test sweep (1 day)

- Full `pytest` in `apps/api` — every test that mocks auth needs the BA-JWT fixture, not the legacy one.
- `tsc --noEmit` in `apps/web` and `apps/mobile`.
- Manual smoke: sign-up → email verification email arrives → click link → land on `/dashboard` → create a share → sign-out → password reset email arrives → reset → sign-in.
- ORCID, Google, GitHub OAuth one-pass each on web. ORCID + GitHub on mobile (Google requires real OAuth client credentials for mobile; if not ready, defer that one to a follow-up).
- Admin allowlist: confirm `is_admin` flag round-trips into the JWT, FastAPI's `require_admin` dep still gates `/admin/*`.

**Exit criterion:** every checkbox in the [acceptance checklist](#acceptance-checklist) ticked.

### Buffer (~2 days)

For things we'll discover. Almost certainly something around drizzle pg type coercion (Better Auth's UUIDs vs ours) or Vercel cold-start Argon2 cost.

---

**Realistic envelope: ~2 weeks (with fresh-start). 3-4 weeks if we discover dual-mode is needed** (e.g. some integration we forgot is depending on stable `users.id` UUIDs across the migration). The fresh-start commitment is what lets us call the lower number.

---

## What we're NOT doing in this migration

Explicit non-scope. Each is fine to revisit post-cutover; none of them block sign-in working end-to-end.

- Gradual / dual-mode migration. Single cutover only.
- Account-merge UI for users with both an ORCID and a password account.
- 2FA / TOTP. Better Auth supports it; defer to a separate ticket.
- Magic-link sign-in. Same — defer.
- Passkeys / WebAuthn. Defer.
- Session-management UI (list devices, revoke a single session). Today's `/auth/me/sessions` endpoint goes away with `services/auth.py`; rebuild on Better Auth post-cutover if/when users complain.
- Email-as-marketing-channel. Resend is wired only for transactional in v1.
- Migrating off Pi onto Railway. Strictly after this ticket — that's [`railway-migration-future`](railway-migration-future.md).

---

## Sequencing vs Railway

**Recommendation: Better Auth first, Railway second.**

Reasons:

- The auth migration is a one-shot cutover; doing it on infra we control fully (the Pi) means fewer moving parts when we're debugging "why does the JWKS endpoint not respond from FastAPI." Railway adds DNS, build pipelines, and managed-Postgres networking on top — all things we don't want to debug *during* an auth cutover.
- Railway's deploy will need every new env var (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `BETTER_AUTH_JWKS_URL`, etc.) on day one. Better to define the env contract once, against a Pi that we already understand, and then port a settled contract to Railway.
- The Round-2 ticket specifically says Railway happens *"after Round 2 bakes for 2-4 weeks."* Better Auth slots into that bake window and arrives at Railway as a settled component.

Update `INDEX.md`: keep Better Auth as **#1**, Railway as **#2**. Effort estimate on the Better Auth row drops from `~3-4 weeks` to `~2 weeks`.

---

## Acceptance checklist

- [ ] Fresh `/sign-up` on web with email+password creates a `user` row, sets `myetal_session` cookie, mints a verifiable JWT.
- [ ] FastAPI's `GET /auth/me` returns 200 with the new cookie / Bearer.
- [ ] Every domain endpoint (random sample: `GET /shares`, `POST /me/works/sync-orcid`, `GET /admin/share-reports`) 200s with the new JWT and 401s without.
- [ ] ORCID sign-in (sandbox) creates a user with `orcid_id` populated.
- [ ] ORCID sign-in attempt on an ORCID iD already linked to another user: clean redirect to `/sign-in?error=orcid_already_linked`. **No duplicate user row created.**
- [ ] PATCH `/auth/me { orcid_id: "0000-..." }` still works for manual entry. Returns 409 on duplicate.
- [ ] Google OAuth and GitHub OAuth round-trip on web.
- [ ] Mobile (Expo Go + dev build) email sign-in, sign-up, sign-out, ORCID OAuth.
- [ ] Password reset email arrives via Resend, link works, new password verifies.
- [ ] `is_admin` flag round-trips through the JWT; admin-only endpoints (`/admin/*`) still gate via `require_admin`.
- [ ] No reference to `auth_identities`, `refresh_tokens`, `decode_access_token`, `hash_password`, `verify_password` anywhere in the codebase post-cutover (`grep -r`).
- [ ] No Argon2 hash drift: hashes produced by Better Auth verify under our chosen `argon2` params; spot-check with a known plaintext.
- [ ] All test accounts from before cutover are gone. Pre-cutover email sent.
- [ ] `pytest` clean in `apps/api`. `tsc --noEmit` clean in `apps/web` and `apps/mobile`.
- [ ] `next build` clean in `apps/web`.
- [ ] On rollback: revert PR, redeploy, prior auth flow restored. (Tested by rolling back on dev once during Phase 6.)

---

## Open questions for owner

Genuinely unresolved. Everything else is locked.

1. **Email verification: required to sign-in, or soft (sent but not enforced)?**
   Recommendation: **soft for v1**. We send the verification email on sign-up but don't gate sign-in on it. Reduces support friction during the early-users window; we can flip to hard later by toggling Better Auth's `requireEmailVerification: true`. Confirm or override.

2. **Resend account ownership.** Who creates and pays for the Resend account, and on which domain? Recommendation: create on `myetal.app` under James's email; free tier covers v1 by a wide margin.

3. **2FA in this ticket or future?**
   Recommendation: **future ticket**. Better Auth's TOTP plugin is a one-day add post-cutover; doing it now bloats the runbook and adds a UX surface (recovery codes, enrollment) that needs design.

4. **Pre-cutover comms timing.** When do we send the "we're nuking your test account" email? Recommendation: 7 days before merge of the cutover PR, then again 24h before. Names on the list: James (owner), 1-2 testers from the Round-2 thread.

---

## Triggers to re-evaluate

When would we want to revisit this architecture?

- **Better Auth ships a breaking 2.0** that materially changes the JWT plugin's contract. Pin the version; read changelogs at upgrade time.
- **We need session revocation finer than BA provides** (e.g. "force sign-out every session for user X within 30 seconds"). Today's plan accepts up-to-15-minute window between revoke and JWT expiry. If we ever need real-time revocation, we move to a database-session check or shorten JWT TTL.
- **2FA design surfaces a need** for a richer session/device model than BA exposes.
- **Mobile native auth (passkeys, Apple/Google sign-in via OS prompt)** becomes a priority — Better Auth's passkey plugin works for web; mobile needs OS integration that may push us to a different shape.
- **Argon2 verifier compat changes.** If BA's `password.hash`/`verify` API changes shape we re-derive the wiring; not architectural.

None of these are likely in the next 6 months.
