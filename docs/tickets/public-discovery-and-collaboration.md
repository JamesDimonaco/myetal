# Ticket: Public Discovery (option 2 — narrow scope, ship the wedge)

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Last revised:** 2026-04-26 (rewrite from audit feedback)
**Estimate:** 2 weeks of focused solo work, split across two phases (see below)
**Depends on:**
- Works Library refactor (`works-library-and-orcid-sync.md`) for the `papers` + `share_papers` tables. The "who else shares this paper" and "similar shares" surfaces are gated on it. Foundational week-1 work is **not** gated and can begin in parallel.
- No hard auth dep. Anon read paths come first.

---

## What this ticket is — and what changed since v1

The original ticket tried to ship trending, search, similar-shares, collaboration, soft-network inference, and SEO in one swing. The audit (see `public-discovery-and-collaboration-AUDIT.md`) pointed out that:

- the migration story breaks today's behaviour silently (B1),
- the trending matview will lock the homepage hourly (B2),
- the Jaccard SQL doesn't compile and won't scale inline (B3),
- phase 1 is much wider than "confirm anon works" (B4),
- there's an unresolved cross-ticket question about paper ownership under collaboration (S8),
- and most of the surface area is solving problems for users we don't have yet (s7, "reality check").

**This rewrite is option 2 from the audit's reality-check.** It commits to:

1. The cheapest valuable discovery surface — "who else shares this paper" + "similar shares" — is in scope.
2. Trending **data collection** is in scope so we have history when we eventually build the UI; trending **UI is deferred**.
3. Search is **deferred entirely** — when we build it, it will be `pg_trgm` (decision recorded below).
4. Collaboration (collaborators, invites, permissions, soft-network) is **deferred entirely** — it's solving for users we don't have.
5. The audit's blockers are resolved, not papered over: tombstone deletes, cookie-first dedup, plain trending table, precomputed similar-shares, vestigial social models deleted.
6. Pre-launch only: privacy policy, takedown/reporting flow, and SEO basics are added — they are cheaper to design now than to retrofit when a publisher emails at midnight.

The result is a two-week plan, not a five-day one, but every line of it earns its place against the QR-scan-poster wedge.

---

## The user-facing pitch (unchanged from v1)

> You don't need an account to enjoy MyEtal. Scan a poster, see the
> collection — and now also see who else has these papers in their
> collections, and what shares look similar to this one. Each scan
> becomes a discovery moment. The network effect is the product.

Read = anon. Write = signed in. No friction to consume, real friction to contribute.

---

## What logged-out users can do today vs. after this ticket

| Capability | Today | After option 2 | Deferred to follow-up |
|---|---|---|---|
| Open a share by short_code | ✅ | ✅ | — |
| See who else shares a paper | ❌ | ✅ | — |
| See similar shares to the one I'm viewing | ❌ | ✅ (precomputed nightly) | — |
| Browse trending shares | ❌ | data collected silently | UI |
| Search shares / papers / authors | ❌ | ❌ | follow-up ticket (`pg_trgm`) |
| Click into an author's public works library | ❌ | ❌ | follow-up ticket |
| Share owner sees their analytics | ❌ | ✅ (web full, mobile lite) | — |
| Report an abusive / infringing share | ❌ | ✅ (minimal flow) | — |
| Gets a proper OG card when shared on social | ❌ | ✅ (`@vercel/og`) | — |

---

## Architectural decisions (recorded so future-you doesn't relitigate)

### D1. Visibility: `published_at` timestamp, not a `ShareVisibility` enum
**Resolves audit A3 + B1 + B4.**

Keep `Share.is_public` exactly as it is — it controls "URL accessibility," default `true`, today's behaviour. Add **one** new nullable column:

- `published_at: timestamptz | None` — `NULL` by default. Non-null means "owner has opted into discovery surfaces (sitemap, similar-shares panel, who-else-shares-this, future trending)."

Why this beats the three-state enum:

