# Better Auth cutover — deploy day runbook

**Status:** TO DO (deploy-day deliverable; not "done" until you actually run it)
**Created:** 2026-05-08 (Phase 6)
**Owner:** James
**Trigger:** merging `feat/better-auth-migration` into `main`.

This is the operational checklist for the cutover deploy. Each line is
designed to be actionable in <30 seconds. Run sequentially. If any
"Verify" line fails, **stop and fix before proceeding** — partial
state on this migration is hard to roll back from after step 5.

---

## Pre-cutover (T-7 days)

- [ ] Send the first comms email to every test address from
  `auth_identities WHERE provider='password'` and `users WHERE email
  IS NOT NULL`. Subject: "MyEtAl auth rebuild — your account will be
  wiped on <DATE>." Include the re-sign-up link and the date.
- [ ] Create the Resend account on `myetal.app`; verify DKIM + SPF
  records green in the Resend dashboard.
- [ ] Generate `BETTER_AUTH_SECRET`: `openssl rand -base64 32`. Save
  to a password manager.
- [ ] Add to Pi `.env`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `RESEND_API_KEY`, `EMAIL_FROM`.
  (`BETTER_AUTH_JWKS_URL` and `BETTER_AUTH_ISSUER` auto-derive from
  `BETTER_AUTH_URL`; override only if behind a path-rewriting proxy.)
- [ ] Add to Vercel project (web): same set, `DATABASE_URL` pointing
  at the same Pi Postgres.
- [ ] Add `${BETTER_AUTH_URL}/auth/mobile-bounce` to Google, GitHub,
  and ORCID OAuth provider allow-lists alongside the existing BA
  callback URLs (per `apps/api/DEPLOY.md` §"OAuth provider
  allow-lists for mobile").
- [ ] Verify CI is green on `feat/better-auth-migration` (every
  required gate: ruff, mypy, pytest, web typecheck, web build, mobile
  typecheck).

## T-1 day

- [ ] Send the second comms email. Same list, "tomorrow" framing.
- [ ] Take a Pi DB snapshot:
  `docker exec myetal-db-1 pg_dump -U myetal myetal_prod > /tmp/pre-cutover-$(date +%F).sql`
- [ ] `scp pi:/tmp/pre-cutover-*.sql` to a workstation backup. Verify
  the dump is non-empty.
- [ ] Extract test-user emails for the post-cutover admin re-grant
  list:
  `docker exec ... psql -c "SELECT u.email FROM users u JOIN auth_identities ai ON ai.user_id = u.id WHERE u.is_admin = true;" > /tmp/cutover-admin-emails.txt`

## Cutover

- [ ] `git checkout feat/better-auth-migration && git pull` — confirm
  HEAD matches CI's last green commit.
- [ ] Re-run the full local verification gates (ruff, mypy, pytest,
  web typecheck, web build, mobile typecheck). All green.
- [ ] Open the merge PR; merge to `main`. **No squash** — preserve
  the phase-by-phase commit history.
- [ ] On Pi: `cd /home/pi/myetal && sudo /usr/local/bin/myetal-backup.sh`
  (extra snapshot taken AFTER the dump above, immediately before the
  destructive migration runs).
- [ ] `docker compose pull && docker compose down`.
- [ ] `docker compose run --rm api uv run alembic upgrade head --sql > /tmp/migration.sql`
  — review the SQL on screen before applying. Confirm it includes
  TRUNCATE statements you expect and the BA table CREATEs.
- [ ] `docker compose up -d`. Watch `docker compose logs -f api` for
  the alembic upgrade run; expect 0016 applied followed by uvicorn
  boot.
- [ ] Verify JWKS: `curl -s https://myetal.app/api/auth/jwks | jq '.keys | length'`
  — expect `>= 1`.
- [ ] Verify FastAPI 401 path: `curl -s -o /dev/null -w "%{http_code}\n" https://api.myetal.app/me`
  — expect `401`.
- [ ] Sign up a fresh test account on web. Verify dashboard loads.
- [ ] Sign up a fresh test account on mobile (dev build, against
  prod). Verify dashboard loads.
- [ ] Run all 10 rows of the ORCID smoke matrix from
  `done/better-auth-orcid-flow.md` §3. Tick each row in a working
  copy of that doc.
- [ ] Re-grant admin:
  `docker exec ... psql -c "UPDATE users SET is_admin = true WHERE email = ANY(ARRAY['james@example.com', ...]);"`
  (note: v1 admin is gated by `settings.admin_emails` env var, not
  `is_admin` column — the column is set for forward compatibility per
  `done/better-auth-known-limitations.md` §6).
- [ ] Verify admin gate: sign in as the admin email, hit
  `https://myetal.app/admin` — expect 200. Sign in as a non-admin,
  same URL — expect a friendly 403.

## Post-cutover (T+1)

- [ ] Watch PostHog for unusual sign-in failure rates (session-start
  events, 401 spikes on `/me`).
- [ ] Watch the Resend dashboard for bounced emails (password reset +
  verification).
- [ ] Tail FastAPI logs for unexpected `/healthz/ba-auth` hits — any
  caller still using the deleted spike route is on stale config.
- [ ] Confirm legacy auth surfaces are gone:
  `curl -s -o /dev/null -w "%{http_code}\n" https://api.myetal.app/auth/me`
  expects `404`. `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.myetal.app/auth/login`
  expects `404` or `405`.
- [ ] Confirm `auth_identities` and `refresh_tokens` are dropped:
  `docker exec ... psql -c "\dt" | grep -E 'auth_identities|refresh_tokens'`
  — expect no rows.
- [ ] After 48h with no regressions, archive `pre-cutover-<date>.sql`
  to long-term backup and delete the working copy.

## Rollback (only if cutover verification fails)

- [ ] Revert the merge commit on `main`; `git push`.
- [ ] On Pi: `docker compose down && docker compose pull`.
- [ ] Restore the pre-cutover dump:
  `docker exec -i myetal-db-1 psql -U myetal myetal_prod < /tmp/pre-cutover-<DATE>.sql`
  (drops everything that came after first; order matters).
- [ ] `docker compose up -d`. Confirm legacy auth flows respond.
- [ ] Send a third comms email: "We rolled the migration back, your
  test account is restored, no action needed."
