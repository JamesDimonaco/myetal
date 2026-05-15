# Pre-launch codebase review

Drive-by audit of `staging` (`666664d`) ahead of web launch.
Findings only — nothing changed. Grouped by impact, not domain.

---

## TL;DR

- **Two real launch gaps**: `apps/web/src/app/layout.tsx:27` references `/favicon.ico` which doesn't exist in `public/`, and there is no root-level `opengraph-image.tsx` so home/browse/dashboard share previews fall back to nothing.
- **One scaling landmine**: the `_presign_cache` in `apps/api/src/myetal_api/api/routes/shares.py:47` is process-local. If Railway runs >1 uvicorn worker, every PDF upload fails.
- Otherwise the codebase is in launch-ready shape — very little dead code, caching is consistent, tombstone semantics are end-to-end.

---

## Cut these before launch

| Path | Reason |
|---|---|
| `apps/web/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Zero refs in `src/`. `create-next-app` residue. |
| `apps/web/src/app/demo/` (route + `demo-tour.tsx`) | Linked only from anonymous landing hero. Decide: keep as growth surface vs let `HomeBrowseSection` (real data, below it) do the same job. |
| `apps/api/src/myetal_api/api/routes/shares.py:218` — `DELETE /shares/{id}/publish` | Verify wire format matches `usePublishShare` / `useUnpublishShare` in the optimistic-toggle path. If the un-toggle silently no-ops, this is the same root cause as the still-open "publish double-press regression" in `feedback-round-3-bug-bag.md`. |

## Fix these before launch

**`apps/web/src/app/layout.tsx:25-29` — broken favicon.** Layout declares both `/favicon.svg` (exists) and `/favicon.ico` (does NOT exist). 404 for every page load in Safari. Drop the `.ico` line or generate one.

**`apps/web/src/app/` — no root OG image.** Only `app/c/[code]/opengraph-image.tsx` exists. `/`, `/browse`, `/sign-in`, `/dashboard/*` fall back to a missing image when linked anywhere. Layout already sets `openGraph.siteName` and `twitter.card = 'summary_large_image'` (`layout.tsx:31-37`) — those cards look broken without an image. A static `public/og-image.png` referenced from layout metadata fixes everything except `/c/[code]` (already has dynamic OG).

**`apps/api/src/myetal_api/api/routes/shares.py:47` — `_presign_cache` is process-local.** Comment admits "single-worker uvicorn deploy means one process owns the cache." Railway prod likely runs multiple uvicorn workers behind its proxy. If it does, R2 presign + record-upload calls route-hash differently and every PDF upload fails. Either pin workers=1 in the start command (and document it), or move the cache to Postgres (~30 line table). Verify before launch.

**`apps/api/src/myetal_api/models/better_auth.py:79` vs `apps/web/src/lib/db-schema.ts:56` — `User.image` column drift.** Migration `0016` added `image VARCHAR(2000)`, Python model + drizzle schema both have it, but no code path reads or writes it (`Grep` for `users.image` / `user.image` returns nothing). Better Auth populates this for OAuth users automatically. Either start using it (canonical avatar from Google/GitHub/ORCID) or note the intentional dual-column. Silent landmine — a future "rename `avatar_url` → `image`" PR will break every avatar render.

**`apps/api/src/myetal_api/services/share.py:1009-1015` — `_allocate_short_code` retries silently.** Loops up to 10 attempts, raises `ShortCodeCollision`. The route layer (`shares.py:118-123`) only catches tag exceptions, so collision exhaustion surfaces as a 500. Add a `logger.warning` on retry ≥ 5 and translate the exception to 503 in the route. Trivial change, future-proofs scale.

**`apps/web/src/middleware.ts:31-39` — cookie-presence is not a session check.** Stale-cookie users get past middleware and only bounce at the layout's `/me` round-trip, causing a flash of dashboard shell before redirect. Not a security issue (the `/me` 401 still fires) — but worth noting in the known-limitations doc alongside the mobile equivalent.

## Nice to have, not blocking

- `apps/web/src/app/dashboard/search/search-results.tsx:25-33` exposes sort options (`newest`, `most_items`) the backend doesn't honour (`apps/web/src/app/browse/page.tsx:50-57` calls this out — `_VALID_BROWSE_SORTS = {recent, popular}`). Trim the dropdown or implement.
- `apps/web/src/app/c/[code]/page.tsx:207-214` fires one OpenAlex fetch per DOI in `Promise.all`. Cached at 1h via `next.revalidate`. Acceptable; a batch `/works?filter=doi:A|B|C` would be one request instead of N.
- `apps/api/src/myetal_api/models/share.py:113` — `ShareItem.doi` index may be dead weight now that `share_papers` is the canonical join. Check `pg_stat_user_indexes` after a week, drop if scan count == 0.
- Telegram feedback failures log and swallow (`apps/api/src/myetal_api/services/telegram.py`). No metric — if it silently breaks on prod you'll only notice when pings stop.
- `apps/web/src/components/share-editor.tsx:1067-1119` `PdfFields` re-renders on every keystroke in the title field. Cosmetic.

## Pleasantly surprised by

- **Caching discipline.** Every public read sets `Cache-Control: public, s-maxage=...` with `stale-while-revalidate`, and `next.revalidate` mirrors the same TTL (`app/c/[code]/page.tsx:34`, `app/sitemap.ts:34`, `app/browse/page.tsx:45`). Three places, one strategy.
- **Tombstone 410 vs 404 semantics** end-to-end (`services/share.py:143-174`, `api/routes/public.py:35-45`, frontend at `app/c/[code]/page.tsx:180-199`). Search-engine-friendly; rare at this product stage.
- **PDF upload orphan-safe ordering.** `api/routes/shares.py:416-513` — the failure-mode reasoning in the comments is exemplary. The design earns the complexity.
- **Better Auth migration docs.** `auth.ts:155-189` and the case-convention rules in `apps/web/AGENTS.md` will save the next contributor a full day.
- **Empty-state coverage.** `share-list.tsx:148-211` handles four distinct empty states (brand-new, has-library-no-shares, all-drafts, all-empty-drafts) with bespoke copy each.
