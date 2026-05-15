# Ticket index

`done/` is the historical record. `to-do/` is the queue, ordered by priority.

When a ticket ships, `git mv` it into `done/` so the queue stays clean.

**Current state (2026-05-11):** Better Auth is **live on staging** (Vercel preview + Pi). All four sign-in paths (email + Google + GitHub + ORCID) verified end-to-end. Prod cutover blocked on: pre-cutover comms email + final smoke pass.

---

## To do (priority order)

| # | Ticket | Effort | Why this priority | Depends on |
|---|---|---|---|---|
| 1 | **[prod-cutover-checklist](to-do/prod-cutover-checklist.md)** | ~1 hour active + 7 days spread for comms | **Promote BA from staging to main → Railway.** Destructive Alembic, T-7 comms, smoke matrix. The single biggest near-term gate. | staging baked |
| 2 | **[better-auth-cutover-runbook](to-do/better-auth-cutover-runbook.md)** | ~2 hours (deploy-day) | Companion to #1 — more detailed runbook for the actual cutover sequence. Use #1 as the checklist, #2 as the deep reference. | same as #1 |
| 3 | **[better-auth-followups](to-do/better-auth-followups.md)** | ~5-7 days | **Account linking across email / Google / GitHub / ORCID** — owner-prioritised UX gap. Plus 9 smaller post-cutover hardening items (mobile sign-out server-revoke, exchange-code refactor, ORCID private-email recovery, hard email verification flip, mypy/eslint debt, etc). | Better Auth cutover run |
| 4 | **[railway-migration-future](to-do/railway-migration-future.md)** | ~5-7 days | **Mostly done — Railway prod is live.** This ticket originally scoped the migration; now mostly executed. May need final docs cleanup. | none |
| 5 | **[feedback-round-3-bug-bag](to-do/feedback-round-3-bug-bag.md)** | ~1-2 days | Seven user-reported bugs/polish items, mostly already addressed (color-scheme, OAuth icons, clear-recents). Open items: publish-to-discovery double-press regression, ORCID-button-greyed edge cases. | none |
| 6 | **[qr-poster-pdf](to-do/qr-poster-pdf.md)** | ~1.5 days | Print-ready A4 PDF download from the share's QR modal. The QR is the bridge from physical → digital; this makes that bridge actually printable. | none |
| 7 | **[auth-integration-tests](to-do/auth-integration-tests.md)** | ~1 day | The test that would have caught all of today's BA-config-drift bugs. Postgres-via-testcontainers + vitest exercising the BA write paths. | none |
| 8 | **[form-error-surfacing](to-do/form-error-surfacing.md)** | ~30-60 min | Route hidden-field Zod errors to a friendly banner instead of leaking the raw message. Captured after today's `file_size_bytes=0` confusion. | none |
| 9 | **[comments-on-shares](to-do/comments-on-shares.md)** | ~6 days | Deferred for user testing. Pull off the shelf when usage data justifies it. | none |
| 10 | **[email-notifications-future](to-do/email-notifications-future.md)** | ~3-4 days | Comment notifications go in-app first. Email digest only matters once comments are active and noisy. | Comments shipped |
| 11 | **[code-cleanup-sentry-uploadthing](to-do/code-cleanup-sentry-uploadthing.md)** | done (~15 min) | **Sentry SDK removed in commit `574ba97`.** UploadThing was already unused; just need to delete the line from local `.env.prod`. Ticket should move to done/. | none |
| 12 | **[gha-node20-deprecation](to-do/gha-node20-deprecation.md)** | done (~10 min) | **Bumped to Node 24-compatible actions in commit `a9f84e8`.** Ticket should move to done/. | none |
| 13 | **[pdf-virus-scanning-future](to-do/pdf-virus-scanning-future.md)** | ~1.5 days (Pi) / ~2-3 days (Railway) | Defensive depth. PR-C v1 has MIME magic-bytes + `pdftoppm` timeout — sufficient at our scale. | none |
| 14 | **[discovery-and-handles-future](to-do/discovery-and-handles-future.md)** | ~3 days | Needs demand signal. Real `/u/{handle}` profiles wait for > 100 users or branding requests. | none |

---

## Scoped, not yet written up

Ideas surfaced by the new-ticket-scoping pass. All small, all on-wedge, but **none urgent enough to write up as full tickets yet**. Park here so they're remembered without bloating to-do/. Promote to a proper ticket when one becomes urgent.

