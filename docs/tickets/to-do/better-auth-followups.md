# Better Auth follow-ups

**Status:** Queued — high-ish priority. The headline item (account linking UI) is the one the owner explicitly wants. The rest are accepted v1 gaps with documented fix paths.
**Created:** 2026-05-08 (post Better Auth cutover branch ready)
**Owner:** James
**Effort estimate:** ~3-4 days for the headline item alone; full ticket ~5-7 days end-to-end if all bundled.
**Depends on:** Better Auth migration deployed (cutover runbook executed).

---

## TL;DR

The Better Auth cutover landed clean (43 commits on `feat/better-auth-migration`, regression-tested, runbook in place). It deliberately deferred a small set of items — most are quality-of-life gaps, but **one is genuinely product-defining**: explicit account linking across email-password / Google / GitHub / ORCID. Owner direction:

> *"I definitely want good linking between accounts (users sign in with Google, ORCID, email, all that kind of stuff). I'm hoping Better Auth will help us do that."*

Better Auth does support this — the cutover ships with `disableImplicitLinking: true` (security posture: no silent merge-by-email), but the *explicit* flow needs a UI surface so users can add a second provider deliberately. That's #1 below.

The other items (mobile sign-out server-session invalidation, JWT-in-mobile-URL exchange code, sign-up enumeration, admin via DB column, hard email verification flip) are smaller and less urgent — bundle them in this ticket but don't let them gate the account-linking work.

---

## Items, ordered by priority

### 1. Profile-screen "Connected accounts" UI (THE HEADLINE — owner-prioritised)

**What:** Logged-in users see their linked providers on their profile and can:
- Click "Connect Google" / "Connect GitHub" / "Connect ORCID" to add a provider to their existing account.
- See which providers are already attached, with the linked email / iD shown.
- Disconnect a provider (with the obvious "you must have at least one auth method" guard).

**Why now:** Today, a user who signs up with email+password and later clicks "Sign in with Google" on the same email lands on `/sign-in?error=account_not_linked`. There is no recovery path other than "use the original method" — feels broken to the user, even though it's the correct security posture.

**Implementation:** Better Auth's [`linkSocial`](https://www.better-auth.com/docs/concepts/users-accounts#account-linking) plugin/method handles this. The flow:
1. Authed user clicks "Connect Google" on their profile page.
2. Web calls `authClient.linkSocial({ provider: 'google', callbackURL: '/dashboard/profile' })`.
3. BA opens Google OAuth, user consents.
4. BA writes a new `account` row linked to the existing `user` row.
5. Redirect back to profile, banner shows "Google connected."

For ORCID: same shape via the `genericOAuth` plugin's link helper (verify exact API surface against BA's current docs — the spike notes show `genericOAuth` is a marker plugin; the link path may need to be hand-rolled with `auth.api.signInOAuth2` + an existing-session header).

**ORCID-specific consideration:** the existing `assertOrcidIdNotClaimedElsewhere` hijack-guard at `apps/web/src/lib/auth-orcid-claim.ts` runs in `mapProfileToUser`. The link path goes through the same callback. The guard should still permit the link if the ORCID iD doesn't conflict (it's the user's own iD they're linking) but throw if it does. Re-test with the linked-account shape — Phase 5's test only covered the sign-in path.

