# MyEtAl

## Stack and commands

pnpm 10 + turbo monorepo. Node >= 22.13.

- `apps/api`: FastAPI, Python 3.13, uv, SQLAlchemy async, Alembic, pytest, ruff.
  `uv sync --all-groups`, then `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`.
  Local API + Postgres: `docker compose up -d --build` from the repo root.
- `apps/web` (`@myetal/web`): Next.js 16, Better Auth, Drizzle, Vitest.
  `pnpm --filter @myetal/web dev | test | lint | typecheck`. `apps/web/CLAUDE.md` holds Next.js 16 notes.
- `apps/mobile` (`@myetal/mobile`): Expo 54, EAS. `pnpm --filter @myetal/mobile start --clear`. No test script.
- `packages/api-contract`: TS types generated from the FastAPI OpenAPI spec.
  `pnpm --filter @myetal/api-contract generate` (or `check:stale`).
- Root: `pnpm build | lint | test | typecheck` run through turbo.

## Where things live

- Identity lane: personal.
- API: Railway project `myetal`, env `production`, service `api` (root `apps/api`, config
  `apps/api/railway.json`, Dockerfile build), domain `api.myetal.app`. Railway builds and redeploys
  on every push to `main`. Logs: `railway logs --service api`.
- Database: Railway service `Postgres` in the same project. Better Auth (web) and the API share it.
  Alembic owns the schema.
- Storage: Cloudflare R2 for PDFs and thumbnails (`R2_*` vars).
- Web: Vercel project `myetal-web`. `main` is production; `staging` gets a branch preview.
- Mobile: EAS project under owner `jamesdimonaco`, bundle `app.myetal.mobile`. Build from
  `apps/mobile` with `eas build --profile preview | production`.
- PostHog project 400245: `phog personal 400245 "<HogQL>"`.
- Env files: each app has a `.env.example` listing var names. API reads `apps/api/.env`, web reads
  `apps/web/.env.local`, mobile reads `apps/mobile/.env` and `.env.local` (`EXPO_PUBLIC_*`).
- Branches: feature PRs target `staging`; release PRs merge `staging` into `main`.

## Rules

- The repo is public. Never hardcode keys or tokens, even "public" ones like the PostHog key.
  Web uses `process.env.NEXT_PUBLIC_*`, mobile `process.env.EXPO_PUBLIC_*`, API `settings.*`.
  Docs name env vars, never values.
- Case conventions across the seams are locked. Do not "normalise" them:
  - snake_case: Postgres columns, SQLAlchemy attrs, FastAPI JSON bodies, JWT claims.
  - camelCase: Drizzle JS field names, Better Auth config keys and user/session objects, mobile and
    web TS code. Map vendor responses (Crossref, ORCID, GitHub) to camelCase at the seam.
  - So BA returns `user.isAdmin`, never `user.is_admin`, and Drizzle uses `users.orcidId`.
  - In `apps/web/src/lib/auth.ts` `definePayload`, `is_admin: (user as ...).isAdmin` is correct:
    left is the JWT claim, right is the JS access.
  - The `UserResponse` type keeps snake_case (`email_verified`, `orcid_id`): it is the API wire shape.
- API response types are generated. Do not hand-edit `apps/*/types/auth.ts` or
  `packages/api-contract/src/generated`. Change the Pydantic schema, then run `generate`.

## Gotchas

- CI runs only one web test file (`__tests__/auth-integration.test.ts`). The unit tests in
  `apps/web/src/**/*.test.ts` and `api-contract check:stale` never run in CI. Run them locally.
- `generate` shells out to `apps/api/.venv/bin/python`. Run `uv sync` in `apps/api` first.
- The container runs `alembic upgrade head` on boot. A failing migration crash-loops prod.
- Keep `--workers 1`: slowapi rate limits live in process memory.
- `deploy-staging.yml` still SSHes to the old Raspberry Pi and fails on every staging push.
  `apps/api/DEPLOY.md` and `docs/staging-and-prod-infra.md` also still describe the Pi.
- Railway CLI login expires. If `railway` fails on auth, ask James to run `railway login`.