| Idea | Effort | One-line value |
|---|---|---|
| **bulk-doi-paste** | ~1.5-2 days | Paste a list of DOIs once and add them all to a share or library. Fan-out via existing `/papers/lookup`. Park until someone has 20 papers and complains. |
| **share-cover-image** | ~2 days | Custom OG/Twitter card image on the public share viewer. Reuses the R2 upload pipeline from PDFs. Park until owners ask for branding. |
| **duplicate-share** | ~1.5 days | "Duplicate this share" → clone items + tags into a new draft with a fresh `short_code`. Useful for talks/posters/grants. Park until the use case surfaces in feedback. |
| **share-presenter-mode** | ~1 day | Big-text, swipeable view of a share's items at `/c/{code}/present` for live conference talks. Reuses `PublicShareResponse`. Park; ship and watch analytics if anyone asks. |
| **drag-to-reorder + inline title rename** | ~1-2 days | Up/down arrow reorder already works on both platforms; this is a UX polish upgrade to drag-and-drop + inline-title editing. |
| **migrate-middleware-to-proxy-ts** | ~10 min | Next.js 16 deprecates `middleware.ts` in favour of `proxy.ts`. Codemod available. Do once sign-in is stable in prod. |
| **api-on-railway-only-cleanup** | ~30 min | Pi prod stack still running as hot fallback. After 48h of Railway stability, take down `docker compose down` on the Pi to free resources. |

---

## Done (historical record)

Listed by domain, not strict chronology.

### Auth + identity
- [better-auth-migration](done/better-auth-migration.md) — fresh-start cutover off hand-rolled JWT/Argon2 onto Better Auth (Next.js Route Handler). Drops `auth_identities` + `refresh_tokens`; FastAPI verifies BA-minted JWTs via JWKS. Six phases. **Live on staging as of 2026-05-10.** Awaits prod cutover.
- [better-auth-spike-notes](done/better-auth-spike-notes.md) — Phase 0 spike record (cross-stack identity proof). Historical only.
- [better-auth-orcid-flow](done/better-auth-orcid-flow.md) — Phase 5 ORCID flow audit + 10-row smoke matrix. Hijack-hardening + `disableImplicitLinking` posture preserved through the cutover.
- [better-auth-known-limitations](done/better-auth-known-limitations.md) — record of every "important but non-blocking" gap accepted for v1 (mobile sign-out doesn't invalidate server session, JWT-in-bounce-URL TTL, soft email verification, admin re-grant, etc.) with file:line and fix paths.
- [orcid-integration-and-account-linking](done/orcid-integration-and-account-linking.md) — Phase A: ORCID OAuth sign-in, manual ORCID iD entry, auto-populate on sign-in. (Phase B account linking now lives inside the Better Auth migration.)
- [orcid-import-and-polish](done/orcid-import-and-polish.md) — Phase A.5: works import via `/me/works/sync-orcid`, library auto-fire on first visit, profile section polish, error handling, mobile parity.

### Library + works
- [works-library-and-orcid-sync](done/works-library-and-orcid-sync.md) — manual DOI entry, Crossref hydration, library page, hide/restore, ORCID auto-import pipeline.

### Discovery + browse + search
- [public-discovery-and-collaboration](done/public-discovery-and-collaboration.md) — sitemap, browse, similar/trending, public viewer, tombstone semantics, share reports.
- [public-discovery-and-collaboration-AUDIT](done/public-discovery-and-collaboration-AUDIT.md) — paired audit doc.
- [public-share-search](done/public-share-search.md) — `/public/search` against shares + paper authors + (now) users.
- [browse-popular-collections](done/browse-popular-collections.md) — partial-index work for the browse `published_at DESC` query.

### Round 2 (the big one)
- [feedback-round-2-tags-comments-pdf-discovery](done/feedback-round-2-tags-comments-pdf-discovery.md) — PR-A (Tags), PR-B (Filtering + Discovery), PR-C (PDF upload via R2). Shipped end-to-end with three review rounds. **PR-D (Comments) extracted to its own to-do ticket.**

### Infra (2026-05-08 to 2026-05-11)
- Staging environment on Pi via Twingate SSH auto-deploy + Vercel preview branch ready for testing. Postgres exposed for cross-stack BA writes (commit `07b0bee`).
- Railway production stack live at `api.myetal.app` (PostgreSQL plugin, env vars synced, GitHub auto-deploy from `main`).

### Auth UI + product surfaces
- [ui-overhaul-auth-dashboard-feedback](done/ui-overhaul-auth-dashboard-feedback.md) — sign-in / sign-up flow, dashboard, share cards, avatar, feedback button.
- [user-feedback-system](done/user-feedback-system.md) — in-app feedback form, Telegram notification.
- [admin-legal-footer](done/admin-legal-footer.md) — privacy policy, ToS, footer.

### Observability
- [posthog-observability](done/posthog-observability.md) — error tracking + analytics + consent provider.

---

## Removed

- `postgres-pi-to-neon-migration.md` — superseded by `railway-migration-future.md`. Pi-to-Neon was never executed; the new plan is Pi → Railway with Postgres co-resident on Railway. Stale doc removed.