**UI surfaces (web only for v1; mobile follows in #6 below):**
- New section on `apps/web/src/app/dashboard/profile/page.tsx`: "Connected accounts."
- Three rows: Email/password (always shown if set), Google, GitHub, ORCID. Each row shows linked status + connect/disconnect button.
- Mirror the visual style of the existing ORCID iD section.

**Effort:** ~3 days end-to-end.

**Triggers / dependencies:**
- Better Auth's link API: confirm `linkSocial` works with `socialProviders` (Google + GitHub built-in).
- Better Auth's `genericOAuth` link path: hand-roll if needed.
- ORCID hijack-guard re-test for the link callback shape.

---

### 2. Mobile mirror of "Connected accounts"

Same as #1 but on the mobile profile screen. Lower priority because mobile users are a smaller surface today; ship #1 first, watch usage, then mobile.

**Effort:** ~1 day on top of #1.

---

### 3. JWT-in-mobile-bounce-URL → one-time exchange code

**What:** Today's mobile OAuth flow puts the JWT in the deep-link URL (`myetal://auth/callback?token=<jwt>`). 15-min TTL bounds blast radius, but the JWT is briefly visible in the in-app browser address bar / OS pasteboard / crash-reporter URL captures.

**Fix:** swap for a one-time exchange code:
1. `mobile-bounce` page generates a random 32-byte code, writes `(code, user_id, expires_at)` to a new `mobile_exchange_codes` table with 60-second TTL.
2. Bounce redirects to `myetal://auth/callback?code=<code>` (opaque, no JWT).
3. Mobile app receives `?code=<code>`, calls `POST /api/auth/exchange-code` with the code, gets `{ token: <jwt> }` back.
4. Code is invalidated on first use (or expiry).

**Why deferred:** the bounded-TTL JWT-in-URL is an accepted v1 risk. The exchange-code is hardening, not a fix.

**Effort:** ~1 day. New endpoint, new table (or in-memory cache), small mobile + bounce-page diff.

---

### 4. Mobile sign-out invalidates BA session row

**What:** Today, `signOut()` on mobile clears local secure-store but does NOT invalidate BA's server-side session (BA's `/sign-out` route reads only the cookie; mobile sends Bearer). Net: the session row lives until 30-day TTL; if the device's stored JWT were stolen and used within its 15-min window, sign-out wouldn't kick it out.

**Fix:** add an explicit `POST /api/auth/sign-out-bearer` route handler (or extend the existing sign-out to accept Bearer-auth). On call, look up the session by BA's session token (extract from the JWT's `session_id` claim — verify BA's JWT plugin includes one) and delete it.

**Effort:** ~0.5 day, mostly hunting through BA's session-revoke API.

---

### 5. Hard email verification flip

**What:** Today, sign-up sends a verification email but does not block use of the app. One-line flip: `requireEmailVerification: true` in `apps/web/src/lib/auth.ts:257-275`.

**When to flip:** once Resend delivery is confirmed reliable for a few weeks. Until then, soft mode avoids locking users out due to deliverability issues.

**Effort:** 5 minutes when ready.

---

### 6. Sign-up enumeration suppression

**What:** Today, BA returns `user_already_exists` if a sign-up attempt collides with an existing email. Most apps do this — explicit, friendly UX. The trade-off: an attacker can probe for valid emails by attempting sign-ups.

**Fix (if we want to harden):** intercept BA's sign-up error in the Web UI; always show "Check your email for a confirmation link" regardless of outcome. Combined with rate-limiting, this neutralises the oracle.

**Why deferred:** acceptable v1; revisit if abuse signals appear.

**Effort:** ~0.5 day.

---

### 7. Runtime-grantable admin via `is_admin` column instead of env allowlist

**What:** Today, `require_admin` reads `user.email in settings.admin_emails`. Adding an admin requires a code deploy. The `users.is_admin` column exists but is unused.

**Fix:** swap the dep to read `user.is_admin`. Add a small admin-management UI (or document the SQL one-liner). Migrate existing env-listed admins on first run.

**Why deferred:** allowlist works for the current 1-2 admins. Becomes annoying around 5+.

**Effort:** ~0.5 day (code) + UI to taste.

---

### 8. Mobile-side ORCID hijack error surfacing

**What:** When a mobile ORCID hijack attempt is caught, the redirect lands on the **web** `/sign-in?error=...` page, not on the mobile sign-in screen. User sees a web error page in the in-app browser instead of an inline mobile error.

**Fix:** route the hijack error through `/auth/mobile-bounce?error=...` so the deep-link surfaces it inline on the mobile sign-in screen. Mobile already has the `describeAuthError` mapping (Phase 5).

