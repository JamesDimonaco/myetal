# Better Auth — known limitations (post-cutover)

**Status:** SHIPPED (record)
**Created:** 2026-05-08 (Phase 6)
**Owner:** James
**Predecessors:** `done/better-auth-orcid-flow.md` (Phase 5 audit + smoke matrix); `done/better-auth-migration.md` (the cutover itself).

The following gaps were called out during Phases 1-6 review and
deliberately accepted for v1. None are security blockers for the
threat model in `to-do/better-auth-migration.md` ("stop offline
cracking of a stolen DB dump", "ORCID iD is the only trusted
identifier from ORCID"). Each entry: what, why we accepted it, the
fix path if and when we revisit.

---

## 1. Mobile sign-out doesn't invalidate the BA session row

**Where:** `apps/mobile/hooks/useAuth.ts` — `signOutMutation` calls
`POST /api/auth/sign-out` with `Authorization: Bearer <jwt>`.

**Behaviour:** BA's `sign-out` route (vendored at
`node_modules/.../better-auth/dist/api/routes/sign-out.mjs:20-27`) reads
the **signed session cookie** to identify which session to delete. A
Bearer-only mobile request does not carry that cookie, so
`sessionCookieToken` is empty and the route falls through to
`deleteSessionCookie(ctx)` (no-op on mobile because there's no cookie
to clear). Net effect: mobile `signOut()` clears the local JWT
immediately, but the BA `session` table row stays alive until its
30-day TTL or explicit cleanup.

**Why accepted:** worst-case impact is "an attacker who already has
the device's JWT can keep using it for up to 15 minutes (the JWT TTL),
plus could in principle re-mint a fresh JWT via `/api/auth/token` for
30 days if they also captured the session cookie — which mobile
doesn't have." Concretely, a device-owner sign-out is fine; a stolen
device after a remote sign-out request still relies on the JWT TTL,
not server-side revocation.

**Fix path:** when we want clean revocation on mobile sign-out, switch
the mobile call to a custom endpoint that reads the BA session by
JWT-derived `session_token` claim (BA writes it as `sub.session` on
the JWT) and calls `auth.api.signOutSession({ token })`. ~10 lines on
the web side, one call swap on mobile. Punted to a post-Railway
ticket.

---

## 2. JWT in mobile-bounce URL fragment is bounded-TTL, not one-time

**Where:** `apps/web/src/app/auth/mobile-bounce/page.tsx:115-116` —
emits `window.location = myetal://auth/callback?token=<jwt>`.

**Behaviour:** the Bearer JWT lands in the deep-link query string. iOS
and Android URL handlers don't preserve fragments reliably, so
`?token=` was preferred over `#token=` for delivery. The token has the
same 15-min TTL as any other BA-minted JWT.

**Why accepted:** the only path the URL traverses is the in-app
browser → OS deep-link handler → our app — no third-party origin sees
it. The TTL bounds the blast radius if a logging library or accessibility
service captures it.

**Fix path:** introduce a one-time exchange code on the bounce page
(a 30-sec single-use token recorded in a tiny redis/db table), redeem
it via `POST /api/auth/mobile-exchange?code=<...>` from the mobile app
to get the JWT. Removes the JWT-in-URL exposure entirely. Estimate: ~1
day. Tracked as a future ticket; deferred per Phase 6 ticket scope.

---

## 3. Account enumeration on sign-up

**Where:** Better Auth `/api/auth/sign-up/email` returns
`user_already_exists` (HTTP 422) when the email is taken.

**Behaviour:** an attacker can probe whether an email has an account
by attempting sign-up. BA does not currently support a generic
"check your email" response shape on this endpoint without disabling
the error code entirely.

**Why accepted:** the same enumeration is possible via the password-
reset endpoint on most apps; BA's `requestPasswordReset` is itself
already enumeration-safe (always returns success regardless of email
existence). The sign-up surface is a smaller hole than the reset
surface, and the value of distinguishing "you already have an account,
sign in instead" UX > the enumeration cost for v1.

**Fix path:** patch BA at the route level (its hooks API supports
intercepting endpoint responses) to map both shapes to a single
"check your email" response. Track if abuse signals appear.

---

## 4. Implicit OAuth account linking is OFF — UX gap for cross-method users

**Where:** `apps/web/src/lib/auth.ts:218-230` —
`account.accountLinking.disableImplicitLinking: true`.

**Behaviour:** if a user signs up with email+password and later tries
"Continue with Google" using the same email, they get a 302 to
`/sign-in?error=account_not_linked` instead of being silently merged.
This is the locked security posture (matches pre-cutover behaviour;
prevents email-based account hijack via OAuth).

**Why accepted:** correct posture for the threat model. UX gap is
"user must sign in with their original method first, then link the
second from a profile screen" — but the profile-screen "link Google /
GitHub / ORCID to your account" UI does NOT exist in v1. So today the
guidance is "sign in with the method you originally used." The mobile
sign-in screen has a caption to the same effect at
`apps/mobile/app/sign-in.tsx:239-243`.