- Single nullable column is the smallest possible migration. No row updates needed; existing shares are `is_public=true, published_at=NULL` — link sharing keeps working, nothing new is suddenly discoverable. This was the audit's B1 concern (silent behaviour change for every existing share). Now it's no behaviour change at all.
- Nullable timestamps age better than enums (audit A4): we get publication-date sorting, "recently published" carousels, and "republish" semantics for free.
- No coordinated rename across `models/share.py` / `schemas/share.py` / `services/share.py` / `routes/public.py` (audit B4). `is_public` keeps its meaning. The new column is purely additive.

The user-visible toggle on the share editor is a single button: **"Publish to discovery"** sets `published_at = NOW()`; **"Unpublish"** sets `published_at = NULL`.

### D2. Trending data store: a plain `trending_shares` table, not a materialised view
**Resolves audit B2 + A1.**

A normal table populated by a Python cron job using `INSERT ... ON CONFLICT (share_id) DO UPDATE`. No `REFRESH MATERIALIZED VIEW` lock; no unique-index-on-matview gotcha; we control timing and locking ourselves. ~10 lines of Python in a scheduled task (existing pattern: `apps/api/scripts/cleanup_refresh_tokens.py`).

The matview can be reconsidered when we have actual scale problems. We don't, and we won't for a long time.

### D3. View dedup: cookie-primary, IP+UA+accept-language fallback
**Resolves audit A2 + S3.**

- On first anon visit to any public share, set a long-lived (1 year) opaque first-party cookie `mev` (myetal-view) — random 128-bit identifier. No PII.
- Use the cookie as the dedup key for view counting. One view per `(cookie, share_id)` per 24h.
- When no cookie is present (RSS readers, embedded webviews, naive scrapers, server-side renderers, link-preview bots), fall back to a 24-hour rotating in-memory bloom filter keyed by `hash(ip || ua || accept-language)`. Bloom = no stored hashes, no PII at rest, no key rotation hassle.
- HMAC-IP secret rotation that the v1 design needed (audit S2) is **not needed** under this model — the IP path no longer persists hashes. The privacy/dedup section reflects this.
- Logged-in users skip the cookie path and use `viewer_user_id` directly for dedup.
- `share_views` rows are pruned at **90 days** (cron job).

This correctly handles the campus-WiFi case (audit S3): 50 people in a UCL lab with 50 browsers count as 50 views, not 1. Mobile carrier CGNAT is similarly handled — different devices have different cookies.

### D4. No anti-gaming heuristics in v1
**Resolves audit S4 + S5.**

Drop the "min N IPs" trending threshold. Drop the 1.5× logged-in weight. We have zero users; we have no abuse to fight. Add these back when we observe actual gaming.

`# TODO(post-launch): revisit trending eligibility threshold + view weighting after we see real abuse patterns.`

### D5. Search is deferred
**Resolves audit S6 + s7.**

Not in scope for this ticket. Does not ship in option 2. When we build it (separate follow-up ticket), the chosen approach is:

- Postgres `pg_trgm` GIST index on `share.name || ' ' || coalesce(share.description, '') || ' ' || coalesce(papers.authors_concat, '')`.
- Handles typos, diacritics (`unaccent` extension explicitly enabled — Neon supports it), partial matches.
- Not `tsvector` (audit S6: language config trap, no typo tolerance, poor for academic content).

Recording the decision now so a future agent doesn't re-derive it.

### D6. Trending homepage UI is deferred; data collection is in scope
**Resolves audit s7 reality-check.**

Option 2 stands up `share_views` (write path) and `trending_shares` (data only). The homepage card grid + final ranking algorithm get a follow-up ticket once we have at least a few weeks of view data and at least a hundred LISTED shares to populate it. Until then, an empty trending UI on the homepage is worse than no trending UI — better to ship discovery via "similar shares" + "who else has this paper," which works on day one.

### D7. Collaboration is deferred entirely
**Resolves audit S7 + S8.**

No `share_collaborators` table, no invite flow, no permissions module, no email-invite transport. Not in scope. The audit's S8 (paper ownership under collaboration) is dodged by deferral, which means the works ticket can keep its single-owner `papers.owner_user_id` design without revisiting.

