# Better Auth — ORCID flow audit + smoke matrix (Phase 5)

**Status:** SHIPPED
**Created:** 2026-05-08
**Owner:** James
**Depends on:** Phases 1–4 of `to-do/better-auth-migration.md` (delivered on `feat/better-auth-migration`).
**Predecessors:**
* `done/orcid-integration-and-account-linking.md` — original ORCID
  hijack-hardening posture (carried forward).
* `done/orcid-import-and-polish.md` — ORCID public-API sync wiring.
* `done/better-auth-migration` Phases 1–4 — the auth cutover this
  layer rides on top of.

This document is the post-Phase-5 record. Two halves:

1. **Code-trace audit** — every ORCID path from user click to DB
   write, citing `file:line`. Six paths.
2. **Smoke matrix** — the runbook the user executes against the dev /
   staging Pi after deploy.

A short section at the end calls out fixes that landed during this
audit and the open Phase 6 prereqs.

---

## 1. Code-trace audit

### 1.1 Web OAuth — happy path

User on `apps/web` clicks **Continue with ORCID** on the sign-in page.

| Step | Where | What happens |
|---|---|---|
| 1 | `apps/web/src/app/sign-in/oauth-buttons.tsx` (client component invoked from `apps/web/src/app/sign-in/page.tsx:82`) | Client calls `authClient.signIn.oauth2({ providerId: 'orcid', callbackURL })`. |
| 2 | Better Auth route handler at `apps/web/src/app/api/auth/[...all]/route.ts` (catch-all mount) | BA delegates to the `genericOAuth` plugin. |
| 3 | `node_modules/.../better-auth/dist/plugins/generic-oauth/routes.mjs:42-108` (`signInWithOAuth2` endpoint) | BA reads our config at `apps/web/src/lib/auth.ts:296-326`, builds the authorization URL using either the discovery doc (prod) or the explicit endpoints (sandbox — `apps/web/src/lib/auth.ts:114-123`), generates state, returns `{ url, redirect: true }`. |
| 4 | Browser redirect → ORCID consent page | User approves. ORCID redirects to BA's callback at `${BETTER_AUTH_URL}/api/auth/oauth2/callback/orcid?code=...&state=...`. |
| 5 | `node_modules/.../better-auth/dist/plugins/generic-oauth/routes.mjs:116-288` (`oAuth2Callback` endpoint) | BA exchanges the `code` for tokens (line 187), fetches user info (`getUserInfo`, line 381 — prefers ID token JWT decode, falls back to userinfo URL). |
| 6 | `apps/web/src/lib/auth.ts:307-322` (`mapProfileToUser`) | Our hook runs. It reads `profile.sub` (or `profile.orcid` as fallback), calls `assertOrcidIdNotClaimedElsewhere` (`apps/web/src/lib/auth-orcid-claim.ts:80-138`), and returns `{ name, email, orcid_id }`. |
| 7 | `node_modules/.../better-auth/dist/oauth2/link-account.mjs:7` (`handleOAuthUserInfo`) | BA looks up `findOAuthUser(email, accountId, providerId)`. **Implicit account-linking is disabled** (`apps/web/src/lib/auth.ts:218-224` — see audit issue #2), so a user existing only via email/password is NOT auto-attached. New ORCID-only users land in the `else` branch at `link-account.mjs:71-117` → `createOAuthUser` writes both the `users` row (with `orcid_id` populated via additionalFields) and an `account` row keyed on `(provider_id='orcid', account_id=<orcid iD>)`. |
| 8 | `node_modules/.../better-auth/dist/oauth2/link-account.mjs:123` | BA creates a session row. |
| 9 | `node_modules/.../better-auth/dist/plugins/generic-oauth/routes.mjs:277-280` | BA sets the session cookie (`myetal_session` per `apps/web/src/lib/auth.ts:217-227`). |
| 10 | `apps/web/src/lib/auth.ts:280-294` (`jwt` plugin) | The JWT plugin issues a 15-min Ed25519 JWT alongside the session, signed with the active key from the `jwks` table. |
| 11 | Browser receives 302 to `callbackURL` (typically `/dashboard`). | `apps/web/src/middleware.ts` reads the session cookie via BA's server helper; FastAPI routes verify the JWT via `apps/api/src/myetal_api/api/deps.py:88-123` + `apps/api/src/myetal_api/core/ba_security.py`. |

**Env vars required:** `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`,
`ORCID_USE_SANDBOX` (web side); `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `DATABASE_URL` (BA core); `BETTER_AUTH_JWKS_URL`
on the FastAPI side (auto-derives from `BETTER_AUTH_URL`).

**Sandbox toggle:** `apps/web/src/lib/auth.ts:114` — single
`process.env.ORCID_USE_SANDBOX === 'true'` read at module import. The
explicit sandbox endpoints (`sandbox.orcid.org/oauth/{authorize,token,userinfo}`)
are used because ORCID's sandbox does NOT publish a discovery document.

**Where errors surface:**

* Network failure pre-callback → BA's default error page
  (`/api/auth/error`).
* Provider returned `error=...` query → 302 to
  `${errorURL}?error=...` (line 135).
* Token exchange failed → 302 to `${errorURL}?error=oauth_code_verification_failed` (line 204).
* `mapProfileToUser` throws `OrcidIdAlreadyLinkedError` → controlled
  302 to `/sign-in?error=orcid_already_linked` (see path 1.2).
* `email_is_missing` / `name_is_missing` from BA's user-info
  defaults → 302 with that error code.
* Sign-in page maps known error codes to friendly sentences at
  `apps/web/src/app/sign-in/page.tsx:17-37`.

### 1.2 Web OAuth — hijack-attempt path

User A previously claimed ORCID iD `0000-0001-2345-6789` (either via
ORCID OAuth or via the manual `PATCH /me/orcid` path). User B signs
into MyEtAl through email/password, signs out, then attempts to sign
in with that same ORCID iD.

| Step | Where | What happens |
|---|---|---|
| 1–5 | Same as 1.1. | Token exchange completes, BA fetches user info. |
| 6 | `apps/web/src/lib/auth-orcid-claim.ts:80-138` (`assertOrcidIdNotClaimedElsewhere`) | Looks up `users` by `orcid_id`. Finds User A. Then looks up the `account` table for `(provider_id='orcid', account_id=<orcid iD>)` to distinguish the two shapes the iD can be in: |
| 6a | (re-login) `account` row exists AND `account.user_id === claimingUserId` | Allowed; no error. This branch protects the legitimate "same user signs in via ORCID twice" case from being mis-flagged as a hijack. |
| 6b | (hijack) `account` row missing OR pointing at a different user row | Throw `APIError("FOUND", ..., {Location: '/sign-in?error=orcid_already_linked'})`. |
| 7 | `node_modules/.../better-call/dist/to-response.mjs:114-118` | Better Auth's router (better-call) sees an APIError with status `FOUND`, builds a 302 response with the `Location` header from our throw. |
| 8 | Browser redirects to `${BETTER_AUTH_URL}/sign-in?error=orcid_already_linked`. |
| 9 | `apps/web/src/app/sign-in/page.tsx:17-21` (`describeError`) | The hijack code is in `ORCID_HIJACK_ERROR_CODES`; renders "This ORCID iD is already linked to another account…". |

**No duplicate user row is created** — the throw fires before
`handleOAuthUserInfo` runs (i.e. before `createOAuthUser`). `account`
table is also unaffected.

**Threat-model invariant preserved:** ORCID iD is the only trusted
identifier ORCID returns; an attacker who controls an ORCID account
whose email matches a MyEtAl user CANNOT hijack that user, because
implicit linking by email is disabled (audit issue #2) and ORCID iDs
are unique to actual ORCID accounts.

**Mobile UX caveat in this path.** The same throw redirects to the
web `/sign-in` page regardless of whether the OAuth flow originated
from the web app or the mobile app's in-app browser. For mobile this
means the in-app browser stays open on the web sign-in page rather
than auto-closing via the `myetal://` deep link — the user has to
tap "Back" / dismiss manually. Acceptable v1 UX for a rare path; if
we need to fix this later, route through `mobile-bounce` with an
error param. Documented for future-James.

### 1.3 Mobile OAuth — happy path

User on `apps/mobile` taps **Continue with ORCID**.

| Step | Where | What happens |
|---|---|---|
| 1 | `apps/mobile/app/sign-in.tsx:172-189` | Pressable invokes `signInWithOrcid` from `useAuth`. |
| 2 | `apps/mobile/hooks/useAuth.ts:271-275` | Calls `runOAuthFlow('/api/auth/sign-in/oauth2/orcid', 'orcid')`. |
| 3 | `apps/mobile/hooks/useAuth.ts:228-258` (`runOAuthFlow`) | Builds `returnUrl = Linking.createURL('/auth/callback')` (resolves to `myetal://auth/callback` on dev build, `exp+myetal://...` in Expo Go). Builds `bounceUrl = ${WEB_BASE_URL}/auth/mobile-bounce?return=<returnUrl>`. Opens `WebBrowser.openAuthSessionAsync(startUrl, returnUrl)` where `startUrl` is BA's OAuth start URL with `callbackURL=<bounceUrl>`. |
| 4 | In-app browser → BA's `/api/auth/sign-in/oauth2/orcid` (POST behind a 302) → ORCID consent → BA's `/oauth2/callback/orcid` | Same chain as path 1.1 steps 4–10. BA writes the session cookie on the web origin and 302s the in-app browser to `bounceUrl`. |
| 5 | `apps/web/src/app/auth/mobile-bounce/page.tsx` | Server component reads the session via `auth.api.getSession({ headers })` (line 79). |
| 6 | `apps/web/src/app/auth/mobile-bounce/page.tsx:100-113` | Lifts a JWT via `auth.api.getToken({ headers })` (BA's JWT-plugin endpoint). |
| 7 | `apps/web/src/app/auth/mobile-bounce/page.tsx:115-116` | Renders `<RedirectPage url={returnUrl + ?token=...}>`. The page contains a `<meta http-equiv="refresh">`, a `<script>` `window.location.replace(url)`, and a visible link — three layers of redundancy because mobile webviews are hostile (`apps/web/src/app/auth/mobile-bounce/page.tsx:119-151`). |
| 8 | `WebBrowser.openAuthSessionAsync` intercepts the deep-link scheme | Native browser closes; `result.url` is `myetal://auth/callback?token=...`. |
| 9 | `apps/mobile/hooks/useAuth.ts:246-256` | Parses `token` out of the URL, calls `persistJwtAndRefreshUser(token)` (line 95-110). |
| 10 | `apps/mobile/lib/auth-storage.ts::setSession` | Writes the JWT to `expo-secure-store`. |
| 11 | `apps/mobile/hooks/useAuth.ts:105` | Hydrates `/me` cache via `api<AuthUser>('/me')`. The api client (`apps/mobile/lib/api.ts`) sends `Authorization: Bearer <jwt>`. |
| 12 | FastAPI verifies via `apps/api/src/myetal_api/api/deps.py::get_current_user`, returns the `User` row. |
| 13 | `apps/mobile/app/sign-in.tsx::goToDashboard` (line 57-66) | Pops the sign-in modal, navigates to `/(authed)/dashboard`. |

**Mobile-specific env vars / config:**

* `apps/mobile/lib/api.ts` exports `WEB_BASE_URL` — this is what
  `app.config.js` (or `app.json`) provides; defaults to
  `http://<pi-host>:3000` in dev.
* `app.json::scheme` must include `myetal` (and Expo Go's
  `exp+myetal`) for the deep link to resolve.
* No `ORCID_*` env vars on the mobile side — all OAuth lives on
  the web. The mobile app is a thin client over BA's REST.

### 1.4 Manual ORCID iD entry

User on the profile screen (web or mobile) types an ORCID iD.

| Step | Where | What happens |
|---|---|---|
| 1 | Web: `apps/web/src/app/dashboard/profile/...`. Mobile: `apps/mobile/hooks/useAuth.ts:289-298` (`updateOrcidIdMutation`). | Both call `PATCH /me/orcid { orcid_id }` with the user's BA JWT (cookie or Bearer). |
| 2 | `apps/api/src/myetal_api/api/routes/me.py:38-58` | Validates the body (`schemas/user.py::UpdateMeRequest` — runs the `_ORCID_ID_RE` shape check), invokes `services/users.py::set_user_orcid_id`. |
| 3 | `apps/api/src/myetal_api/services/users.py:40-79` | Pre-checks for a clashing user via `SELECT id FROM users WHERE orcid_id=:id AND id != :me`. If found → raises `OrcidIdAlreadyLinked`. |
| 4 | `apps/api/src/myetal_api/services/users.py:66-78` | If `user.orcid_id != orcid_id`, sets `user.last_orcid_sync_at = NULL` (so the next library visit re-fires the auto-import for the new iD). |
| 5 | DB commit. `IntegrityError` (concurrent race past the precheck) is caught and re-raised as `OrcidIdAlreadyLinked`. |
| 6 | `apps/api/src/myetal_api/api/routes/me.py:53-57` | Returns 409 with `detail="orcid_id is already linked to another account"` on `OrcidIdAlreadyLinked`. |

**`orcid_id: null`** clears the iD; same `last_orcid_sync_at`-reset
side effect when the value differs from current.

### 1.5 ORCID iD change for an already-linked user

Same code path as 1.4 (manual entry). The `set_user_orcid_id`
helper compares `user.orcid_id != orcid_id` (line 66) and
unconditionally drops `last_orcid_sync_at` whenever the value
differs — including the case where the user is replacing one iD with
another. Idempotent set (same value) leaves the timestamp intact.

This is the only path where the iD can change post-cutover. The
OAuth path cannot change an existing user's iD because:

* implicit account-linking by email is disabled (the OAuth flow can
  never modify an existing user's `orcid_id`);
* the genuine re-login path enters via a matching `account` row and
  BA's `handleOAuthUserInfo` only refreshes account-side tokens, not
  user-side fields (`link-account.mjs:48-60`).

### 1.6 ORCID public-API sync flow

Triggered by the user hitting `POST /me/works/sync-orcid` (or the
worker's nightly schedule, post-Phase A.6).

| Step | Where | What happens |
|---|---|---|
| 1 | `apps/api/src/myetal_api/api/routes/works.py:150-` (`sync_orcid`) | Auth via `CurrentUser` (BA JWT). Rate-limited 5/min per user. |
| 2 | `apps/api/src/myetal_api/services/works.py::sync_user_orcid_works` | Reads `user.orcid_id`, captures it for the duration of the sync (`works.py:202`) so a mid-sync iD change doesn't stamp the wrong row. |
| 3 | `apps/api/src/myetal_api/services/orcid_client.py::fetch_works` (line 199) | Validates the iD shape (defence-in-depth, `_ORCID_ID_RE` line 70). |
| 4 | `services/orcid_client.py::get_read_public_token` (line 176) | Reuses the cached read-public client-credentials token, or fetches a fresh one via `_fetch_new_token` (line 128). The credentials come straight from `settings.orcid_client_id` / `settings.orcid_client_secret` (`orcid_client.py:44-59`) — Phase 2's refactor away from the legacy `oauth_providers.credentials_for`. |
| 5 | `services/orcid_client.py::_get_works_with_retry` | GETs `{orcid_pub_base}/v3.0/{id}/works`. Sandbox toggle at `orcid_client.py:99-103` (driven by `settings.orcid_use_sandbox`). On 401 invalidates the cache and retries once (line 247-251). |
| 6 | `services/works.py` continues — upserts `papers`, upserts `user_papers`. |
| 7 | `services/works.py:241-245` | If `user.orcid_id` changed mid-sync, refuses to stamp `last_orcid_sync_at` (logs an error). Otherwise `user.last_orcid_sync_at = datetime.now(UTC)` and commits. |

**Env vars required:** `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`,
`ORCID_USE_SANDBOX` (API side — `apps/api/src/myetal_api/core/config.py`).

**Sandbox toggle:** `settings.orcid_use_sandbox` reads
`ORCID_USE_SANDBOX` (env). Used in `_orcid_oauth_base()` and
`_orcid_pub_base()` (`orcid_client.py:94-103`).

**Where errors surface:**

* `OrcidClientNotConfigured` (missing client id/secret) → route
  returns 503.
* `UpstreamError` (network / 5xx / token shape) → route returns 503.
* `ValueError` (bad iD shape) → 400. Should never trigger in practice
  because the schema layer pre-validates manual entry and OAuth
  populates only canonical iDs.

---

## 2. Bugs found and fixed during this audit

The Phase 5 ticket asked me to look for five specific issues. Findings:

### 2.1 `assertOrcidIdNotClaimedElsewhere` falsely blocked legitimate ORCID re-login — **FIXED**

**Bug.** The Phase 3 helper queried the `users` table only:
*"any user has this iD?"* On the second ORCID sign-in for the same
user, `users.orcid_id` is non-null (set by BA on first OAuth) — so
the guard threw, blocking legitimate re-authentication.

**Fix.** `apps/web/src/lib/auth-orcid-claim.ts` now also consults
the `account` table. If `(provider_id='orcid', account_id=<orcid iD>)`
exists AND points at the same user row, it's the legitimate
re-login shape — skip the guard. Only the case where `users.orcid_id`
is set but no matching `account` row exists (i.e. the iD landed via
the manual-entry path and a second user is now trying to OAuth-link
over it) triggers the hijack throw.

### 2.2 BA implicit account-linking by email contradicted the locked security posture — **FIXED**

**Bug.** With our config (no `account.accountLinking` set), Better
Auth defaulted to `accountLinking.enabled: true` and
`disableImplicitLinking: false`. `handleOAuthUserInfo`
(`oauth2/link-account.mjs:20`) would then silently attach an
ORCID/Google/GitHub account to any existing user with the matching
email when the provider returned `email_verified=true`. The
migration ticket specifies "we deliberately do NOT auto-link by
email post-cutover (matches today's behaviour)".

**Fix.** `apps/web/src/lib/auth.ts` now sets
`account.accountLinking.disableImplicitLinking: true`. Effect:

* Fresh ORCID/Google/GitHub sign-in for a never-seen email →
  creates a new user (current behaviour, unchanged).
* Fresh ORCID/Google/GitHub sign-in for an email that already exists
  under a *different* method → 302 to
  `/sign-in?error=account_not_linked` (the sign-in page already maps
  this code at `app/sign-in/page.tsx:31-33`).
* Same provider, same `(provider_id, account_id)` re-login → still
  works (BA's `findOAuthUser` finds the account row directly).

Linking to an existing account post-sign-in (a profile-screen
"connect ORCID/Google/GitHub" feature) remains possible via BA's
`/oauth2/link` endpoint, which requires an authenticated session
and is unaffected by this flag.

### 2.3 Hijack throw didn't redirect cleanly — **FIXED**

**Bug.** Phase 3's `assertOrcidIdNotClaimedElsewhere` threw a plain
`OrcidIdAlreadyLinkedError`. BA's generic OAuth callback does not
catch arbitrary throws from `mapProfileToUser` and translate them
into the redirect chain — the throw bubbles to BA's `onError`, which
logs it and returns a generic error response. The user never landed
on `/sign-in?error=orcid_already_linked`; they got BA's default
error page (or a 500 in production).

**Fix.** The helper now throws a Better Auth
`APIError('FOUND', ..., { Location: '<sign-in URL>' })`. Better
Auth's router (better-call's `to-response.mjs:114-118`) converts an
APIError with FOUND status into a 302 with our Location header. The
sign-in page parses the `error` query param and shows the friendly
message.

### 2.4 Mobile sign-in screen showed raw error codes — **FIXED**

**Bug.** `apps/mobile/app/sign-in.tsx` displayed `err.detail` /
`err.message` raw, so `orcid_already_linked` rendered literally
instead of a friendly sentence.

**Fix.** Added `describeAuthError` mapping at the top of the screen,
mirroring the web `describeError`. Covers
`orcid_already_linked`, `invalid_credentials`, `user_already_exists`,
`email_already_exists`, `account_not_linked`, `no_session`,
`jwt_unavailable`, `unknown_error`. Unknown codes humanise via
`replace(/_/g, ' ')` rather than passing through raw.

### 2.5 `auth-orcid-claim.ts` query path

**Confirmed: Drizzle, direct DB.** The helper queries `users` (and
now `account`) via `db.select(...).from(...)` with the local Drizzle
schema. No FastAPI hop, no extra latency on every OAuth callback.
This is the correct pattern.

### 2.6 `last_orcid_sync_at` reset on OAuth path

**Not a bug — verified correct by construction.** Three sub-cases:

* New user via OAuth → `users.last_orcid_sync_at` defaults to NULL
  (Drizzle schema, no default); BA writes the iD, the timestamp
  remains NULL — correct.
* Existing user re-login via OAuth → `handleOAuthUserInfo` updates
  the `account` row only, never user-side fields
  (`link-account.mjs:48-60`); the timestamp stays whatever it was
  pre-sync — correct (the worker stamps it post-sync, not on auth).
* Existing user changes their iD → can only happen via manual entry
  now that implicit linking is disabled (audit issue #2);
  `services/users.py::set_user_orcid_id:66-67` already drops the
  timestamp. Correct.

So no fix needed; the constraint is preserved by the combination of
"OAuth never mutates an existing user's `orcid_id`" + "manual entry
always resets the timestamp on change."

### 2.7 Mobile bounce error path — known limitation, documented

**Not a bug, but a UX caveat worth recording.** When a hijack
attempt comes from the mobile app's in-app browser, the
`mapProfileToUser` throw in §2.3 redirects to `/sign-in?error=...`,
NOT to the bounce page. The in-app browser stays open on the web
sign-in page rather than auto-closing via the deep-link return.

Two reasons we accepted this:

1. The hijack case is rare; the user can dismiss the in-app browser
   and re-try.
2. Routing through `mobile-bounce` would require detecting whether
   the OAuth flow originated from mobile, which we can't do cleanly
   from `mapProfileToUser` (no access to the BA request context).

If this becomes an issue in practice, a future fix is to pass
`errorCallbackURL` through BA's state (the body schema already
supports it; see
`generic-oauth/routes.mjs:20` and `oauth2/state.mjs:14`) and have
the mobile app set it to the bounce URL with an `error=...`
query string.

---

## 3. Smoke matrix

Run after deploying Phase 5 to dev / staging Pi. Tick rows as you
verify; capture screenshots for hijack rows. The matrix targets the
**sandbox** ORCID environment (`ORCID_USE_SANDBOX=true` in the
relevant `.env`). `iD-X` and `iD-Y` are two distinct sandbox iDs you
control.

| # | Surface | Pre-state | Action | Expected | Implemented at |
|---|---|---|---|---|---|
| 1 | Web | No user has `iD-X`. | Sign in via "Continue with ORCID" with `iD-X`. | New user row; `users.orcid_id = iD-X`; `users.last_orcid_sync_at IS NULL`. New `account` row `(orcid, iD-X, user_id)`. Lands on `/dashboard`. | OAuth happy path 1.1; `apps/web/src/lib/auth.ts:296-326`, `apps/web/src/lib/auth-orcid-claim.ts:80-103` (allow path). |
| 2 | Web | User A has `iD-X` (from row 1). | Sign in via ORCID with `iD-X` from a fresh browser session. | Returns to existing User A; no new user row, no new `account` row. Cookie set, JWT minted. | `auth-orcid-claim.ts:106-115` (re-login carve-out); BA `link-account.mjs:48-60` (account-token refresh). |
| 3 | Web | User A has `iD-X`; separately User B exists with email matching the ORCID profile email. | Sign in via ORCID with `iD-X`, fresh session. | Returns to User A (via the `account` row), NOT auto-linked into User B. No duplicate, no email-collision link. | `auth.ts:218-224` (`disableImplicitLinking: true`) prevents the email auto-link path; `account` lookup for `(orcid, iD-X)` finds User A and signs them in. |
| 4 | Web | User A has `iD-X` linked normally. User B exists (email/password only), wants to OAuth in via `iD-X`. | Sign in via ORCID with `iD-X` while NOT signed in. | Returns to User A (BA's account-table lookup wins). User B's session isn't touched. **Variation:** if `iD-X` was claimed via PATCH `/me/orcid` for some hypothetical User C (no `account` row), the result is a 302 to `/sign-in?error=orcid_already_linked` with the friendly message. | `auth-orcid-claim.ts:117-138` (hijack throw → APIError FOUND). |
| 5 | Web | User has `orcid_id = iD-X`, `last_orcid_sync_at` populated (e.g. ran works sync earlier). | `PATCH /me/orcid { orcid_id: 'iD-Y' }`. | 200; row updated to `iD-Y`; `last_orcid_sync_at` reset to NULL; next library visit re-fires worker. | `services/users.py:40-79`. |
| 6 | Web | User A has `iD-X`. | User B sends `PATCH /me/orcid { orcid_id: 'iD-X' }`. | 409, body `{ detail: "orcid_id is already linked to another account" }`. User B's row unchanged. | `routes/me.py:38-58`, `services/users.py:60-64` precheck + IntegrityError fallback. |
| 7 | Mobile | No user has `iD-X` (clear DB or use fresh iD). | In dev build of mobile app, tap "Continue with ORCID"; complete consent in the in-app browser. | In-app browser briefly shows `mobile-bounce` (~150 ms) then auto-closes via `myetal://auth/callback?token=...`. App lands on `/(authed)/dashboard`. JWT in `expo-secure-store`. | `apps/mobile/hooks/useAuth.ts:228-258`; `apps/web/src/app/auth/mobile-bounce/page.tsx`. |
| 8 | Mobile | Hijack shape (`iD-X` claimed by another user, no matching `account` row). | Tap "Continue with ORCID" with `iD-X`. | In-app browser navigates to `${WEB}/sign-in?error=orcid_already_linked` and STAYS open (does not auto-close — see §2.7 caveat). User taps "Back" / dismisses. App's `runOAuthFlow` sees `result.type !== 'success'` (the deep-link return never fired); throws `orcid_oauth_dismiss` which the screen swallows silently. **Friendly hijack message is NOT shown in the mobile UI in this path** — the message is visible only on the in-app web page. | `auth-orcid-claim.ts:117-138` redirects to web sign-in; mobile screen `describeAuthError` would show the friendly message if the error code WERE deep-linked, but in this path it isn't. Future fix in §2.7. |
| 9 | Sandbox toggle | Set `ORCID_USE_SANDBOX=true` on the web env (Pi `.env.local` or Vercel). | Sign in via ORCID. | Network tab shows requests to `sandbox.orcid.org`, NOT `orcid.org`. JWKS / userinfo are from sandbox. With `=false`, traffic hits `orcid.org` via the OIDC discovery URL. | Web: `auth.ts:114-123`. API (sync side): `orcid_client.py:94-103`. |
| 10 | Public-API sync | User has `orcid_id` populated, `ORCID_CLIENT_ID/SECRET` set on API. | `POST /me/works/sync-orcid` from the dashboard. | 200 with `OrcidSyncResponse`; `papers` and `user_papers` rows upserted; `users.last_orcid_sync_at` stamped to `now()`. Re-call within 12 hours short-circuits (no work). | `routes/works.py:150-`; `services/works.py::sync_user_orcid_works`; `services/orcid_client.py::fetch_works`. |

**Out of matrix (already covered by Phase 1-4 acceptance):**

* JWT verification on the API (Phase 1).
* Cookie naming `myetal_session` (Phase 2/3).
* Mobile cookie-less flow (Phase 4).
* `is_admin` round-trip via the JWT (Phase 6 will re-verify post-merge).

---

## 4. Phase 6 prereqs

Carry into the Phase 6 test sweep (`docs/tickets/to-do/better-auth-migration.md` Phase 6):

1. **Run rows 1-10 above on the Pi.** The matrix is the operational
   gate, not just a doc. Capture the row-by-row pass marks in the
   Phase 6 sign-off note.
2. **Verify the Resend dashboard shows DKIM/SPF green** for
   `myetal.app` BEFORE flipping prod traffic. The `DEPLOY.md` cutover
   section already mentions this; rows 7-8 of the smoke matrix
   indirectly depend on it (any unverified-email banner the mobile app
   shows assumes the verification email actually delivered).
3. **Re-grant admin** to the owner email after re-sign-up — see
   `apps/api/DEPLOY.md` §9a "Re-granting admin after cutover."
4. **Optional follow-up (NOT blocking):** wire the mobile bounce page
   to receive the hijack error so the mobile UI can render the
   friendly message inline (see §2.7). Two-line change in
   `auth-orcid-claim.ts` plus state plumbing through BA's
   `errorCallbackURL`.

---

## 5. Decisions still locked from the migration ticket

These came out of the audit unchanged:

* ORCID via `genericOAuth` plugin (BA), not `socialProviders`.
* Sandbox toggle: `process.env.ORCID_USE_SANDBOX === 'true'` (web) /
  `settings.orcid_use_sandbox` (api).
* Hijack-hardening: `assertOrcidIdNotClaimedElsewhere` runs BEFORE
  BA writes the user row (`mapProfileToUser`).
* `last_orcid_sync_at = NULL` on iD change (manual entry only —
  OAuth path doesn't mutate iD).
* Manual entry endpoint: `PATCH /me/orcid` returns 409 on duplicate.
* No auto-link by email (Phase 5 enforces this with
  `disableImplicitLinking: true`; matches pre-cutover behaviour).