**Fix path:** small profile-screen "Connected accounts" section that
calls BA's authenticated `/api/auth/oauth2/link` endpoint per provider.
~1.5 days end-to-end. Tracked as a follow-up ticket.

---

## 5. Email verification is soft v1

**Where:** `apps/web/src/lib/auth.ts:277-294` —
`emailVerification.sendOnSignUp: true`, but no
`requireEmailVerification: true` on `emailAndPassword`.

**Behaviour:** sign-up sends the verification email; sign-in works
without verification. The mobile app shows a soft "verify your email"
banner; the web does too. No endpoint is gated on
`email_verified=true`.

**Why accepted:** lower support friction during the early-users window
per Phase 5 locked decision. Hardening is a one-line flip.

**Fix path:** set `emailAndPassword.requireEmailVerification: true` in
`lib/auth.ts`. BA will then 401 unverified email sign-ins until the
user clicks the link.

---

## 6. Admin must be re-granted by email allowlist post-cutover

**Where:** `apps/api/src/myetal_api/api/deps.py:149-185` —
`require_admin` reads `settings.admin_emails` (env var).

**Behaviour:** the cutover Alembic migration TRUNCATEd `users` so
every row's `is_admin` is the column default (false). Admin gating in
v1 is by env-var allowlist anyway, so no DB rewrite is needed — the
admin emails just need to re-sign-up so their row exists.

**Why accepted:** env-var allowlist matches "admin set by deploy
configuration" — same change-control envelope as a code deploy. v1
has 1-2 admin emails; not worth a runtime-grantable system yet.

**Fix path:** if admin needs to be runtime-grantable (promote a user
via SQL without a deploy), switch `require_admin` to read
`user.is_admin` (DB column already exists as a Better Auth
additionalField). One-line code change; remove `settings.admin_emails`
afterwards.

---

## 7. ORCID hijack on mobile lands on web sign-in page

**Where:** `apps/web/src/lib/auth-orcid-claim.ts:142-146` — the hijack
guard throws `APIError('FOUND', ..., { Location:
'/sign-in?error=orcid_already_linked' })`.

**Behaviour:** when a hijack-shape ORCID OAuth attempt comes from the
mobile app's in-app browser (`WebBrowser.openAuthSessionAsync`), the
APIError redirects to `${WEB}/sign-in?error=...` instead of bouncing
back through `/auth/mobile-bounce`. The in-app browser stays on the
web sign-in page; the user dismisses it manually. The friendly
"This ORCID iD is already linked to another account…" message is
rendered on the web page, NOT in the mobile UI.

**Why accepted:** the hijack case is rare and the user can read the
web message before dismissing. `mapProfileToUser` doesn't have access
to the BA request context to detect the originating surface.

**Fix path:** route through `mobile-bounce` with an `error=...`
query string (the BA state schema already supports an
`errorCallbackURL` field). ~2 lines in `auth-orcid-claim.ts` plus the
bounce page mapping the param into the deep-link URL. Documented at
`done/better-auth-orcid-flow.md:307-328`.

---

## 8. Pre-existing mypy errors (non-auth, unfixed)

**Where:** repository-wide mypy run.

* `src/myetal_api/services/papers.py:25` — `cachetools` missing stubs.
  Fix: `uv add --dev types-cachetools`.
* `src/myetal_api/services/r2_client.py:33` — `boto3` no py.typed marker.
  Fix: `uv add --dev boto3-stubs`.
* `src/myetal_api/api/routes/public.py:4` — `qrcode` missing stubs.
  Fix: `uv add --dev types-qrcode`.
* `src/myetal_api/main.py:34` — slowapi handler signature is
  intentionally narrow (`Request, RateLimitExceeded`); FastAPI's
  registry expects the wider `Request, Exception` shape. Workaround:
  `# type: ignore[arg-type]` or wrap the handler. Ignored for now.
* `src/myetal_api/services/share.py:344` — `DailyViewCount(count=...)`
  arg-type mismatch (the constructor expects `int`, the call passes a
  `Callable`). Likely a real subtle bug worth investigating
  separately.

**Why accepted:** unrelated to the Better Auth migration; flagged here
to keep them visible.

**Fix path:** small backlog item — install the four missing stub
packages, audit the `share.py:344` call site, suppress the slowapi
arg-type with a targeted ignore.

---

## 9. Pre-existing eslint errors in web (non-auth, unfixed)

**Where:** `pnpm --filter @myetal/web lint`.

Four errors in `src/hooks/useSavedShares.ts` (synchronous setState in
useEffect, `react-hooks/set-state-in-effect`). All in the saved-shares
local-storage hook — not touched by the auth migration.

**Why accepted:** unrelated; pre-dates this branch (confirmed against
`main` at branch point).

**Fix path:** swap to `useSyncExternalStore` for localStorage backing,
or move the read into render via a tiny `useState(() => ...)` lazy
initializer. Backlog.
