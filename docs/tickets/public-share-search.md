# Ticket: Public Share Search — Discover Published Collections

**Status:** Draft
**Owner:** James
**Created:** 2026-04-28
**Estimate:** 2–3 days
**Depends on:** Discovery foundation (done), `published_at` column (done), `pg_trgm` extension on Postgres

---

## Goal

Let anyone (signed in or not) search for published shares. This is the "browse" surface — the reason someone opens MyEtAl without a specific QR code. Today, shares are only reachable via their short code URL. After this ticket, they're discoverable by title, description, author name, and paper content.

---

## User flow

### Web: `/search` page

1. User lands on `/search` (linked from landing page hero + nav + footer)
2. Search input at the top — large, prominent, autofocused
3. As they type (debounced 300ms, min 2 chars), results appear below
4. Each result card shows:
   - Share name (linked to `/c/{short_code}`)
   - Description snippet (truncated)
   - Owner name
   - Item count + type
   - "Published X days ago" from `published_at`
5. No auth required — this is a public page
6. Empty state: "Search for collections by title, author, or topic"
7. No-results state: "Nothing matched. Try different keywords."

### Mobile: Search tab or search screen

Either:
- **Option A:** Add a search bar to the landing/home screen (above "Recently viewed")
- **Option B:** Add a "Search" tab to the authed tab bar (but search should also work for non-authed users)
- **Recommended: Option A** — search bar on the landing screen, works for everyone

---

## API

### `GET /public/search?q=...&limit=20&offset=0`

Public endpoint, no auth required. Rate-limited (30/min per IP).

**Search strategy: `pg_trgm`** (decided in the discovery ticket D5)

```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT
  s.short_code,
  s.name,
  s.description,
  s.type,
  s.published_at,
  s.updated_at,
  u.name AS owner_name,
  COUNT(si.id) AS item_count,
  -- Relevance score: trigram similarity across name + description
  GREATEST(
    similarity(s.name, :query),
    similarity(COALESCE(s.description, ''), :query)
  ) AS relevance
FROM shares s
LEFT JOIN users u ON u.id = s.owner_user_id
LEFT JOIN share_items si ON si.share_id = s.id
WHERE s.is_public = true
  AND s.published_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
    s.name % :query
    OR s.description % :query
    OR u.name % :query
  )
GROUP BY s.id, u.name
ORDER BY relevance DESC, s.published_at DESC
LIMIT :limit OFFSET :offset;
```

The `%` operator is the trigram similarity operator — it matches when similarity > `pg_trgm.similarity_threshold` (default 0.3). Handles typos, partial matches, and diacritics.

**Response schema:**
```python
class ShareSearchResult(BaseModel):
    short_code: str
    name: str
    description: str | None
    type: ShareType
    owner_name: str | None
    item_count: int
    published_at: datetime
    updated_at: datetime
    relevance: float

class ShareSearchResponse(BaseModel):
    results: list[ShareSearchResult]
    total: int  # for pagination context
```

### Database setup

One-time migration (can be in a new Alembic revision):

```sql
-- Enable the extension (Neon supports it; the Pi Postgres should too)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GiST index for trigram search on share name + description
CREATE INDEX ix_shares_name_trgm ON shares USING gist (name gist_trgm_ops)
  WHERE is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX ix_shares_description_trgm ON shares USING gist (description gist_trgm_ops)
  WHERE is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL;
```

These are partial GiST indexes — they only index published, non-deleted shares, keeping the index small and fast.

### Optional: search paper content too

A more advanced version could also search within the share's papers:

```sql
-- Join through share_items to search paper titles/authors
OR EXISTS (
  SELECT 1 FROM share_items si2
  WHERE si2.share_id = s.id
  AND (si2.title % :query OR si2.authors % :query)
)
```

This makes "search for a paper title and find shares that contain it" work. Recommend deferring to v2 of this ticket — get basic share-level search working first.

---

## Web implementation

### `/search` page

- Server component that renders the search shell
- Client component `SearchResults` with the debounced input + results
- Use `clientApi` for the search requests (no auth needed but goes through the proxy for consistency)
- Results are simple cards linking to `/c/{short_code}`

### Linking

Add "Search" to:
- Landing page hero section (alongside "Sign in" and "Try the demo")
- Site footer
- Dashboard nav (for signed-in users)

### SEO

- The search page itself is indexable
- Individual result URLs are already in the sitemap
- No need for search-result-page indexing (those are dynamic)

---

## Mobile implementation

### Landing screen search bar

