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

## Publish toggle context

Shares are searchable only when `published_at IS NOT NULL`. The "Publish to discovery" toggle on the share editor controls this. Shares that are `is_public = true` but NOT published are still accessible via their QR/URL — they're just not in search results.

This means:
- User creates a share → it's reachable by QR but NOT searchable
- User toggles "Publish to discovery" → now it appears in search
- User unpublishes → disappears from search, QR still works

---

## Decisions needed

1. **Should search also match paper titles within shares?** Recommendation: no for v1, yes for v2.
2. **Pagination style:** infinite scroll or "Load more" button? Recommendation: "Load more" (simpler).
3. **Minimum query length:** 2 characters (same as paper search).
4. **Should we show a "Browse all" view with no query?** Could show recently published shares. Nice for discovery but adds complexity. Recommendation: defer — just require a search query.

---

## Out of scope

- Full-text search with `tsvector` (decided against in discovery ticket D5)
- Author profile pages
- Category/topic browsing
- Search within paper content (v2)
- Search analytics (what people search for) — could be a PostHog event
- Autocomplete/suggestions