**Effort:** ~2 lines + a deep-link param.

---

### 9. ORCID-private-email recovery flow

**What:** When an ORCID user keeps their email private, our `mapProfileToUser`
synthesises `${orcidId}@orcid.invalid` so BA's NOT NULL email column accepts
the sign-up (commit `d038879`). It works, but:

- Password reset can't deliver (`.invalid` is reserved + non-deliverable)
- Email verification banner can never be confirmed (if flipped to hard)
- The user sees a clearly-fake email in their profile

**Fix:**
- Detect `email.endsWith('@orcid.invalid')` on the dashboard
- Show a non-blocking banner: *"Add a real email so we can send password
  reset + notifications. ORCID didn't share yours."*
- Profile page already has the structure for editable fields; add an
  email row with BA's `auth.api.updateUser({ email })` wired to the
  save action
- Once updated, banner disappears

**Effort:** ~30-45 min. Small.

**Why deferred:** affects only ORCID-private-email users (subset). Not
blocking sign-in. Surface during a profile-page polish pass.

---

### 10. Pre-existing mypy / eslint debt cleanup

**What:** Five mypy errors and four eslint errors carry over from before the BA migration:
- `services/share.py`, `services/papers.py`, `services/r2_client.py`, `api/routes/public.py`, `main.py` — all third-party stub gaps (`cachetools`, `boto3`, `qrcode`) plus a Starlette generic.
- `apps/web/src/hooks/useSavedShares.ts` — react-hooks/set-state-in-effect.

Ship `uv add --dev types-cachetools types-boto3 types-qrcode` (or local stubs) and rewrite the offending hook.

**Effort:** ~1 hour.

**Why bundled here:** they're noisy in CI; cleaning them up alongside post-cutover work is convenient.

---

## Out of scope (future tickets if priorities shift)

- **2FA / TOTP** — Better Auth supports it via plugin; design ticket of its own when there's a credible threat model.
- **Magic-link sign-in** — same.
- **Passkeys / WebAuthn** — same.
- **Session-management UI rebuild** (list devices, revoke per-session) — Phase 2 deleted the legacy endpoint; rebuild on Better Auth post-account-linking.

---

## Acceptance checklist

- [ ] `linkSocial` (Google) works on web — user with email+password account can add Google, both providers accepted on sign-in.
- [ ] `linkSocial` (GitHub) works on web — same.
- [ ] ORCID link works on web (likely via genericOAuth's link path or hand-rolled).
- [ ] Disconnect path works for any non-last provider; refuses to remove the last auth method.
- [ ] ORCID hijack-guard still blocks malicious link attempts on the linked-account shape (regression test added).
- [ ] Mobile sign-out actually invalidates BA's server-side session row (item #4).
- [ ] Bounce page exchange-code in place; `?token=` removed from deep links (item #3).
- [ ] Profile UI shows linked-providers state with friendly status text.
- [ ] Mobile profile screen mirrors the web flow (item #2).
- [ ] If we choose to flip hard email verification (item #5), one-line change made and tested.
- [ ] Documentation: update `better-auth-known-limitations.md` to mark #1, #2, #4 as "addressed in better-auth-followups" and re-link.

---

## Sequencing within this ticket

1. **First:** item #1 (web account linking UI) — owner-prioritised.
2. **Then:** item #4 (mobile sign-out hardening) — small, security-relevant.
3. **Then:** item #3 (exchange-code refactor) — security-relevant, ~1 day.
4. **Then:** item #2 (mobile mirror) — UX completion.
5. **Last:** items #5, #6, #7, #8, #9 — small, ship together when convenient.

---

## Triggers to revisit priority

- Owner asks "why can't I link my Google account?" — already triggered. Item #1 is the unblock.
- Live abuse signal on sign-up enumeration — item #6 jumps the queue.
- > 5 admins needed — item #7 jumps.
- Resend delivery proven reliable for 4+ weeks — flip item #5.
