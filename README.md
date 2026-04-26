# MyEtal

Researchers share their published work via QR codes. Scan a poster, get the
collection. Generate one for your own talk in two taps.

The brand plays on **et al.** — every researcher writes "Smith et al., 2024"
in citations. Your collection is *your et al.*

---

## Repo layout

```
myetal/
├── apps/
│   ├── api/        FastAPI backend  → https://api.myetal.app
│   ├── mobile/     Expo (iOS + Android) — bundle id app.myetal.mobile
│   └── web/        Next.js 15       → https://myetal.app
└── docker-compose.yml   Local dev stack (postgres + api + auto-migrations)
```

Backend is the single source of truth. Mobile and web both consume the same
JSON contract. OAuth credentials live only on the server (BFF pattern) — the
client apps never carry secrets.

---

## Quick start (local dev)

```bash
# 1. Bring up postgres + the API on http://localhost:8000
docker compose up -d --build

# 2. Mobile dev server (separate terminal)
pnpm install
pnpm --filter @myetal/mobile start --clear
# Press i for iOS sim, a for Android, or scan with Expo Go on a real phone

# 3. Web dev server (separate terminal, optional)
pnpm --filter myetal-web dev
# → http://localhost:3000
```

Verify the backend:

```bash
curl http://localhost:8000/healthz       # → {"status":"ok",...}
open http://localhost:8000/docs          # Swagger UI
```

---

## Environment variables

Each app loads its own `.env` (gitignored). Templates committed as `.env.example`.

| App | Dev | Prod |
|---|---|---|
| `apps/api/` | `.env` (your local OAuth creds, LAN IP for phone testing) | `.env.prod` → scp to `/etc/myetal/.env` on the server |
| `apps/web/` | `.env.local` | `.env.prod` → paste into Vercel env vars |
| `apps/mobile/` | `.env.example` only — runtime values come from `eas.json` per build profile | EXPO_PUBLIC_API_URL set in `eas.json` `production` profile |

OAuth is server-only — see [`apps/api/DEPLOY.md`](apps/api/DEPLOY.md) for the
prod secrets recipe (root:root, mode 600, mounted read-only into the
container).

---

## Common commands

### Backend

```bash
cd apps/api
uv sync --all-groups
uv run pytest                      # 80 tests
uv run ruff check .                # lint
uv run ruff format .               # format
uv run alembic upgrade head        # apply migrations to current DATABASE_URL
uv run alembic revision --autogenerate -m "..."   # new migration
uv run python scripts/cleanup_refresh_tokens.py   # nightly cron job
```

### Mobile

```bash
pnpm --filter @myetal/mobile start --clear        # Metro dev server
pnpm --filter @myetal/mobile exec tsc --noEmit    # typecheck
pnpm --filter @myetal/mobile exec expo lint       # lint

# EAS builds (consumes quota — see apps/mobile/EAS.md)
cd apps/mobile
npx eas build --profile development --platform ios
npx eas build --profile production --platform all
```

### Web

```bash
pnpm --filter myetal-web dev          # Next.js dev server
pnpm --filter myetal-web build        # production build
pnpm --filter myetal-web exec tsc --noEmit
```

---

## Deployment

- **Backend** → James's home server, dockerised behind Caddy. Image published
  to GHCR via `.github/workflows/api-image.yml` on every push to `main`.
  Manual `docker pull && docker compose up -d` to roll out.
  Full recipe: [`apps/api/DEPLOY.md`](apps/api/DEPLOY.md).
- **Web** → Vercel, auto-deploys from `main`. Env vars configured in the
  Vercel dashboard.
- **Mobile** → EAS Build → App Store + Play Store via `eas submit`.
  Recipe and Universal Links setup: [`apps/mobile/EAS.md`](apps/mobile/EAS.md).

---

## Auth providers

Server handles all OAuth via the BFF pattern — no native SDK on mobile.

| Provider | Status | Notes |
|---|---|---|
| Email + password | ✅ working | Argon2id hashes, refresh tokens with reuse-detection |
| GitHub | ✅ working | Separate OAuth Apps for dev / prod |
| Google | ⏳ creds in place | Single Web client serves all platforms |
| ORCID | ⏳ awaiting sandbox approval | Primary CTA for academics once live |

---

## Stack reference

- **Backend** — FastAPI 0.115, SQLAlchemy 2.x async, Alembic, Postgres
  (Neon `eu-west-2` in prod, local Postgres in dev), uv-managed Python 3.13,
  Sentry, structlog, slowapi, bcrypt+argon2-cffi, PyJWT, Crossref + OpenAlex
  for paper lookup
- **Mobile** — Expo SDK 54 + expo-router (file-based), React Native 0.81,
  TanStack Query, expo-secure-store, expo-camera (QR scan + barcode), zod,
  reanimated for animations, expo-haptics
- **Web** — Next.js 15 App Router, Tailwind, server components by default,
  TanStack Query, httpOnly session cookies
- **Tooling** — pnpm workspaces, Turborepo (lightly), uv (Python), ruff,
  pytest, EAS Build, GitHub Actions

---

## Useful pointers when something breaks

- **Metro can't resolve a new package** → restart with `pnpm --filter @myetal/mobile start --clear`. Any time we add a dep.
- **`docker compose up` fails on first run** → check the alembic step in the api-1 logs; the migration must succeed before uvicorn boots.
- **OAuth callback says "redirect_uri mismatch"** → the URL in the OAuth app's settings must exactly match `${PUBLIC_API_URL}/auth/{provider}/callback`. PUBLIC_API_URL comes from `apps/api/.env`.
- **EAS build fails at "Install dependencies"** → `apps/mobile/eas-build-pre-install.sh` upgrades pnpm via corepack. If you see ERR_PNPM_UNSUPPORTED_ENGINE, that script didn't run (chmod +x?).
- **Tests fail locally but pass in CI** → likely an `apps/api/.env` value bleeding into a test. The OAuth start-URL tests pin `PUBLIC_API_URL` via monkeypatch as the canonical fix pattern.
