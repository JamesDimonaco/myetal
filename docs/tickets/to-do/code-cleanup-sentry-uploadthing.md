# Code cleanup — Sentry SDK + UploadThing dead code

**Status:** Backlog — opportunistic cleanup, no urgency
**Created:** 2026-05-09
**Owner:** James
**Effort estimate:** ~30 min total

---

## TL;DR

Two abandoned dependencies / patterns left in the codebase after the project moved on. Both are cosmetic — they don't break anything — but worth a single-PR sweep to keep the dependency surface honest.

---

## What's left

### 1. Sentry SDK (replaced by PostHog)

PostHog now does both product analytics AND error tracking. The Sentry SDK was wired in early and never removed.

**To remove:**
- `apps/api/pyproject.toml` — drop `sentry-sdk[fastapi]>=2.18.0` from dependencies.
- `apps/api/uv.lock` — re-lock with `uv lock`.
- `apps/api/src/myetal_api/core/observability.py` — delete the `init_sentry()` function and the `sentry_sdk` / `FastApiIntegration` / `StarletteIntegration` imports. Keep `configure_logging()` and `RequestIDMiddleware` (those are structlog, not Sentry).
- `apps/api/src/myetal_api/main.py` — remove the `init_sentry` import and the `init_sentry()` call (line ~29).
- `apps/api/src/myetal_api/core/config.py` — delete `sentry_dsn: str = ""` and `sentry_traces_sample_rate: float = 0.1`.
- `apps/api/tests/test_observability.py` — delete `test_init_sentry_noop_when_dsn_empty` and `test_init_sentry_reports_true_when_dsn_present`. Keep tests for `RequestIDMiddleware` and `configure_logging` if any.

Env-var references already removed from `.env.example` and `apps/api/.env.example` (commit `f3bdcec` on `staging`).

### 2. UploadThing token

Originally used for PDF upload before the Cloudflare R2 swap. No code in the repo reads `UPLOADTHING_TOKEN` anymore.

**To remove:**
- Local-only file: `apps/web/.env.prod` (gitignored) — delete the `UPLOADTHING_TOKEN=...` line.
- Search the web app and confirm no leftover `import "uploadthing"` or similar in `apps/web/src/` (likely already clean — the UploadThing migration was a clean replacement).

### 3. Stretch — pre-existing mypy + eslint debt

Bundled with the BA cutover follow-ups ticket (`better-auth-followups.md` §9). Listed there because the same review pass discovered them. Cross-reference rather than duplicate here.

---

## Verification

After cleanup:
- `cd apps/api && uv sync && uv run ruff check && uv run mypy src/myetal_api/ && uv run pytest -q`
- `cd apps/api && docker build .` succeeds
- API container size shrinks (a few MB — `sentry-sdk` pulls in `urllib3` extras etc.)

---

## Why deferred

- Production hasn't been migrated to Railway yet (separate `railway-migration-future` ticket).
- Staging just stabilised; deeper code changes shouldn't piggyback while the loop is still being tested.
- Zero functional impact — Sentry is currently a no-op (empty `SENTRY_DSN` defaults to disabled init).

Pick this up when the next "I have 30 minutes between tickets" gap appears.
