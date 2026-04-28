# MyEtAl

**Share your research with a QR code.** Researchers create curated collections of papers, repos, and links, then generate a scannable QR for their poster, slides, or CV. Viewers get instant access — no sign-up needed.

The brand plays on **et al.** — every researcher writes "Smith et al., 2024" in citations. Your collection is *your et al.*

**Live:** [myetal.app](https://myetal.app) | **API:** [api.myetal.app](https://api.myetal.app/docs) | **Mobile:** Android preview available, iOS coming soon

---

## What's here

```
myetal/
├── apps/
│   ├── api/        FastAPI backend (Python 3.13)
│   ├── mobile/     Expo / React Native (iOS + Android)
│   └── web/        Next.js (App Router, Tailwind)
├── docs/
│   └── tickets/    Planning docs for upcoming features
└── docker-compose.yml
```

## Features

- **Create shares** — curated collections of papers, GitHub repos, and links
- **QR codes** — each share gets a permanent short URL and scannable QR
- **Paper search** — find papers by DOI or title search (powered by OpenAlex + Crossref) with citation counts, open access badges, keywords, and retraction warnings
- **Public discovery** — search published collections, browse trending and recent shares
- **Analytics** — view counts per share with daily breakdown
- **OAuth sign-in** — Google, GitHub (ORCID coming soon)
- **Publish to discovery** — opt-in to make your share searchable and indexed by Google
- **Feedback system** — feature requests and bug reports with Telegram notifications
- **Privacy-first** — no tracking cookies on public pages, PostHog analytics with consent banner, GDPR-compliant

## Current status

MyEtAl is in active development. The core product (create shares, generate QR codes, scan and view) is working. We're building out discovery features, improving the mobile experience, and preparing for a public launch.

### Recently shipped
- Public share search with `pg_trgm` typo-tolerant matching
- Browse trending and recently published collections
- Enriched paper search (citations, OA status, keywords, PDF links)
- Cookie consent + PostHog analytics and error tracking
- Feedback system with Telegram notifications
- Terms of service and comprehensive privacy policy
- Unified OAuth-first auth page
- User avatars from OAuth providers
- Dark mode support on mobile
- Session replay (web only) for debugging

### Coming soon
- ORCID sign-in (sandbox registration pending)
- Better Auth migration (replacing hand-rolled JWT)
- Migration from Raspberry Pi to Railway for production hosting

---

## Quick start

### Prerequisites
- [pnpm](https://pnpm.io/) (v9+)
- [Docker](https://www.docker.com/) (for the API + Postgres)
- [Node.js](https://nodejs.org/) (v20+)

### Local development

```bash
# Clone
git clone https://github.com/JamesDimonaco/myetal.git
cd myetal

# 1. Start the API + Postgres
docker compose up -d --build

# 2. Install JS dependencies
pnpm install

# 3. Mobile dev server
pnpm --filter @myetal/mobile start --clear
# Press i for iOS sim, a for Android, or scan with Expo Go

# 4. Web dev server (optional)
pnpm --filter myetal-web dev
# → http://localhost:3000
```

Verify the API:
```bash
curl http://localhost:8000/healthz       # → {"status":"ok",...}
open http://localhost:8000/docs          # Swagger UI
```

### Environment variables

Each app loads its own `.env` (gitignored). Copy from `.env.example`:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
# Web: cp apps/web/.env.example apps/web/.env.local
```

Key variables:
- **API:** `DATABASE_URL`, `SECRET_KEY`, OAuth credentials (`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, etc.)
- **Mobile:** `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`
- **Web:** `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_API_URL`

---

## Contributing

We welcome contributions! Here's how to get involved:

### Getting started

1. Fork the repo and create a branch from `main`
2. Follow the local development setup above
3. Make your changes
4. Run tests and type-checks:
   ```bash
   # API tests
   cd apps/api && .venv/bin/python -m pytest tests/ -q

   # Web type-check
   cd apps/web && npx tsc --noEmit

   # Mobile type-check
   cd apps/mobile && npx tsc --noEmit
   ```
5. Open a pull request

### What we're looking for

- **Bug fixes** — especially UI/UX issues on mobile
- **Accessibility improvements** — screen reader support, keyboard navigation
- **Performance** — reducing bundle size, optimising queries
- **Documentation** — improving inline docs, adding JSDoc/docstrings
- **Tests** — we have 148 API tests but web/mobile test coverage is low

### Guidelines

- Keep it simple — don't add complexity that isn't needed yet
- Follow existing patterns — check how similar code is structured before adding new patterns
- Don't hardcode secrets — all API keys and tokens go in `.env` files (this is a public repo)
- Run tests before submitting — PRs that break tests won't be merged
- One feature per PR — easier to review and revert if needed

### Project structure

- **API patterns:** FastAPI dependency injection (`CurrentUser`, `DbSession`), Pydantic schemas for request/response, SQLAlchemy async ORM, Alembic migrations
- **Web patterns:** Server components by default, `serverFetch` for authed server-side data, `clientApi` for client-side mutations (proxied through `/api/proxy/*` for cookie-based auth), TanStack Query for caching
- **Mobile patterns:** Expo Router (file-based), `api()` from `@/lib/api` with auto-refresh, theme tokens from `@/constants/theme`, `useColorScheme` for dark/light mode

---

## Auth providers

| Provider | Status | Notes |
|---|---|---|
| Email + password | Working | Argon2id hashes, refresh token rotation |
| GitHub | Working | OAuth via BFF pattern |
| Google | Working | OAuth via BFF pattern |
| ORCID | Pending | Awaiting sandbox approval — primary CTA for academics |

---

## Tech stack

- **API:** FastAPI, SQLAlchemy 2.x async, Alembic, Postgres, Python 3.13
- **Web:** Next.js 16, Tailwind CSS, TanStack Query, PostHog
- **Mobile:** Expo SDK 54, React Native 0.81, TanStack Query, PostHog
- **Infra:** Docker, Vercel (web), EAS Build (mobile), Raspberry Pi (dev API), Railway (production API — planned)
- **Data:** OpenAlex + Crossref for paper metadata, `pg_trgm` for search

---

## Useful links

- **Planning docs:** [`docs/tickets/`](docs/tickets/) — feature specs for upcoming work
- **API deployment:** [`apps/api/DEPLOY.md`](apps/api/DEPLOY.md)
- **Mobile builds:** [`apps/mobile/EAS.md`](apps/mobile/EAS.md)
- **Privacy policy:** [myetal.app/privacy](https://myetal.app/privacy)
- **Terms of service:** [myetal.app/terms](https://myetal.app/terms)

---

## Troubleshooting

- **Metro can't resolve a package** → `pnpm --filter @myetal/mobile start --clear`
- **Docker compose fails** → check `docker compose logs api` for migration errors
- **OAuth "redirect_uri mismatch"** → the callback URL in your OAuth app settings must match `${API_URL}/auth/{provider}/callback`
- **EAS build fails** → make sure `apps/mobile/eas-build-pre-install.sh` is executable (`chmod +x`)
- **Tests fail locally** → check that no `.env` values are bleeding into tests

---

## License

This project is source-available. Contact [dimonaco.james@gmail.com](mailto:dimonaco.james@gmail.com) for licensing questions.