Recorded for the future ticket:

- Roles: `editor` and `viewer` (owner is implicit).
- Invites by email or @handle, rate-limited (50/owner/day, 30-day expiry on pending).
- Explicit permission enforcement module (`permissions.py`), with one decorator per role, audited across every share-mutation endpoint.
- Vocabulary lock-in (audit s6): the soft-network case names DB columns and Pydantic fields **`connection`/`connections`**, never `collaborator`/`collaborators`. The two are different products with different consent models; the type system enforces the separation, not a doc convention.
- Recommend resolving paper-ownership-under-collaboration (audit S8) by making `papers` global-by-DOI and tracking `added_by` in `share_papers` — option A in the audit. But that's the future ticket's call.

### D8. "Who else shares this paper" — in scope, inline join
**Resolves audit A4 (the cheap version).**

One query, no precompute needed, runs inline on the share view.

```sql
-- For each paper in the current share, find other published shares that also contain it.
SELECT DISTINCT sp2.share_id, s.short_code, s.name, s.owner_user_id
FROM share_papers sp1
JOIN share_papers sp2 ON sp1.paper_id = sp2.paper_id
JOIN shares s         ON s.id = sp2.share_id
WHERE sp1.share_id = :current_share_id
  AND sp2.share_id != :current_share_id
  AND s.is_public = true
  AND s.published_at IS NOT NULL
  AND s.deleted_at IS NULL
LIMIT 20;
```

`share_papers` is keyed on `(share_id, paper_id)`, the result set is small per share, this is cheap even at scale. UI: collapsible panel under each paper inside a share view.

### D9. "Similar shares" — in scope, **precomputed nightly**
**Resolves audit B3.**

Drop Jaccard for v1 (audit A4). Use **papers-in-common count**: simpler, mentally trivial for users ("3 papers in common with this share"), cheap to precompute, and we can revisit ranking later.

The precompute runs nightly via the existing scripts pattern. The full SQL it executes (valid Postgres):

```sql
-- Run inside a transaction: truncate-then-rebuild keeps it atomically consistent.
BEGIN;
TRUNCATE share_similar;

INSERT INTO share_similar (share_id, similar_share_id, papers_in_common, refreshed_at)
SELECT
    sp1.share_id          AS share_id,
    sp2.share_id          AS similar_share_id,
    COUNT(*)              AS papers_in_common,
    now()                 AS refreshed_at
FROM share_papers sp1
JOIN share_papers sp2 ON sp1.paper_id = sp2.paper_id AND sp1.share_id <> sp2.share_id
JOIN shares s1 ON s1.id = sp1.share_id
JOIN shares s2 ON s2.id = sp2.share_id
WHERE s1.is_public = true AND s1.published_at IS NOT NULL AND s1.deleted_at IS NULL
  AND s2.is_public = true AND s2.published_at IS NOT NULL AND s2.deleted_at IS NULL
GROUP BY sp1.share_id, sp2.share_id
HAVING COUNT(*) >= 1;

COMMIT;
```

Read path on the share view becomes:

```sql
SELECT s.short_code, s.name, s.owner_user_id, ss.papers_in_common
FROM share_similar ss
JOIN shares s ON s.id = ss.similar_share_id
WHERE ss.share_id = :id
  AND s.deleted_at IS NULL
  AND s.published_at IS NOT NULL
ORDER BY ss.papers_in_common DESC
LIMIT 5;
```

This addresses audit B3 by precomputing overnight rather than running an inline full-scan join per request. At 100k shares × 20 papers average, the nightly job is a single grouped self-join — Postgres eats this for breakfast and we run it once a day on idle compute.

### D10. Owner analytics — in scope
**Resolves audit "things to decide" #6.**

The view data is being collected; exposing it to the share owner is one read endpoint and one chart. It's also the most-asked-for feature you'll get from real users.