Add a search input to `apps/mobile/app/index.tsx` between the hero and the "Recently viewed" section:
- Text input with search icon
- On focus: navigate to a dedicated search results screen
- Or: inline results below the input (simpler, recommended for v1)

### Search results

Each result is a pressable card that navigates to `/c/{short_code}` (the public share viewer).

---

## Publish toggle context — shares are NOT public by default

**This is critical and must be clear throughout the UI.**

When a user creates a share, it is:
- `is_public = true` — the URL/QR works (anyone with the link can view it)
- `published_at = NULL` — it is **NOT discoverable** in search, sitemap, trending, or any public listing

The share is **link-accessible but not searchable**. This is the default for every new share. The user must explicitly opt in to discovery by toggling "Publish to discovery" on the share editor, which sets `published_at = NOW()`.

**The flow:**
1. User creates a share → reachable by QR/link, **NOT in search**
2. User toggles "Publish to discovery" → now it appears in search, sitemap, similar-shares panels
3. User unpublishes → disappears from search, QR/link still works
4. User deletes → tombstoned, QR returns 410 Gone, removed from everything

**UI implications for the search feature:**
- The search page should explain that only published collections appear: "Showing published collections. To make your collection searchable, toggle 'Publish to discovery' in the share editor."
- If a signed-in user searches and gets no results, consider showing: "Your shares won't appear here until you publish them to discovery."
- The share editor's "Publish to discovery" toggle description should mention search: "Make this share discoverable in search and similar collections."

---

## Decisions needed

1. **Should search also match paper titles within shares?** Recommendation: no for v1, yes for v2.
2. **Pagination style:** infinite scroll or "Load more" button? Recommendation: "Load more" (simpler).
3. **Minimum query length:** 2 characters (same as paper search).
4. **Should we show a "Browse all" view with no query?** Could show recently published shares. Nice for discovery but adds complexity. Recommendation: defer — just require a search query.

---

## Security considerations

### SQL injection: safe, but verify the ORM path

The `%` operator and `similarity()` function are Postgres-level operators, not string interpolation. As long as `:query` is bound as a SQLAlchemy `bindparam` (or passed via `text().bindparams(query=...)` / an ORM `.where()` clause), the value is escaped by libpq. **Implementation rule: never f-string or `.format()` the query value into raw SQL.** Write the endpoint using `sqlalchemy.text()` with named bind parameters, or better, use the ORM column `.op('%')` method so the parameterisation is automatic. Add a unit test that passes `'; DROP TABLE shares; --` as the query and asserts a normal empty result.

### Rate limiting: tighten from 30/min to 20/min, add result-count cap

The ticket says 30/min per IP. The existing `ANON_READ_LIMIT` in `core/rate_limit.py` is 60/min for share reads. Search is more expensive than a single-share lookup (it hits GiST indexes across the whole published corpus), so it should have a **separate, tighter limit**. Recommendation:

- Add `SEARCH_LIMIT = "20/minute"` in `core/rate_limit.py`.
- Apply it to the search route only — don't reuse `ANON_READ_LIMIT`.
- Even at 20/min with `limit=20`, a scraper can pull 400 results/min. This is acceptable for now because the results are already public (they're in the sitemap), but **log search queries as a PostHog event** (query text + result count + IP hash) so abuse patterns are visible.

### Data exposure: strip owner email, enforce published+public+non-deleted

The SQL already filters `is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL` — good. But verify these points in the implementation:

1. **Owner email must never appear in the response.** The User model has `email` — the response schema (`ShareSearchResult`) only includes `owner_name`, which is correct. Ensure the SQLAlchemy query explicitly selects `u.name` and never `u.*` or `u.email`.
2. **`is_admin` must not leak.** Same principle: never join the full User row into the response.
3. **Private shares with `published_at` set must still be excluded.** The `is_public = true` check handles this, but add a regression test: create a share with `is_public=false, published_at=now()` and confirm it never appears in search results.
4. **Soft-deleted shares must be excluded even if still published.** Already handled by `deleted_at IS NULL`, but the partial GiST index WHERE clause must match exactly — if the index says `deleted_at IS NULL` but the query doesn't, Postgres won't use the index and will seq-scan.

### Pagination abuse: cap max offset and max limit

Without caps, someone can request `?offset=100000&limit=100` and force Postgres to scan+discard 100k rows, which is both slow and enumerates the corpus size.

- **Cap `limit` to 50** (matching the discovery ticket D5 decision: "capped to 50 results"). Clamp silently; don't error.
- **Cap `offset` to 500** (25 pages of 20). Beyond that, return an empty result. This prevents full enumeration while allowing reasonable browsing.
- In the response, return `has_more: bool` instead of (or alongside) `total`. Exposing `total` tells a scraper exactly how many shares exist and how many pages to fetch. `has_more` reveals nothing beyond "there's at least one more page."

### Input validation: enforce min/max query length

- **Minimum: 2 characters** (ticket already says this). Return 400 with a clear message if violated — don't silently return empty.
- **Maximum: 200 characters.** `pg_trgm` generates O(n) trigrams from the input; a 10,000-character query produces ~10k trigrams and makes the GiST comparison expensive. 200 chars is generous for any real search. Return 400 if exceeded.
- **Strip leading/trailing whitespace** before length check.
- **Reject null bytes and control characters.** `query.strip()` then validate with a regex like `^[\P{Cc}]+$` (no control chars).

### DoS via expensive queries: set a statement timeout

Even with the GiST index, a pathological query (e.g., a string of all unique trigrams) can be slow on a large corpus.

- **Set a per-statement timeout on the search query**: `SET LOCAL statement_timeout = '3s'` before the search SELECT (inside the same transaction). If it times out, return 503 "search timed out, try a shorter query."
- Alternatively, use SQLAlchemy's `execution_options(timeout=3000)` if supported by the driver.
- This is defense-in-depth on top of rate limiting.

### Information disclosure via relevance score

The `relevance` float (0.0-1.0 trigram similarity) is safe to expose — it only tells the user how closely their query matched the share's name/description, which they can already see in the result. **No action needed**, but round to 2 decimal places to avoid leaking Postgres internal precision details.

### Additional: CORS and cache headers

- The search endpoint should return `Cache-Control: no-store` — search results are dynamic and user-specific (by query). Don't let a shared CDN cache someone's search.
- Ensure CORS allows the web frontend origin but not `*` for this endpoint (consistent with existing public routes).

---

## UI/UX design notes

### Discoverability: make search the primary entry point for non-authed visitors

The ticket already links search from the hero, nav, and footer — good. Additionally:

- **Add a search link to the public share viewer** (`/c/[code]/page.tsx`). After viewing one collection, the natural next action is "find more like this." Add a "Search collections" link in the footer section, next to "Back to MyEtAl."
- **The 404 page should suggest search.** If someone hits a dead short code, show "Collection not found. Try searching for it." with a link to `/search`.
- **SEO: add `<link rel="search" ...>` OpenSearch description** so browsers offer MyEtAl search in the address bar.

### Search results card design: mirror the scholarly aesthetic from `/c/[code]`

Each result card should feel like a miniature version of the public share viewer. Based on the existing `font-serif` + `text-ink` + `paper/ink` design language:

- **Title**: `font-serif text-base text-ink` (linked, underline on hover). This is the most scannable element.
- **Description**: truncated to 2 lines, `text-sm text-ink-muted`. Use CSS `line-clamp-2`.
- **Metadata row**: `text-xs text-ink-faint`, containing: owner name, share type pill (using the same `uppercase tracking-wider` pill style from `add-item-modal.tsx`), item count ("12 papers"), relative time ("3 days ago").
- **Do NOT show the relevance score to the user.** It's meaningless to a researcher. Use it only for sort order.
- **Do show the share type as a colored pill** — collection/paper/poster/project each get a distinct but muted color, matching the `ShareType` enum. This helps researchers scan results quickly.

### Empty state: show a prompt, not a blank page

Before the user types anything:

- Show the search input (large, centered, autofocused) with placeholder text: "Search by title, author, or topic..."
- Below: a short description — "Discover published collections, reading lists, and research posters shared on MyEtAl."
- **Do not show trending/recent shares in v1** — the ticket correctly defers this. An empty prompt is better than a misleading "trending" section with 4 shares in it.

### No-results state: be more helpful than "try different keywords"

- Primary message: "No collections matched [query]" (echo back the query in a `font-medium` span so the user confirms they typed what they meant).
- Suggestions: "Check for typos, try broader terms, or search for an author name."
- **If the query is very short (2-3 chars):** hint "Try a longer search term for better results."
- **Future (v2):** run a relaxed similarity search (lower threshold) and show "Did you mean...?" with the top-1 result if its score is > 0.15.

### Mobile UX: search bar on landing screen (Option A, confirmed)

Option A is correct. Specifics:

- The search bar should sit between the hero and the "Recently viewed" section, as the ticket says.
- On tap, expand to a full-screen search experience (not inline results below the input — that gets cramped). Navigate to a dedicated search screen with results.
- The search input should have a clear (X) button once text is entered — fat-finger-friendly, at least 44x44pt tap target.
- Results on mobile: single-column card list, same info as web but with the description truncated to 1 line instead of 2.

### Filters: add type filter only, defer everything else

For v1, add a single filter row above results (only shown when results exist, mirroring the pattern in `add-item-modal.tsx`):

- **Share type pills**: paper / collection / poster / grant / project. Same toggle-pill UI as the paper search type filter — `rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase`. Multi-select.
- **No year range filter** — shares don't have a meaningful "year" (they have `published_at`, but filtering by publication month is niche).
- **No author filter** — there's only one owner per share, and the search already matches on `u.name`.
- Filters are client-side in v1 (the API returns all matching results up to the limit; the frontend filters the type). In v2 when result sets grow, push the type filter to the API as a `?type=collection` query param.

### Sort options: relevance + newest

Add a sort dropdown (same pattern as `add-item-modal.tsx`'s sort, with the `text-[10px] font-semibold uppercase` label):

- **Relevance** (default): server-side, `ORDER BY relevance DESC, published_at DESC`.
- **Newest first**: client-side re-sort by `published_at DESC`.
- **Most items**: client-side re-sort by `item_count DESC`. Useful for finding comprehensive reading lists vs. single-paper shares.
- Do NOT add "most viewed" — it requires exposing view counts in the search response, which leaks engagement metrics.

### Preview content: show first 2-3 paper titles as a snippet

Below the description, show a collapsed preview of the share's contents:

- "Contains: *Attention Is All You Need*, *BERT: Pre-training of Deep...*, and 10 more" — italic paper titles, truncated, with a count of remaining items.
- This requires the API to return the first 3 item titles in the search response. Add a `preview_items: list[str]` field (just titles, max 3) to `ShareSearchResult`. This is a cheap addition to the SQL (a lateral subquery or a post-fetch slice).
- This is the single most useful addition for a researcher deciding whether to click. A share named "ML Reading List" is useless; knowing it contains *Attention Is All You Need* is the signal.

### Visual design: scholarly, warm, paper-toned

The search page should feel like the rest of MyEtAl — `bg-paper`, `text-ink`, `font-serif` for headings, `border-rule` for card borders. Specifically:

- **Page background**: `bg-paper` (the cream/warm white).
- **Search input**: large (at least `text-lg` on desktop), with a subtle border (`border-rule`), autofocused, with a search icon (magnifying glass) inside the input on the left. Match the input style from the DOI pane in `add-item-modal.tsx`.
- **Results list**: no grid — a single-column list of cards, like a journal table of contents. Each card has `border-b border-rule` (no box border, just a bottom divider). This is calmer and more academic than bordered cards.
- **Max width**: `max-w-2xl` centered, matching the public share viewer.
- **Spacing**: generous — `py-10 sm:py-14` top/bottom, `space-y-4` between cards.

### Progressive disclosure: hover/tap to expand description

- On desktop: show description truncated to 2 lines. On hover, expand to full description (CSS `hover:line-clamp-none` transition, or a "show more" link).
- On mobile: always show 1 line. Tap the card to navigate (don't expand in-place — that conflicts with the link behavior).
- Do NOT add a full preview panel/modal. The `/c/[code]` page IS the detail view; search results should drive clicks to it.

### Accessibility: keyboard navigation + screen reader labels

- **Search input**: `role="searchbox"`, `aria-label="Search published collections"`.
- **Results list**: `role="list"`, each result is `role="listitem"`.
- **Keyboard**: Tab to search input, type to search, Tab to first result, Enter to navigate. Arrow keys are not needed for a simple list (Tab is sufficient).
- **Loading state**: use `aria-live="polite"` on the results container so screen readers announce "Loading..." and "N results found" without interrupting.
- **Focus management**: after results load, keep focus on the search input (don't steal focus to results). The user is still typing.
- **Color contrast**: ensure type pills and metadata text meet WCAG AA (4.5:1 for small text). The `text-ink-faint` color needs to be checked — it's often the weakest contrast in the palette.

### Pagination: "Load more" button (confirmed)

The ticket recommends "Load more" over infinite scroll — agreed. Specifics:

- Show the button centered below the last result: "Show more results" in `text-sm font-medium text-accent`.
- Hide the button when `has_more` is false (or when all results are loaded).
- Show a count: "Showing 20 of 47 results" above the Load more button.
- On mobile, "Load more" is better than infinite scroll because scroll-jacking breaks the back button and makes it hard to reach the footer.

---

## Out of scope

- Full-text search with `tsvector` (decided against in discovery ticket D5)
- Author profile pages
- Category/topic browsing
- Search within paper content (v2)
- Search analytics (what people search for) — could be a PostHog event
- Autocomplete/suggestions
