# Ticket: Browse Popular Collections — Discovery Without Searching

**Status:** Draft
**Owner:** James
**Created:** 2026-04-28
**Estimate:** 1–1.5 days
**Depends on:** Search endpoint (done), `trending_shares` table (exists, populated by cron), `share_views` table (exists)

---

## Problem

Right now, the search page requires typing before anything appears. A first-time visitor has no idea what's on MyEtAl — they see an empty input and have to guess what to search for. There's no browsing, no sense of "what's here," no social proof.

For an early-stage product, showing what exists is more important than searching for it. You need to answer: "Is this platform worth my time?"

---

## Goal

When a user lands on the search/browse page, they immediately see popular collections without typing anything. This serves three purposes:

1. **Discovery** — "Oh, there's interesting stuff here, let me look around"
2. **Social proof** — "Other researchers are using this"
3. **Onboarding** — new users understand what a "collection" looks like before creating one

---

## What to show

### Popular collections (top 10)

Ranked by view count from the `share_views` table. Only published, non-deleted, public shares.

**Ranking: two sections, not one list.**
- **"Trending this week"** — top 5 from `trending_shares` table (7-day view-weighted score). Rewards recent activity.
- **"Recently published"** — last 5 by `published_at DESC`. Rewards freshness, no view data needed.
- If trending returns < 3 results (early days), hide that section entirely and show "Recently published" with 10 slots instead of 5.

### Total collection count

A single number: "X published collections on MyEtAl"

**Query:**
```sql
SELECT COUNT(*) FROM shares
WHERE is_public = true
  AND published_at IS NOT NULL
  AND deleted_at IS NULL;
```

Show as an action-oriented label: "Browse 47 collections" (not "47 published collections on MyEtAl" — that's a vanity metric).

- **Hide when < 5** — a count of 3 draws attention to smallness
- **Show when >= 5** — becomes social proof
- Don't overthink this — it'll grow naturally

---

## API

### `GET /public/browse`

Returns popular collections and metadata for the browse page. No auth, rate-limited (same as search, 20/min).

```python
class BrowseResponse(BaseModel):
    trending: list[ShareSearchResult]   # top 5 by 7-day views (from trending_shares)
    recent: list[ShareSearchResult]     # last 5 by published_at
    total_published: int                # total count of published collections
```

Reuses the existing `ShareSearchResult` schema from search (same card rendering on the frontend).

**Why a separate endpoint instead of a parameterless search?**
- Different query (no trigram matching, different sort)
- Can be cached aggressively (`Cache-Control: public, max-age=300`) — browse results don't change per-user
- Simpler, faster — no pg_trgm overhead

### Preview items

Same as search — include first 3 item titles per collection so the cards show what's inside.

---

## Web UI

### On the `/search` page, before the user types

Replace the empty state with a browse view:

```
Search collections
[search input, autofocused]

── Trending this week ──────────────────

[collection card 1 — 42 views]
[collection card 2 — 28 views]
[collection card 3 — 15 views]
...

── Recently published ──────────────────

[collection card 1 — published 2 days ago]
[collection card 2 — published 5 days ago]
...

47 published collections on MyEtAl
```

When the user starts typing, the browse view fades out and search results take over. When they clear the input, browse comes back.

### Design

- Same card style as search results (divider-style, serif title, type pill, preview items)
- Section headers: `text-xs uppercase tracking-widest text-ink-faint` (matching the app's eyebrow style)
- View count shown on trending cards: "42 views" in muted text
- Total count at the bottom: subtle, `text-sm text-ink-faint`
- No pagination needed — it's a fixed top-10

---

## Mobile UI

Same approach on the `/search` screen:
- Before typing: show trending + recent sections
- On typing: switch to search results
- Cards match the existing search result card design

---

## Caching

The browse endpoint returns the same data for everyone. Cache aggressively:
- **API response:** `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`
- **Frontend:** TanStack Query with `staleTime: 5 * 60_000` (5 min)
- The trending_shares table is already refreshed by a nightly cron — browse data is at most 24h stale, which is fine

---

## Edge cases

### Cold start (0 published collections)
- Don't show the browse sections at all — just the search input with "Be the first to publish a collection on MyEtAl."
- Once there's >= 1 published collection, show it

### Few collections (1-4)
- Show them all under "Published collections" (no trending/recent split — not enough to split)
- Hide the total count

### Owner's own collections in results
- If a signed-in user's own published collections appear in trending/recent, that's fine — it's social proof for them too
- Don't filter them out

---

## Security

- Same rules as search: only `is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL`
- No user emails or private data in the response
- Rate limit shared with search (20/min)
- View counts are inherently public information (the owner already sees them in analytics)

---

## Review findings (addressed)

1. **Stale row cleanup in cron:** The `refresh_trending.py` cron upserts but never deletes rows for shares that were unpublished/deleted since the last run. Add a cleanup pass: `DELETE FROM trending_shares WHERE share_id NOT IN (SELECT id FROM shares WHERE is_public AND published_at IS NOT NULL AND deleted_at IS NULL)`.
2. **`ShareSearchResult` lacks `view_count`:** Add optional `view_count: int | None` to the schema. Show on trending cards only (not recent).
3. **Index for recent query:** Add `CREATE INDEX ix_shares_published_at_desc ON shares (published_at DESC) WHERE is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL` so the "recently published" query is fast.
4. **Separate rate limit:** Give browse its own limit (`BROWSE_LIMIT = "30/minute"`) so it doesn't eat into search quota.
5. **Remove the all-time-views SQL** at the top of the ticket — it contradicts the trending+recent recommendation and will mislead implementation.

---

## Decisions needed

1. **Show view count on cards?** It's motivating ("42 people viewed this") but could also feel discouraging for collections with 1-2 views. Recommendation: show on trending cards only (they're already ranked by views), not on recent cards.
2. **Section naming?** "Trending this week" / "Recently published" — or "Popular" / "New"? Keep it simple.
3. **Total count threshold?** Show when >= 5, hide below. Or always show?

---

## Out of scope

- Personalised recommendations ("because you viewed X")
- Category/topic browsing
- "Featured" / editor's picks (manual curation)
- Infinite scroll on browse (it's a fixed top-10)