- `GET /me/shares/{share_id}/analytics` → `{ total_views, views_last_7d, top_viewed_papers (if applicable), source_breakdown }`.
- Web: full dashboard surface with sparkline + 7-day chart.
- Mobile: stripped-down version — single number + sparkline.
- Read-only. No exports, no per-IP detail, no per-cookie detail.

### D11. OG image generation — in scope (`@vercel/og`)
**Resolves audit s8.**

Per-share OG image, generated on demand by Vercel's `@vercel/og` and cached at the edge. Regenerated when the share is edited (cache-bust on `updated_at`). Critical for Twitter/Bluesky/email link previews — without this, every social share looks naked.

### D12. SEO basics — in scope
**Resolves audit s8.**

- **Sitemap** at `/sitemap.xml` — only `is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL` shares. Future profile pages will be added in their own ticket.
- **`robots.txt`** — allow indexing of published shares + future profile pages; disallow `/dashboard/`, `/me/`, `/admin/`, future search results.
- **JSON-LD `ScholarlyArticle`** markup on each share view page (one per paper inside).
- **Canonical URLs** on every share view to prevent duplicate-content penalties from short_code variants.
- `<meta name="robots" content="noindex">` on `published_at IS NULL` shares (URL-accessible but not in discovery — search engines should not index them).

### D13. Vestigial models scheduled for deletion
**Resolves audit S1.**

`apps/api/src/myetal_api/models/social.py` defines `ShareComment` and `ShareFavorite`. The original ticket explicitly disowned both ("Comments / replies / likes — not a social network"). They're vestigial. Drop:

- `apps/api/src/myetal_api/models/social.py` (the file)
- The Alembic migration that created `share_comments` and `share_favorites`
- Any imports / wiring referencing them (search audit on day one)

A reverse migration drops the tables. Add to "cleanup tasks" below.

### D14. Share deletion semantics: tombstone + 410 Gone
**Resolves audit s5.**

- Add `Share.deleted_at: timestamptz | None`.
- `DELETE /shares/{id}` flips `deleted_at = NOW()`. Row stays.
- All read paths (public route, similar-shares cron, who-else panel, sitemap, owner dashboards) filter `deleted_at IS NULL`.
- Public route returns **HTTP 410 Gone** (not 404) for tombstoned shares — search engines drop the URL cleanly.
- A separate cron permanently deletes rows where `deleted_at < now() - interval '30 days'` (cascade drops `share_papers`, `share_views`, `share_similar` rows for that share).
- The similar-shares cron's `WHERE deleted_at IS NULL` clause means tombstoned shares disappear from the precomputed table on the next nightly rebuild; the worst case is a one-day stale link.

### D15. Cloudflare in front of `api.myetal.app` — assume yes
**Resolves audit S9.**

- DNS pointed at Cloudflare; "Bot Fight Mode" on for the public read endpoints.
- Edge rate limit: **60/min anon read per IP** on `/public/*`. Cheap, blocks the cheap scrapers.
- App-layer slowapi limit stays as the fallback (existing `AUTH_LIMIT` infrastructure).
- Authed users get no special edge limit — they're already gated by cookies/JWT and the app-layer rate limiter is sufficient.
- Search endpoint is deferred so its tighter limit (audit S9) is too.

### D16. Take-down / reporting flow — in scope, minimal
**Resolves audit "things to decide" #5.**

Cheapest design-it-now-don't-fight-it-at-midnight surface in the ticket. Pre-launch is the only cheap moment to build this; the second a publisher emails about a copyrighted PDF, you'll be doing it manually otherwise.

- "Report this share" button on every public share view.
- Anon-allowed (no signup gate to report); reporter_user_id is captured if logged in.
- Minimal `/admin` route (auth-gated to `User.is_admin = true`) showing the report queue + a "tombstone this share" button.
- No moderation UI flourishes. No state machine beyond `open` → `actioned` → `dismissed`.

### D17. Privacy policy — in scope as a sub-task
**Resolves audit S2 + "things to decide" #4.**

Cannot launch IP-derived view tracking in EU/UK without one. Roughly 1 day of work.

