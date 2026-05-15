# More frontend tests — vitest forms + key flows

**Status:** Backlog — high value, do after staging bakes
**Created:** 2026-05-11
**Owner:** James
**Effort estimate:** ~2-3 days for a meaningful baseline; can be done in chunks
**Depends on:** none (auth integration test infra already in place via commit `e8fab08`)

---

## TL;DR

Today's bug retrospective: ~80% of staging-cutover bugs were on the **web frontend**, in files with zero automated test coverage. The auth-integration-tests agent built the first vitest+testcontainers tests (`apps/web/__tests__/auth-integration.test.ts`) — that infra is now in place. This ticket extends that coverage to forms, components, and key flows so the next class of bug gets caught at PR time.

**Mobile tests deliberately scoped lower** — same patterns but smaller user surface today.

---

## What today proved we needed

Each of these would have been caught at PR time with the proposed coverage:

| Bug | Test that would have caught it |
|---|---|
| `file_size_bytes=0` Zod rejection | "Create default share + submit" smoke test |
| ORCID `email_is_missing` / `name_is_missing` | `mapOrcidProfileToUser` already covered by auth-integration; bonus: render-time test with empty fields |
| Cookie `__Secure-` prefix in middleware | Middleware unit test with prod-mode cookie name |
| `%%` SQL trigram | API testcontainers-Postgres tests (separate ticket; see below) |
| `defaultRandom()` schema drift | Auth integration test caught this — already done |

---

## What to build (priority order)

### 1. Form-validation smoke tests (~6 hours, biggest bang/buck)

Vitest + React Testing Library. For each form on the web app:

1. **Create with defaults, attempt submit** — assert no Zod errors leak from hidden fields
2. **Fill happy path, submit** — assert the right shape posts to the API (mock fetch)
3. **Trigger known validation paths** — assert error message renders in the right slot

**Coverage targets:**
- `apps/web/src/app/sign-in/auth-email-section.tsx` (and sign-up)
- `apps/web/src/app/sign-up/sign-up-form.tsx`
- `apps/web/src/app/forgot-password/forgot-password-form.tsx`
- `apps/web/src/app/reset-password/reset-password-form.tsx`
- `apps/web/src/components/share-editor.tsx` — biggest surface, most bug-prone
- `apps/web/src/app/dashboard/feedback/page.tsx` (feedback form)

**Test infra**: vitest already wired (commit `e8fab08`). Add `@testing-library/react` + `@testing-library/user-event` to apps/web.

### 2. Middleware unit tests (~30 min)

`apps/web/src/middleware.ts` — assert:
- No cookie → bounces to /sign-in?return_to=...
- `myetal_session` cookie (dev shape) → passes
- `__Secure-myetal_session` cookie (prod shape) → passes
- Both present → passes (production reality)

Pure function — fastest test in the suite.

### 3. `lib/server-api.ts` + `lib/api.ts` tests (~1 hour)

The "what does the client do on 401" code path. Critical because today's share-create-logs-me-out bug lives here.

- 401 from API → does it call sign-out + redirect? (Currently yes, which is the bug suspect — see `lib/api.ts`'s `clearSession` logic.)
- Network error vs HTTP error — different handling expected
- Cookie forwarding correctness

### 4. Component tests for share-editor (~1 day)

The single most complex form in the app. Each interaction worth a test:

- Add a paper via DOI → Crossref hook → autofill
- Add a PDF → upload modal → success / failure paths
- Add a link → URL validation
- Reorder items → up/down arrow handlers
- Save with no items → "Add at least one item" error
- Save with items → POST shape correct

This is the heavy lift. Probably worth pairing with a refactor to split the monolithic component into smaller testable units.

### 5. Playwright for top 3 flows (~1 day, optional)

End-to-end browser tests:
- Sign in → land on dashboard
- Create share → publish → see in dashboard list
- Public share viewer at `/c/[code]` loads

Slow to write, slow to run (~30s per flow), brittle (depends on real network, fonts, etc.). Lower priority than #1-4. Do if budget allows.

---

## What's deliberately NOT in this ticket

- **Mobile tests** — separate ticket if/when mobile becomes a higher-traffic surface
- **Visual regression / screenshot tests** — overkill at this scale
- **Performance / load tests** — separate concern
- **Backend Postgres-via-testcontainers** — separate ticket (would catch the `%%` class of bug)

---

## Why deferred

- Auth-integration-tests just landed; let that bake before piling on
- Staging is mid-stabilisation; don't want to add CI overhead during cutover prep
- The bugs we hit today are already fixed; no immediate pain

---

## Triggers to expedite

- Another frontend bug ships that a smoke test would have caught
- New form added (write tests *with* the new form, not retroactively)
- Pre-1.0 release (the polish bar genuinely matters here)
- Onboarding new contributors (test coverage is the safety net for code review at scale)

---

## Owner direction (2026-05-11)

> *"more front-end tests. We should do mobile tests but they have lower priority for me"*

Translation: web vitest + playwright before mobile native. This ticket reflects that.
