# Auth integration tests — BA against real Postgres

**Status:** Backlog — high value, do once daily friction stabilises
**Created:** 2026-05-10
**Owner:** James
**Effort estimate:** ~1 day for the BA integration test alone; ~2-3 days if the full sweep below

---

## TL;DR

The single test that would have saved 6+ hours of debug time on staging cutover day: spin up a real Postgres, apply Alembic migrations, wire BA to it via the drizzle adapter, run sign-up + OAuth + sign-in end-to-end and assert the rows are written correctly.

Each one of today's BA-config-drift bugs (UUID generator format, schema map key, `additionalFields` keys, `fields:` mappings) would have failed loudly during this test instead of silently in a Vercel function log six redeploys later.

---

## What to build (priority order)

### 1. BA → Postgres integration test (highest value)

Goal: catch field-mapping / schema / generator bugs at PR time, not at deploy time.

**Stack**: vitest + testcontainers (or docker-compose lifecycle) + a real Postgres 16 image.

**Test setup**:
1. Spin Postgres
2. Apply Alembic migrations (`alembic upgrade head`)
3. Import the BA `auth` config + drizzle adapter pointed at the test Postgres
4. (Optional) Seed a test user

**Test cases**:
- `POST /api/auth/sign-up/email` → assert `users` row created with `id` (UUID), `email`, `email_verified=false`, `is_admin=false`, `created_at` set
- `POST /api/auth/sign-in/email` → assert `session` row exists, JWT mints with `sub`/`email`/`is_admin` claims
- OAuth callback simulation (mock Google's response) → assert `account` row created with right `providerId`, `accountId`, `userId`
- `GET /api/auth/get-session` with cookie → assert returns the user object with all camelCase fields populated
- ORCID hijack guard: pre-seed user with `orcidId='X'` → simulate ORCID OAuth from a different user → assert `OrcidIdAlreadyLinked` thrown

**Where it runs**: GitHub Actions on every PR touching `apps/web/**` or `apps/api/alembic/**`. ~30 sec per run.

### 2. FastAPI JWKS verifier integration test

Already covered by `apps/api/tests/core/test_ba_security.py` — 11 tests. **Skip — done.**

### 3. Mobile useAuth tests

Goal: catch the JWT-lift bugs (BA returns `data.token = session.token`, not a JWT).

**Stack**: vitest + msw (or fetch-mock) for Mock BA responses.

**Test cases**:
- `signIn` happy path: mock `POST /api/auth/sign-in/email` with `{user, token: 'session-id'}` AND `set-auth-jwt` header → assert stored token is the JWT (from header), not `data.token`
- `signIn` fallback: same but no header → assert `GET /api/auth/get-session` is called next, JWT lifted from there
- `signOut`: assert local secure-store is cleared even if server call fails

**Effort**: ~0.5 day.

### 4. Web sign-in flow E2E (optional)

Playwright. Lower priority — slow to write, slower to run, brittle. Skip for now.

### 5. Static casing lint (optional)

A small pre-commit script that greps `apps/web/src` for known-bad patterns (`is_admin` as a JS property access, `eq(users.orcid_id, ...)`, etc.). 20 lines of bash. Cheap insurance; not strictly necessary if integration tests run on PR.

---

## Why deferred

- Today's BA pain is one-time setup. Once staging+prod are stable, the bugs we hit can't recur on the same code.
- Adding tests against real Postgres adds infrastructure to CI (testcontainers, image pull caching). Not free.
- Worth doing AFTER the system has stabilised, so we know what the actual real-world failure modes are. Don't write tests for hypothetical bugs.

---

## Triggers to pick up

- Next time we hit a BA-config-drift bug after cutover (probably won't, but if we do, this is the first ticket)
- Before any BA major-version upgrade (1.6 → 2.x someday) — must have integration tests before that PR
- Before any new auth-adjacent feature (account linking UI, 2FA, magic links) — those touch BA config heavily, would benefit from the test net

---

## What's already in place (don't redo)

- `apps/api/tests/core/test_ba_security.py` — JWKS verifier hardening, alg-confusion, missing-kid, expired-token. Strong.
- `apps/api/tests/test_auth_contract.py` — Bearer-only contract on FastAPI (cookie path explicitly rejected). Strong.
- `apps/api/tests/test_me_routes.py` — `/me` GET + PATCH /me/orcid. Covers the survival of manual ORCID entry.

What's MISSING and what this ticket covers: the **glue between BA's JS layer and the actual Postgres tables**. That's the gap.