- Page at `myetal.app/privacy`, linked from the footer + the sign-up form.
- Specifies:
  - **What we collect:** view events (cookie + IP-fallback + UA + accept-language for dedup), accounts (email, name, ORCID), papers (title/authors/DOI/year/venue).
  - **Retention:** 90 days for view events; indefinite for accounts and papers; everything deleted on user delete.
  - **Legal basis:** legitimate interest for discovery surfaces; contract for accounts.
  - **Third parties processing data:** Neon (DB), Vercel (web hosting + edge), ORCID/Crossref/OpenAlex (outgoing API calls only — no user data sent).
  - **Data subject rights:** access (covered by owner analytics + an export endpoint we ship later), delete (existing user-delete cascade), export.
- Cookie banner is **not** required — the `mev` cookie is strictly necessary for analytics and we have no marketing/tracking cookies.

### D18. Vocabulary: `connection`, never `collaborator`, for the inferred-network case
**Resolves audit s6, recorded for the deferred collaboration ticket.**

When the future ticket adds soft-network suggestions, DB columns and Pydantic fields are named `connection` / `connections`. The `collaborator` / `collaborators` name is reserved for the explicit, opt-in, mutually-accepted case. Type-system separation, not docs convention.

---

## Data model deltas

```
shares
  + ADD published_at timestamptz NULL                  -- D1: opt-in to discovery
  + ADD deleted_at   timestamptz NULL  INDEXED         -- D14: tombstone
  (is_public stays exactly as today)

share_views (new)
  See DDL below — D3.

share_similar (new)
  See DDL below — D9. Populated by nightly cron, truncated-then-rebuilt.

trending_shares (new, plain table)
  See DDL below — D2. Populated by a separate nightly cron.

share_reports (new)
  See DDL below — D16.

DELETE: share_comments, share_favorites — D13.
```

### `share_views` DDL (matches `models/share.py` patterns)

```sql
CREATE TABLE share_views (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id      UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    viewer_user_id UUID       NULL     REFERENCES users(id)  ON DELETE SET NULL,
    cookie_id     VARCHAR(64) NULL,           -- opaque, set by web; null for cookieless paths
    -- No persisted IP / UA hash. The fallback path uses a transient bloom filter (D3).
    viewed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_share_views_share_id_viewed_at ON share_views (share_id, viewed_at DESC);
CREATE INDEX ix_share_views_cookie_share       ON share_views (cookie_id, share_id) WHERE cookie_id IS NOT NULL;
```

SQLAlchemy model lives in a new `models/share_view.py` (one file per logical model, matching the existing convention).

Retention: a daily cron deletes rows where `viewed_at < now() - interval '90 days'`. Documented in privacy policy.

### `share_similar` DDL

```sql
CREATE TABLE share_similar (
    share_id          UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    similar_share_id  UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    papers_in_common  INTEGER     NOT NULL,
    refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (share_id, similar_share_id)
);
CREATE INDEX ix_share_similar_share_score ON share_similar (share_id, papers_in_common DESC);
```

Populated by the truncate-then-rebuild SQL in D9.

### `trending_shares` DDL (plain table, not a matview)

```sql
CREATE TABLE trending_shares (
    share_id      UUID        PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    score         DOUBLE PRECISION NOT NULL,
    view_count_7d INTEGER     NOT NULL,
    refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_trending_shares_score ON trending_shares (score DESC);
```

In option 2 this table is **created and populated**, but no UI reads from it. It exists so that when the trending UI ships (follow-up ticket), there's history.

The cron is a simple time-decayed sum:

```sql
INSERT INTO trending_shares (share_id, score, view_count_7d, refreshed_at)
SELECT
    v.share_id,
    SUM(EXP(-EXTRACT(EPOCH FROM (now() - v.viewed_at)) / 259200.0)) AS score,  -- 72h half-life-ish
    COUNT(*) FILTER (WHERE v.viewed_at > now() - interval '7 days') AS view_count_7d,
    now()
FROM share_views v
JOIN shares s ON s.id = v.share_id
WHERE v.viewed_at > now() - interval '14 days'
  AND s.is_public = true
  AND s.published_at IS NOT NULL
  AND s.deleted_at IS NULL
GROUP BY v.share_id
ON CONFLICT (share_id) DO UPDATE
    SET score = EXCLUDED.score,
        view_count_7d = EXCLUDED.view_count_7d,
        refreshed_at = EXCLUDED.refreshed_at;
```

