# Ticket index

`done/` is the historical record. `to-do/` is the queue, ordered by priority.

When a ticket ships, `git mv` it into `done/` so the queue stays clean.

---

## To do (priority order)

| # | Ticket | Effort | Why this priority | Depends on |
|---|---|---|---|---|
| 1 | **[better-auth-migration](to-do/better-auth-migration.md)** | ~2 weeks | **Foundational + cheap-while-no-real-users.** Replaces hand-rolled auth before the user base matters. Unblocks account linking, makes comments richer, hardens the auth layer. Owner direction: ship before going to "proper prod prod." Fresh-start cutover (test accounts nuked) skips dual-mode complexity. | none |
| 2 | **[railway-migration-future](to-do/railway-migration-future.md)** | ~5-7 days | Reliability — moves prod off home internet + SD card. Plan recommends *"after Round 2 bakes for 2-4 weeks"*. Pi becomes staging. Better Auth lands first so we're not migrating two foundations at once. | Better Auth shipped |
| 3 | **[qr-poster-pdf](to-do/qr-poster-pdf.md)** | ~1.5 days | Print-ready A4 PDF download from the share's QR modal. The QR is the bridge from physical → digital; this makes that bridge actually printable. Cheap, on-wedge, ship-on-a-Saturday-afternoon. | none |
| 4 | **[comments-on-shares](to-do/comments-on-shares.md)** | ~6 days | Deferred for user testing. Locked decisions (Q11-B, Q12-A, Q13). Pull off the shelf when usage data justifies it. | none (Better Auth would help cleaner identity, not strictly required) |
| 5 | **[email-notifications-future](to-do/email-notifications-future.md)** | ~3-4 days | Comment notifications go in-app first. Email digest only matters once comments are active and noisy. | Comments shipped |
| 6 | **[pdf-virus-scanning-future](to-do/pdf-virus-scanning-future.md)** | ~1.5 days (Pi) / ~2-3 days (Railway) | Defensive depth. PR-C v1 has MIME magic-bytes + `pdftoppm` timeout — sufficient at our scale. Revisit on first abuse incident or > 100 PDF uploads/month. | none |
| 7 | **[discovery-and-handles-future](to-do/discovery-and-handles-future.md)** | ~3 days | Needs demand signal. Today: owner-name links route to `/browse?owner_id=` (works, ugly URL). Real `/u/{handle}` profiles wait for > 100 users or branding requests. | none |

---

## Scoped, not yet written up

Ideas surfaced by the new-ticket-scoping pass. All small, all on-wedge, but **none urgent enough to write up as full tickets yet**. Park here so they're remembered without bloating to-do/. Promote to a proper ticket when one becomes urgent.

| Idea | Effort | One-line value |
|---|---|---|
| **bulk-doi-paste** | ~1.5-2 days | Paste a list of DOIs once and add them all to a share or library. Fan-out via existing `/papers/lookup`. No new endpoint. Park until someone has 20 papers and complains. |
| **share-cover-image** | ~2 days | Custom OG/Twitter card image on the public share viewer. Reuses the R2 upload pipeline from PDFs. Park until owners ask for branding. |
| **duplicate-share** | ~1.5 days | "Duplicate this share" → clone items + tags into a new draft with a fresh `short_code`. Useful for talks/posters/grants. Park until the use case surfaces in feedback. |
| **share-presenter-mode** | ~1 day | Big-text, swipeable view of a share's items at `/c/{code}/present` for live conference talks. Reuses `PublicShareResponse`. Park; ship and watch analytics if anyone asks. |
| **drag-to-reorder + inline title rename** | ~1-2 days | Up/down arrow reorder already works on both platforms; this is a UX polish upgrade to drag-and-drop + inline-title editing. Park until someone calls the arrow flow clunky. |

---

## Done (historical record)

Listed by domain, not strict chronology.

### Auth + identity
- [orcid-integration-and-account-linking](done/orcid-integration-and-account-linking.md) — Phase A: ORCID OAuth sign-in, manual ORCID iD entry, auto-populate on sign-in. (Phase B account linking deferred to Better Auth.)
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

### Auth UI + product surfaces
- [ui-overhaul-auth-dashboard-feedback](done/ui-overhaul-auth-dashboard-feedback.md) — sign-in / sign-up flow, dashboard, share cards, avatar, feedback button.
- [user-feedback-system](done/user-feedback-system.md) — in-app feedback form, Telegram notification.
- [admin-legal-footer](done/admin-legal-footer.md) — privacy policy, ToS, footer.

### Observability
- [posthog-observability](done/posthog-observability.md) — error tracking + analytics + consent provider.

---

## Removed

- `postgres-pi-to-neon-migration.md` — superseded by `railway-migration-future.md`. Pi-to-Neon was never executed; the new plan is Pi → Railway with Postgres co-resident on Railway. Stale doc removed.
