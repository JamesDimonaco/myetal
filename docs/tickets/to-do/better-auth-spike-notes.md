# Better Auth migration — Phase 0 spike notes

**Branch:** `worktree-agent-ab9ae621` (rename when pushing)
**Date:** 2026-05-08
**Scope:** non-destructive proof of cross-stack identity. Nothing else.

> **Phase 3 update:** every `/api/ba-auth/...` reference below moved to `/api/auth/...` when Phase 3 collapsed the safety mount. The legacy hand-rolled handlers under `/api/auth/{login,logout,register,...}` were deleted in the same phase.

---

## What was done

### Web (`apps/web`)

- Added pinned deps in `package.json`:
  - `better-auth ~1.6.9` (the first 1.6.x with native Next 16 peer support;
    minor pin so patch updates flow but a 1.7 breaking change is opt-in).
  - `argon2 ^0.44.0`, `drizzle-orm ^0.45.2`, `pg ^8.20.0`, `@types/pg ^8.15.0`.
- New file `src/lib/db.ts` — Drizzle pg pool. Strips the `postgresql+asyncpg://`
  URL prefix the FastAPI side uses, so `DATABASE_URL` is shareable verbatim.
- New file `src/lib/auth.ts` — Better Auth config:
  - Email + password only (no OAuth providers — Phase 2/3).
  - Argon2id `hash`/`verify` wired in (memoryCost 19 MiB, timeCost 2,
    parallelism 1 — matches passlib defaults / api-side argon2-cffi).
  - JWT plugin: EdDSA / Ed25519, 15-min `exp`, payload
    `{ sub: user.id, email, is_admin }`.
  - additionalFields: `is_admin: boolean = false` (input: false).
  - **Spike isolation:** every BA-owned table sits under a `ba_` prefix
    (`ba_user`, `ba_session`, `ba_account`, `ba_verification`) via the
    `modelName` override on each resource. Cannot touch the legacy
    `users` / `auth_identities` / `refresh_tokens`. The plugin-managed
    `jwks` table is not currently prefixed (no override exposed by the
    plugin schema in 1.6.9 — see Phase 1 blocker #2 below).
- New file `src/app/api/ba-auth/[...all]/route.ts` — mounts `auth.handler`
  via `better-auth/next-js`'s `toNextJsHandler`. Path is `/api/ba-auth`
  not `/api/auth` (justification below).
- New file `apps/web/.env.example` — documents
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`.

### API (`apps/api`)

- Bumped `pyjwt>=2.10.0` → `pyjwt[crypto]>=2.10.0` so the `cryptography`
  package (Ed25519 backend) is installed. `cryptography 48.0.0` lands.
- New helper `src/myetal_api/core/ba_security.py`:
  - `verify_better_auth_jwt(token: str) -> dict` — fetches JWKS from
    `settings.better_auth_jwks_url`, caches with `cachetools.TTLCache`
    (10-minute TTL), refetches on `kid` miss to survive key rotation,
    verifies an EdDSA-signed JWT, returns claims.
  - Uses PyJWT's `OKPAlgorithm.from_jwk` (NOT `EdDSAAlgorithm` — that
    name does not exist in PyJWT 2.x; Ed25519 lives under the OKP key
    type). One of the small pieces of ticket drift.
- New route `src/myetal_api/api/routes/healthz.py` — `GET /healthz/ba-auth`
  takes a `Authorization: Bearer …` header, calls the helper, echoes the
  decoded claims (or 401 with the verification error in `detail`).
  Wired in `main.py` after the existing `health_routes`.
- `core/config.py` gains `better_auth_jwks_url: str = ""` (empty default
  so test envs that never use the spike don't blow up).
- **Untouched, per the spike rules:** `services/auth.py`, `services/oauth.py`,
  `core/security.py`, `oauth_providers.py`, `api/routes/auth.py`,
  `api/routes/oauth.py`, `api/deps.py::get_current_user`. No Alembic migration
  was written. No legacy table truncation.

---

## What builds & verifies

| Check | Result |
|---|---|
| `pnpm install` (workspace) | OK, 1265 pkgs added |
| `pnpm --filter @myetal/web typecheck` | clean |
| `pnpm --filter @myetal/web build` | clean — both `/api/auth/*` legacy routes and `/api/ba-auth/[...all]` appear in the route table |
| `uv sync` (api) | OK, `cryptography 48.0.0` & `pyjwt 2.12.1` installed |
| `uv run ruff check` (new files) | clean |
| `uv run mypy` (new files only) | clean (`# type: ignore[import-untyped]` on `cachetools` matches the repo's existing tolerance for stub-less deps like `boto3`/`qrcode`) |
| `uv run pytest -q` | 265 passed in 21s — no regression |
| Offline Ed25519 sign/verify smoke | Passing — generated an Ed25519 keypair, stood up a fake JWKS HTTP server, signed a token with PyJWT, fed it through `verify_better_auth_jwt`, got the expected claims back. Output captured during the spike: `OK {'sub': 'u1', 'email': 'a@b.com', 'is_admin': False, 'exp': …}` |

The offline sign-and-verify is the strongest proof we can produce in
the agent environment — see "Live curl runbook" below for the missing
piece.

---

## Live curl runbook (what a human runs to close out Phase 0)

The agent environment has no Postgres running, so the full live trio
(Postgres → Next.js → FastAPI) was not stood up. To complete the
"signed JWT minted in Next.js, verified in Python" exit criterion:

```bash
# 0. Postgres up (Pi dev DB or local container)
docker compose up -d postgres   # or whatever your Pi compose does

# 1. apps/web — set env, start dev server
cat > apps/web/.env.local <<'EOF'
DATABASE_URL=postgresql://myetal:myetal@localhost:5432/myetal
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
pnpm --filter @myetal/web dev    # http://localhost:3000

# 2. apps/api — set env, start uvicorn
cat >> apps/api/.env <<'EOF'
BETTER_AUTH_JWKS_URL=http://localhost:3000/api/ba-auth/jwks
EOF
cd apps/api && uv run uvicorn myetal_api.main:app --reload --port 8000

# 3. Sign up — note the path is /api/ba-auth, not /api/auth
curl -sX POST http://localhost:3000/api/ba-auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"spike@example.com","password":"hunter2hunter2","name":"Spike"}' \
  -c /tmp/ba.cookies | jq .

# 4. Fetch the JWT (the JWT plugin exposes /token; cookie-authenticated)
JWT=$(curl -s http://localhost:3000/api/ba-auth/token -b /tmp/ba.cookies | jq -r .token)
echo "$JWT" | head -c 60 && echo "..."

# 5. Verify cross-stack
curl -s http://localhost:8000/healthz/ba-auth \
  -H "Authorization: Bearer $JWT" | jq .
# expect 200 with { ok: true, claims: { sub, email, is_admin: false, ... } }
```

If step 5 fails with `BETTER_AUTH_JWKS_URL is not configured`, the FastAPI
process didn't pick up the env var — restart it after editing `.env`.

If it fails with `no JWKS key matched kid=…`, Better Auth has rotated
keys since the last cache fill. The helper auto-refetches once, so this
should self-heal; if it persists, the JWKS endpoint URL is wrong.

---

## Decisions that diverged from the ticket

1. **Mount path is `/api/ba-auth/[...all]`, not `/api/auth/[...all]`.**
   The legacy hand-rolled handlers live at `/api/auth/{login,logout,
   register,cookie-set,github,google,orcid}`. Next 16 *would* in theory
   route those explicit segments before the catch-all, but the ticket
   explicitly told the spike to take the `/api/ba-auth` path "if there's
   any name collision risk … to avoid breaking the legacy flow". I chose
   the safe option. Phase 1 deletes the legacy handlers and renames to
   `/api/auth/[...all]` as part of the cutover.

2. **PyJWT exposes Ed25519 under `OKPAlgorithm`, not `EdDSAAlgorithm`.**
   Ticket pseudocode (`from jwt.algorithms import EdDSAAlgorithm`) is
   wrong for PyJWT 2.x. Ed25519 keys are JWK type `OKP`; the class is
   `OKPAlgorithm.from_jwk`. Verified end-to-end with a generated
   keypair — see smoke test above.

3. **No Alembic migration written.** The ticket's Phase 0 step says only
   "drizzle adapter creates its own tables on first request" — but
   Better Auth's drizzle adapter actually requires the tables to already
   exist, OR you run `npx @better-auth/cli generate` to emit a Drizzle
   schema and migrate yourself. **This is a Phase 1 blocker** — a human
   needs to decide: (a) write a Drizzle migration, (b) write an Alembic
   migration that creates `ba_user/session/account/verification/jwks`,
   (c) use `npx @better-auth/cli migrate` against the dev DB. Spike does
   none of these because that's destructive enough to be out of scope.

4. **`cryptography` lands transitively via `pyjwt[crypto]`.** Ticket said
   "use python-jose or pyjwt[crypto]"; I picked pyjwt because pyjwt was
   already a direct dep — no new top-level package added.

5. **Cache implementation is hand-rolled, not `PyJWKClient`.** PyJWT's
   stock client doesn't expose a "force refetch on kid miss" hook,
   which we need to survive Better Auth's key rotation cleanly.
   `cachetools.TTLCache` is already a top-level dep in this repo
   (used elsewhere) so no new dep added.

---

## Phase 1+ blockers — read before proceeding

1. **No live verification was performed in the agent environment.**
   No Postgres was running locally. The cross-stack identity claim is
   proven offline (the helper verifies a token I signed myself with a
   matching JWK), but the round-trip through `better-auth/sign-up/email`
   → BA's JWT plugin → JWKS endpoint → FastAPI was not exercised. The
   runbook above is five minutes of work for someone with the Pi DB up.

2. **Better Auth drizzle adapter migration story is unresolved.** The
   adapter does NOT create tables on first request (despite what the
   ticket implies). Phase 1 needs to pick one of:
     - Run `npx @better-auth/cli generate` and commit the emitted
       Drizzle schema + a generated migration. Live with two migration
       systems (Drizzle + Alembic) on the same DB.
     - Write the BA tables in Alembic by hand, matching BA's expected
       schema (`id text/uuid PK`, `email`, `emailVerified bool`, etc.).
       Easier ops but every BA upgrade requires re-checking schema drift.
   **Recommendation: option (b) — single migration system, single source
   of truth, and the BA schema is small.** The CLI generator output can
   serve as a reference template even if not committed.

3. **`jwks` table prefix not applied.** The JWT plugin's schema definition
   in `better-auth/dist/plugins/jwt/schema.d.mts` does not currently expose
   a `modelName` override — it's a fixed `jwks`. If a `jwks` table happens
   to exist in our domain schema it would collide. Verified our schema does
   NOT have a `jwks` table today (grep on `models/*.py` returns nothing),
   so this is not an immediate blocker, but Phase 1 should either confirm
   the same or upstream a `modelName` option for the plugin.

4. **`additionalFields` UUID concern from the ticket is real.** Better
   Auth defaults `id` to `text` (random string). The ticket's plan
   to keep the FK type as `uuid` requires either:
     - Configuring BA to use `uuid` IDs (look for an `advanced.database.generateId`
       hook in the BA options — unverified in 1.6.9).
     - Casting at the FK boundary, which is ugly.
   **Phase 1 must explicitly verify BA emits uuid-typed `id` on Postgres
   before any FK migration.**

5. **Argon2 cold-start cost not measured.** The ticket flagged Vercel
   cold starts as a risk. The spike runs `argon2.hash` synchronously
   in the Route Handler; first-request latency is not measured here.
   Phase 1 should benchmark on Vercel preview before locking 19 MiB
   memoryCost.

6. **No mobile work touched.** Per the spike rules. `apps/mobile`
   needs Phase 4.

7. **Web middleware (`apps/web/src/middleware.ts`) still does the legacy
   refresh dance.** It is unmodified and continues to work for the
   legacy flow. Phase 3 rewrites it to use `auth.api.getSession()`.

---

## Single biggest risk the ticket did not capture

**The spike's stated goal was "Better Auth's drizzle adapter creates
its own tables on first request" — that's not how the drizzle adapter
works.** Drizzle is a schema-first ORM; the adapter expects tables to
exist. This means:

- The "minimal viable Drizzle setup" the ticket describes is actually
  not minimal: it has to ship a schema definition AND a way to
  materialise it (migration, push, or hand-written DDL).
- Phase 0's exit criterion ("signed JWT minted, verified in Python")
  cannot be hit in a fully-automated `pnpm dev && curl …` flow without
  also running a migration step. Plan accordingly.

Adjacent: there is **no drift-detection tooling** between Better Auth's
expected schema and whatever we write in Alembic. If Better Auth 1.7
adds a column we'll find out by getting a 500 from a sign-up call.
A small "BA schema sanity check" service on boot (count columns,
compare to the BA-emitted reference) would catch this in seconds.
Not in scope here, but a worthwhile Phase 1 polish.

---

## Things I want human input on

- **Confirm the `/api/ba-auth` mount choice for the spike.** It's the
  conservative pick; if you'd rather see the catch-all already at
  `/api/auth` in this branch (relying on Next's explicit-segments-win
  routing) that's a 60-second move. I'd still keep the `basePath` config
  in `lib/auth.ts` so the swap is one diff line.
- **Drizzle migration vs Alembic migration for BA tables in Phase 1.**
  See blocker #2.
- **Whether to ship the `is_admin` JWT claim from day one of the cutover
  or wait.** Phase 0 includes it because the ticket explicitly requested
  it, but `is_admin` is currently sourced from `users.is_admin` and
  the cutover migration will reset that to `false` for everyone. The
  pre-cutover comms should mention re-granting admin.