### `share_reports` DDL

```sql
CREATE TYPE share_report_reason  AS ENUM ('copyright', 'spam', 'abuse', 'pii', 'other');
CREATE TYPE share_report_status  AS ENUM ('open', 'actioned', 'dismissed');

CREATE TABLE share_reports (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id           UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    reporter_user_id   UUID        NULL     REFERENCES users(id)  ON DELETE SET NULL,
    reason             share_report_reason NOT NULL,
    details            TEXT        NULL,
    status             share_report_status NOT NULL DEFAULT 'open',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actioned_at        TIMESTAMPTZ NULL,
    actioned_by        UUID        NULL     REFERENCES users(id)  ON DELETE SET NULL
);
CREATE INDEX ix_share_reports_status_created ON share_reports (status, created_at DESC);
```

---

## Phased rollout

### Week 1 — foundations (no user-visible UI changes yet)

Goal: get the data model, plumbing, and policy in place. Site looks the same after this week. The wedge keeps working unchanged.

| Piece | Effort | Risk | Audit refs |
|---|---|---|---|
| Drop `social.py` + the migration that created its tables | 0.25d | Low — no callers (verified at task start) | S1 |
| Add `Share.published_at` (nullable) | 0.25d | Low | A3, B1 |
| Add `Share.deleted_at` (nullable, indexed) | 0.25d | Low | s5 |
| Audit `services/share.py` + `routes/public.py` to honour `deleted_at` (filter reads, return 410) and to read/write `published_at` | 0.5d | Low — small surface | s5, B4 |
| `share_views` table + write path (cookie set + dedup + IP-fallback bloom filter) | 1d | Medium — new infra | A2, S3 |
| `share_similar` + `trending_shares` empty tables (no cron yet — populated in week 2) | 0.25d | Low | B2, B3 |
| `share_reports` table + minimal `/admin` queue route | 0.75d | Low — read-only + one button | takedown #5 |
| Cloudflare DNS + edge rate-limit config | 0.5d | Medium — first-time config; can be deferred to week 2 if blocked | S9 |
| Privacy policy doc + footer link | 1d | Medium — text work, not code | S2, #4 |
| Tests for everything above | 0.75d | Low | — |
| **Week 1 total** | **~5.5d** | — | — |

### Week 2 — UI surfaces (the user-visible payoff)

Goal: ship the discovery surfaces that earn this ticket's keep. Each piece reads from week-1 data. Each piece is independently shippable.

| Piece | Effort | Risk | Audit refs |
|---|---|---|---|
| Nightly cron: populate `share_similar` (D9 SQL) | 0.5d | Low | B3 |
| Nightly cron: populate `trending_shares` (data only — no UI) | 0.25d | Low | A1, D6 |
| "Who else shares this paper" panel (web + mobile) — inline join, D8 | 0.75d | Low | A4 |
| "Similar shares" panel (web + mobile) — reads from `share_similar` | 0.75d | Low | A4 |
| Owner analytics page — web full | 0.75d | Low | #6 |
| Owner analytics — mobile lite (number + sparkline) | 0.25d | Low | #6 |
| OG image generation per share via `@vercel/og` | 0.75d | Medium — first time using `@vercel/og` | s8 |
| Sitemap (`is_public AND published_at IS NOT NULL AND deleted_at IS NULL`) | 0.25d | Low | s8 |
| Robots.txt + JSON-LD `ScholarlyArticle` + canonical URLs | 0.5d | Low | s8 |
| "Publish to discovery" button on share editor (sets `published_at`) | 0.25d | Low | A3 |
| "Report this share" button → `share_reports` insert | 0.25d | Low | #5 |
| Tests for the UIs (read endpoints + permission checks on owner analytics) | 0.75d | Low | — |
| **Week 2 total** | **~6d** | — | — |

Both weeks have ~1d of buffer. Realistic elapsed for solo + day job: ~2–3 calendar weeks.

---

## What this is NOT (kept narrow on purpose)

- **No comments / replies / likes / favorites** — vestigial models scheduled for deletion (D13).
- **No following** — defer.
- **No DMs** — out of scope forever.
- **No public commenting on shares** — invites moderation we can't afford.
- **No collaborators / invites / permissions module** (D7) — defer entirely.
- **No soft-network "people you might know"** — defer; vocabulary already locked (D18).
- **No search** (D5) — `pg_trgm` decision recorded for the follow-up.
- **No trending homepage UI** (D6) — data being collected; UI ships when there's history.
- **No public profile pages** (`/u/{handle}`) — defer to its own ticket.
- **No author co-authorship inference UI** — defer.
- **No ML-based recommendations** — start dumb, stay dumb until traffic warrants.
- **No cookie banner** — only strictly-necessary cookies, none required by ePrivacy/GDPR.

---

## Deferred to follow-up tickets (decisions recorded so future-you doesn't relitigate)

### Search
- **Approach (locked):** `pg_trgm` GIST index on `share.name || ' ' || coalesce(share.description, '') || ' ' || coalesce(authors_concat, '')`. `unaccent` extension explicitly enabled. Endpoint `/public/search?q=...` debounced + min length 2 + capped to 50 results.
- **NOT `tsvector`** (audit S6: language config trap, no typo tolerance, poor for academic content).
- **Trigger to build:** when at least one tester explicitly asks, or the homepage card grid is shipped (whichever first).

### Trending homepage UI
- **Data shape (locked):** read from `trending_shares` table populated nightly, ordered by `score DESC`, joined to `shares` for display fields, filtered to `published_at IS NOT NULL AND deleted_at IS NULL`.
- **Trigger:** at least 4 weeks of `share_views` history AND at least 100 published shares with non-zero 7-day views.
- **NOT a `REFRESH MATERIALIZED VIEW`** (audit B2).
- **No anti-gaming heuristics in v1** of the UI either (D4).

### Collaboration (collaborators, invites, permissions)
- **Roles:** `editor`, `viewer` (owner is implicit). Invite by email or @handle. Rate-limited 50/owner/day; pending invites expire 30d.
- **Permission enforcement:** dedicated `permissions.py` module + a FastAPI dependency. Audit every share-mutation endpoint (~6–10 endpoints) × 3 roles in the test matrix.
- **Paper ownership under collaboration (audit S8):** recommend resolving by making `papers` global-by-DOI and tracking `added_by` in `share_papers`. Updates the works ticket too.
- **`ondelete` policy on `share_collaborators.user_id`:** decide before the migration (audit s4: `RESTRICT` is probably correct — losing an editor shouldn't silently orphan or cascade-delete).
- **Trigger:** first explicit user request, or first lab-account scenario.

### Soft network ("people you might know")
- **Naming locked:** `connection` / `connections` — never `collaborator` (D18).
- **Inference signals:** co-authorship on imported works (strongest); shares with high `papers_in_common` (medium); never view-co-occurrence (creepy).
- **Surfaced as suggestions, never as automatic links.**

### Public profile pages per user (`myetal.app/u/{handle}`)
- Depends on @handle uniqueness rules (open question below).
- Renders the user's published shares + future works library.
- Indexed (sitemap-level + meta).
- Trigger: handles ship.

### Author co-authorship inference UI
- Depends on works refactor.
- Read-only badge: "co-authored with @alice, @bob" on each paper card.
- No invite / no notification / no "add as collaborator" prompt.

---

## Cleanup tasks (do these in week 1, day 1)

- Delete `apps/api/src/myetal_api/models/social.py`.
- Delete the Alembic migration that created `share_comments` and `share_favorites`. Add a new migration that drops the tables.
- Grep for any imports of `ShareComment` / `ShareFavorite` and remove. Run the test suite to confirm no breakage.
- Drop any web/mobile UI references (the audit's S1 implies the models are vestigial — verify by search before deleting).

---

## The hard parts (in priority order, post-rewrite)

1. **Cookie + IP-fallback dedup correctness.** Easy to get wrong in a way that silently undercounts (campus WiFi case — D3 / S3) or that creates a privacy hole (audit S2). The bloom-filter fallback removes the privacy hole; the cookie path solves the undercount. Test both paths with realistic fixtures.
2. **The nightly similar-shares precompute.** SQL must be valid (the v1 ticket's wasn't — audit B3) and must complete in a reasonable window. At 100k shares × 20 papers it's a single grouped self-join on `share_papers`; should be sub-minute on Neon's mid-tier compute. Monitor the runtime as the corpus grows.
3. **Tombstone discipline.** Every read path must filter `deleted_at IS NULL`. Every cron must filter `deleted_at IS NULL`. Every cache (CDN, OG image cache, sitemap) must invalidate when `deleted_at` flips. The grep audit on day-one of week-1 is non-negotiable.
4. **OG image generation correctness.** `@vercel/og` is fast and edge-cached, but cache-busting on `updated_at` is critical or social shares serve stale previews forever.
5. **Privacy policy text quality.** Not code, but launch-blocking. Better to write a slightly conservative one now than to retroactively explain to the ICO.

---

## Open questions

- **Default value of `Share.published_at` for *new* shares: `NULL` or `NOW()`?**
  Recommendation: **`NULL`**. New shares are URL-accessible (current behaviour) but not in discovery surfaces until the owner clicks "Publish to discovery." Most-conservative-default; matches today's user mental model; avoids a "wait, why is my unfinished collection showing up on the homepage?" support ticket.
- **Should anon viewers see view counts on a share?**
  Recommendation: yes for `published_at IS NOT NULL`, no otherwise. Reinforces the published / not-published distinction visually.
- **`@handle` syntax + uniqueness rules.**
  Out of scope for option 2 (handles ship with the public profile follow-up). Recorded as a pre-req there.
- **Hosted email transport for future invite flow** (Resend / Postmark / SES).
  Out of scope for option 2 (no invites in this ticket). Recorded for the collaboration follow-up.
- **Admin route auth model.**
  Today `User.is_admin` is a boolean on the user model — sufficient for the dev being the only admin. Revisit when there are real moderators.
- **Cookie name + path scope.**
  Recommendation: `mev`, path=`/`, `Secure; HttpOnly; SameSite=Lax`, `Max-Age=31536000`. Set by the web app on first visit to any `/c/{short_code}` route, before the API call so the API can read it.

---

## Pre-reqs before starting

- [ ] **Works ticket: foundational tables shipped.** Specifically `papers` and `share_papers` need to exist before the week-2 similar-shares + who-else surfaces can be built. Week-1 is independent and can run in parallel with the works ticket.
- [ ] **Cloudflare account on `myetal.app`** (or decision to defer Cloudflare and rely on app-layer rate limits only — audit S9).
- [ ] **`@vercel/og` enabled in the web Vercel project** (no special config; just verify the build supports edge runtime).
- [ ] **Privacy policy URL reserved at `myetal.app/privacy`** (one-page Next.js route stub committed).
- [ ] **Decide cookie name + scope** (see open question — `mev` recommended).

---

## Cross-references

- **Works Library + ORCID Sync** (`works-library-and-orcid-sync.md`): provides `papers` and `share_papers`. The week-2 surfaces (D8, D9) depend on these tables. Single-owner `papers.owner_user_id` design in the works ticket is **safe to keep** because option 2 defers collaboration entirely (audit S8 dodged). When collaboration is built, that ticket should revisit ownership per audit S8 / D7.
- **Audit document** (`public-discovery-and-collaboration-AUDIT.md`): every architectural decision (D1–D18) cites the audit finding it resolves. If you want to know why a v1 idea isn't in this ticket, the audit explains it.
