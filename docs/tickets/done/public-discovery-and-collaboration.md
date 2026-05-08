# Ticket: Public Discovery (option 2 — narrow scope, ship the wedge)

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Last revised:** 2026-04-26 (review pass — see "What changed in review pass")
**Estimate:** 2 weeks of focused solo work, split across two phases (see below)
**Depends on:**
- Works Library refactor (`works-library-and-orcid-sync.md`) for the `papers` + `share_papers` tables. The "who else shares this paper" and "similar shares" surfaces are gated on it. Foundational week-1 work is **not** gated and can begin in parallel. Migration ordering: works ticket runs first (creates `papers`/`share_papers`/`user_papers`), this ticket's week-1 migration runs second (drops `share_favorites`/`share_comments`, adds `Share.published_at`/`Share.deleted_at`/etc.). See works ticket W-s7.
- No hard auth dep. Anon read paths come first.

---

## What changed in review pass (2026-04-26)

Changelog of fixes applied in this review pass — review-finding IDs in brackets so the lineage is traceable to the per-ticket review report.

- **Cross-ticket: D7 rewritten.** Papers are global per the works ticket — the previous "single-owner safe to keep / S8 dodged" framing is wrong and is gone. This ticket's `who else shares this paper` and `similar shares` queries consume the global `papers` + `share_papers` schema. `share_papers.added_by` exists for the future editor-role collaboration story even though that collab phase is still deferred. [D-BL1 cross-ticket / W-BL1]
- **`social.py` removal: write a NEW migration, do not touch the baseline.** The original "delete the migration that created the tables" wording was dangerously wrong — `0001_baseline.py` also creates `users`, `auth_identities`, `refresh_tokens`, `shares`, `share_items`. New week-1 migration explicitly does `op.drop_table('share_favorites')` then `op.drop_table('share_comments')`. D13 + cleanup-tasks updated. [D-BL1]
- **`deleted_at` audit row enumerated.** All five call sites listed: `services/share.py:get_public_share`, `get_share_for_owner`, `list_user_shares`, `routes/shares.py` PATCH/DELETE, `routes/public.py:share_qr_png`. New helper `get_public_share_with_tombstone()` for the 410 codepath. [D-BL2]
- **Cookie dedup made enforceable.** Application-side rolling-window check before insert; race window of ≤1 dup per cookie per share per day under contention is acceptable; no DB constraint (rolling window can't be expressed cleanly). [D-BL3]
- **Next.js 16, not 15.** All `@vercel/og` references switched to `ImageResponse` from `next/og` (built into Next 16). Added a week-1 spike: read `apps/web/AGENTS.md` + `node_modules/next/dist/docs/` for Next 16 sitemap/robots/OG/edge-runtime conventions before writing any of D11/D12. [D-BL4]
- **`share_similar` stores canonical-ordered pairs `(share_id_a, share_id_b)` where `a < b`.** Read query unions both directions. Halves storage and cron work. Updated D9 SQL. [D-S-Iss1]
- **`ix_share_views_viewed_at` added** for the cron's no-share_id-predicate scan. Documented which read patterns each `share_views` index serves. [D-S-Iss2]
- **Owner self-views excluded** at write time — `if viewer_user_id == share.owner_user_id: skip`. Documented in D3 and called out in D10. [D-S-Iss3]
- **`social.py` cleanup targets enumerated** with file paths + line numbers (models/__init__.py lines 5/15/16, models/social.py, tests/test_models.py lines 8/9/23/24/53/54). [D-S-Iss4]
- **`is_public` UI hidden in v1.** New shares default `is_public=true` (current behaviour). The visible toggle is just "Publish to discovery" → controls `published_at`. `is_public=false` becomes a power-user flag with no UI in v1; deferred to a "share-with-individuals" follow-up. Both web (`apps/web/src/components/share-editor.tsx`) and mobile (`apps/mobile/app/(authed)/share/[id].tsx`) editors update. [D-S-Iss5]
- **`share_reports` uses `TimestampMixin`** instead of explicit `created_at`. Added `ix_share_reports_share_id` for admin lookups. [D-S-Iss6]
- **Mobile dedup via `X-View-Token` header**, opaque device-install token in `expo-secure-store` set at first launch. Added as D3.1. [D-S-Iss7]
- **Bot/preview-fetch UA exclusion** — server-side allowlist of preview bots (Twitterbot, facebookexternalhit, Slackbot-LinkExpanding, Discordbot, LinkedInBot, Mastodon, Bluesky, WhatsApp, TelegramBot). Skip view recording for those. Added to D3. [D-S-Iss8]
- **JSON-LD shape corrected:** outer `CollectionPage` (or `ItemList`), inner array of `ScholarlyArticle` items. Concrete shape written into D12. [D-S-Iss9]
- **Cookie dropped from anon path entirely (PECR-driven).** Bloom-filter IP+UA+accept-language fallback used for ALL anon visitors. Logged-in users dedup via `viewer_user_id`. No consent banner needed; lower-quality dedup; no PECR exposure. Mobile still uses `X-View-Token` header (header, not cookie — not subject to PECR). D3 + D17 simplified. [D-S-Iss10]
- Smaller fixes:
  - `CHECK (viewer_user_id IS NULL OR view_token IS NULL)` mutual-exclusion constraint added (logged-in vs anon).
  - Rate limit on `POST /shares/:id/report` (3/IP/hour anon, 10/user/day authed) — added to D16.
  - Half-life math: comment changed to "72h time constant (~50h half-life)" — honest about the parameter rather than re-tuning τ.
  - Sitemap entries gain `<lastmod>` from `Share.updated_at`.
  - Cloudflare BFM may challenge Googlebot — WAF skip-for-known-good-bots note added to D15.
  - Privacy policy estimate clarified: "draft you'd ship pre-launch with no real users", lawyer review is its own ticket.
  - Note that Q1 (`user_papers`) is owned by works ticket; this ticket can ignore it for v1 since the user library is a join table not a pseudo-share.
  - Data-export endpoint deferral named: "Data portability (GDPR Article 20)" follow-up ticket.

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
5. The audit's blockers are resolved, not papered over: tombstone deletes, bloom-filter dedup for anon (no cookie — D-S-Iss10), plain trending table, precomputed similar-shares with canonical-ordered pairs, vestigial social models deleted.
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
| Gets a proper OG card when shared on social | ❌ | ✅ (`ImageResponse` from `next/og`) | — |

---

## Architectural decisions (recorded so future-you doesn't relitigate)

### D1. Visibility: `published_at` timestamp, not a `ShareVisibility` enum
**Resolves audit A3 + B1 + B4. UI scoping per D-S-Iss5.**

Keep `Share.is_public` exactly as it is at the model layer — it controls "URL accessibility," default `true`, today's behaviour. Add **one** new nullable column:

- `published_at: timestamptz | None` — `NULL` by default. Non-null means "owner has opted into discovery surfaces (sitemap, similar-shares panel, who-else-shares-this, future trending)."

Why this beats the three-state enum:

- Single nullable column is the smallest possible migration. No row updates needed; existing shares are `is_public=true, published_at=NULL` — link sharing keeps working, nothing new is suddenly discoverable. This was the audit's B1 concern (silent behaviour change for every existing share). Now it's no behaviour change at all.
- Nullable timestamps age better than enums (audit A4): we get publication-date sorting, "recently published" carousels, and "republish" semantics for free.
- No coordinated rename across `models/share.py` / `schemas/share.py` / `services/share.py` / `routes/public.py` (audit B4). `is_public` keeps its meaning. The new column is purely additive.

**UI scoping (D-S-Iss5):**

- The existing `is_public` toggle in both editors is **hidden in v1**:
  - Web: `apps/web/src/components/share-editor.tsx` — remove the toggle from rendered UI; new shares default `is_public=true` server-side (current behaviour); no client control over it.
  - Mobile: `apps/mobile/app/(authed)/share/[id].tsx` — same.
- The single visible toggle on the share editor is **"Publish to discovery"**: sets `published_at = NOW()`; "Unpublish" sets `published_at = NULL`.
- `is_public=false` becomes a power-user/admin flag with no UI path in v1. A future "share with specific individuals" ticket will give it back a UI surface (e.g. as part of the deferred collaborator/invite story). Until then, it can only be set via API or admin action — acceptable since today there's no "private link" use case in production.

### D2. Trending data store: a plain `trending_shares` table, not a materialised view
**Resolves audit B2 + A1.**

A normal table populated by a Python cron job using `INSERT ... ON CONFLICT (share_id) DO UPDATE`. No `REFRESH MATERIALIZED VIEW` lock; no unique-index-on-matview gotcha; we control timing and locking ourselves. ~10 lines of Python in a scheduled task (existing pattern: `apps/api/scripts/cleanup_refresh_tokens.py`).

The matview can be reconsidered when we have actual scale problems. We don't, and we won't for a long time.

### D3. View dedup: bloom-filter for anon (no cookie), `viewer_user_id` for logged in
**Resolves audit A2 + S3. Updated per D-S-Iss10 (cookie dropped) + D-S-Iss3 (owner self-views) + D-S-Iss8 (bot exclusion). Mobile dedup in D3.1.**

- **Anon path: no cookie at all.** Dedup uses a 24-hour rotating in-memory bloom filter keyed by `hash(ip || ua || accept-language)`. Bloom = no stored hashes, no PII at rest, no key rotation hassle, **no cookie consent banner needed under PECR / EDPB**. Lower-quality dedup than cookie + (campus WiFi case partially regresses), but the legal exposure of the cookie path was meaningful and the dedup quality difference is acceptable for a pre-launch product. We can revisit later if discovery is gated on perfect counts (it isn't).
- **Logged-in users: dedup on `viewer_user_id`.** One view per `(viewer_user_id, share_id)` per 24h, enforced application-side (D-BL3): `SELECT 1 FROM share_views WHERE viewer_user_id=? AND share_id=? AND viewed_at > now() - interval '24 hours' LIMIT 1` before insert. Race window of ≤1 duplicate per user per share per day under contention is acceptable; the rolling window can't be expressed cleanly as a DB constraint.
- **Owner self-views are excluded (D-S-Iss3):** at write time, `if request.user is not None and request.user.id == share.owner_user_id: skip the insert`. This affects every analytics surface — `total_views` excludes the owner's own clicks. Documented in D10 and in the analytics endpoint contract.
- **Bot/preview-fetch exclusion (D-S-Iss8):** server-side allowlist of user-agent substrings — `Twitterbot`, `facebookexternalhit`, `Slackbot-LinkExpanding`, `Discordbot`, `LinkedInBot`, `Mastodon`, `Bluesky`, `WhatsApp`, `TelegramBot`. Match case-insensitive. Skip view recording for any UA matching the allowlist (still serve the response normally — they need it for the preview card).
- HMAC-IP secret rotation that the v1 design needed (audit S2) is **not needed** under this model — the IP path no longer persists hashes (only an in-memory bloom hash that decays in <24h).
- `share_views` rows are pruned at **90 days** (cron job).

This handles the campus-WiFi case (audit S3) less well than the cookie path would have, but well enough: bloom is keyed on `(ip, ua, accept-language)` rather than IP alone, so different browsers / OSes / language settings on the same campus IP each count separately. Mobile carrier CGNAT: same story — different devices have different UAs.

### D3.1. Mobile dedup: `X-View-Token` header
**Resolves D-S-Iss7.**

The mobile app generates an opaque random 128-bit device-install token at first launch and stores it in `expo-secure-store` (already a dependency). Every share-view API call includes it as the `X-View-Token` header.

- API treats `X-View-Token` equivalently to a logged-in `viewer_user_id` for dedup purposes when no `viewer_user_id` is present.
- Stored on `share_views.view_token` (column added — see DDL below). Mutually exclusive with `viewer_user_id` via CHECK constraint.
- **Headers are not subject to PECR/ePrivacy** in the way cookies are — first-party HTTP request metadata to a service the user is actively interacting with via a native app is not "storing or accessing information on the user's device" under the directive's wording. (We're storing in secure-store, but it's a token for the app's own service, equivalent to an API key, not a tracking identifier shared across origins.)
- If the user reinstalls the app, they get a new token. Acceptable.

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

### D7. Collaboration is deferred entirely (but the data model is ready)
**Resolves audit S7. Audit S8 resolved by works ticket, not dodged here.**

No `share_collaborators` table, no invite flow, no permissions module, no email-invite transport in v1.

**Cross-ticket consistency note (binding — supersedes the v1 framing of this section):** Papers are **global** per the works ticket (option A from audit S8). This ticket's `who else shares this paper` (D8) and `similar shares` (D9) queries consume the global `papers` + `share_papers` schema directly — they're cheap one-line queries against `share_papers` because papers are already deduplicated globally by DOI. `share_papers.added_by` exists today (added by the works ticket) for the eventual editor-role collaboration support, even though that collab phase is deferred. The previous "single-owner papers safe to keep / S8 dodged" framing is gone; do not reintroduce it.

Recorded for the future collab ticket:

- Roles: `editor` and `viewer` (owner is implicit).
- Invites by email or @handle, rate-limited (50/owner/day, 30-day expiry on pending).
- Explicit permission enforcement module (`permissions.py`), with one decorator per role, audited across every share-mutation endpoint.
- Vocabulary lock-in (audit s6): the soft-network case names DB columns and Pydantic fields **`connection`/`connections`**, never `collaborator`/`collaborators`. The two are different products with different consent models; the type system enforces the separation, not a doc convention.
- Paper ownership under collaboration is already resolved by the works ticket: papers are global, `share_papers.added_by` records who attached a paper. No further model change needed for the collab ticket.

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

**Cross-ticket note:** the works ticket's `user_papers` table is a separate, per-user "library" join (W-S5) — it is NOT a pseudo-share, so this query correctly does not surface a user's library when computing "who else shares this paper." There is no `library` row in `shares` to filter out. (If the works ticket had implemented library as a pseudo-share, we'd need an extra `WHERE s.type != 'library'` clause; it didn't, so we don't.)

### D9. "Similar shares" — in scope, **precomputed nightly, canonical-ordered pairs**
**Resolves audit B3. Updated per D-S-Iss1 (canonical pairs).**

Drop Jaccard for v1 (audit A4). Use **papers-in-common count**: simpler, mentally trivial for users ("3 papers in common with this share"), cheap to precompute, and we can revisit ranking later.

**Storage shape (D-S-Iss1):** the relation is symmetric — `(A,B)` and `(B,A)` carry identical `papers_in_common`. Storing both directions doubles the table and halves the cron's wall-clock time savings. Instead, store only canonical-ordered pairs `(share_id_a, share_id_b)` where `share_id_a < share_id_b` (UUID byte ordering — Postgres compares UUIDs natively). The read query unions both directions to recover the symmetric view.

Precompute runs nightly via the existing scripts pattern. The full SQL (valid Postgres):

```sql
-- Run inside a transaction: truncate-then-rebuild keeps it atomically consistent.
BEGIN;
TRUNCATE share_similar;

INSERT INTO share_similar (share_id_a, share_id_b, papers_in_common, refreshed_at)
SELECT
    sp1.share_id          AS share_id_a,
    sp2.share_id          AS share_id_b,
    COUNT(*)              AS papers_in_common,
    now()                 AS refreshed_at
FROM share_papers sp1
JOIN share_papers sp2 ON sp1.paper_id = sp2.paper_id AND sp1.share_id < sp2.share_id  -- canonical ordering: halves work
JOIN shares s1 ON s1.id = sp1.share_id
JOIN shares s2 ON s2.id = sp2.share_id
WHERE s1.is_public = true AND s1.published_at IS NOT NULL AND s1.deleted_at IS NULL
  AND s2.is_public = true AND s2.published_at IS NOT NULL AND s2.deleted_at IS NULL
GROUP BY sp1.share_id, sp2.share_id
HAVING COUNT(*) >= 1;

COMMIT;
```

Read path on the share view (unions both directions to recover the full neighbour set for `:id`):

```sql
SELECT s.short_code, s.name, s.owner_user_id, x.papers_in_common
FROM (
  SELECT share_id_b AS similar_share_id, papers_in_common
  FROM share_similar
  WHERE share_id_a = :id
  UNION ALL
  SELECT share_id_a AS similar_share_id, papers_in_common
  FROM share_similar
  WHERE share_id_b = :id
) x
JOIN shares s ON s.id = x.similar_share_id
WHERE s.deleted_at IS NULL
  AND s.published_at IS NOT NULL
ORDER BY x.papers_in_common DESC
LIMIT 5;
```

This addresses audit B3 by precomputing overnight rather than running an inline full-scan join per request. At 100k shares × 20 papers average, the nightly job is a single grouped self-join — Postgres eats this for breakfast and we run it once a day on idle compute. Canonical ordering halves both the table size and the cron's grouped self-join work.

### D10. Owner analytics — in scope
**Resolves audit "things to decide" #6. Self-view exclusion per D-S-Iss3.**

The view data is being collected; exposing it to the share owner is one read endpoint and one chart. It's also the most-asked-for feature you'll get from real users.

- `GET /me/shares/{share_id}/analytics` → `{ total_views, views_last_7d, top_viewed_papers (if applicable), source_breakdown }`.
- **`total_views` excludes the owner's own clicks (D-S-Iss3).** This is enforced at write time (D3) — the owner's view is never recorded — so the analytics query doesn't need a filter; total_views is naturally owner-free.
- Web: full dashboard surface with sparkline + 7-day chart.
- Mobile: stripped-down version — single number + sparkline.
- Read-only. No exports, no per-IP detail, no per-token detail.

### D11. OG image generation — in scope (`ImageResponse` from `next/og`)
**Resolves audit s8. Updated per D-BL4 (Next.js 16, not 15).**

Per-share OG image, generated on demand using **`ImageResponse` from `next/og`** (built into Next 16; do **not** install `@vercel/og` — that was the Next 14/15-era external package and is now redundant). Edge-runtime route. Cached at the edge. Regenerated when the share is edited (cache-bust on `updated_at` via the URL, e.g. `/og/{short_code}?v={updated_at_ts}`). Critical for Twitter/Bluesky/email link previews — without this, every social share looks naked.

**Implementation prerequisite (D-BL4 spike):** before writing this code, read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` for Next 16 conventions on edge-runtime routes, OG image colocation, and font loading. Next 16's `next/og` API differs in subtle ways from the Next 14/15 `@vercel/og` package — ImageResponse signature, font loading, and edge-runtime declaration all shifted.

### D12. SEO basics — in scope
**Resolves audit s8. JSON-LD shape locked per D-S-Iss9. `<lastmod>` per smaller-findings.**

- **Sitemap** at `/sitemap.xml` — only `is_public = true AND published_at IS NOT NULL AND deleted_at IS NULL` shares. Each entry includes `<lastmod>` from `Share.updated_at`. Future profile pages will be added in their own ticket. Use Next 16's built-in sitemap conventions (`app/sitemap.ts`); read the docs first per D-BL4.
- **`robots.txt`** — allow indexing of published shares + future profile pages; disallow `/dashboard/`, `/me/`, `/admin/`, future search results. Use Next 16's `app/robots.ts` (read docs first).
- **JSON-LD on each share view page** — outer `CollectionPage` (or `ItemList` if the share is more list-like; default to `CollectionPage` for a curated collection) with an inner array of `ScholarlyArticle` items, one per paper. Concrete shape (D-S-Iss9):

  ```json
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "<share.name>",
    "description": "<share.description>",
    "url": "https://myetal.app/c/<short_code>",
    "datePublished": "<share.published_at ISO 8601>",
    "dateModified": "<share.updated_at ISO 8601>",
    "author": { "@type": "Person", "name": "<share.owner.name>" },
    "hasPart": [
      {
        "@type": "ScholarlyArticle",
        "headline": "<paper.title>",
        "datePublished": "<paper.year>",
        "author": [{ "@type": "Person", "name": "<author>" }, ...],
        "identifier": [
          { "@type": "PropertyValue", "propertyID": "DOI", "value": "<paper.doi>" }
        ],
        "url": "<paper.url>",
        "publisher": { "@type": "Organization", "name": "<paper.venue>" }
      }
    ]
  }
  ```

  Implementer can copy-paste this and substitute fields. For papers without a DOI, omit the `identifier` block rather than emitting an empty one.
- **Canonical URLs** on every share view to prevent duplicate-content penalties from short_code variants.
- `<meta name="robots" content="noindex">` on `published_at IS NULL` shares (URL-accessible but not in discovery — search engines should not index them).

### D13. Vestigial models scheduled for deletion
**Resolves audit S1. Migration approach corrected per D-BL1. Cleanup targets enumerated per D-S-Iss4.**

`apps/api/src/myetal_api/models/social.py` defines `ShareComment` and `ShareFavorite`. The original ticket explicitly disowned both ("Comments / replies / likes — not a social network"). They're vestigial.

**Do NOT delete the migration that created them** — the v1 wording of this section was dangerously wrong. Those tables were created in `0001_baseline.py` (or whatever the baseline revision is in this codebase), which also creates `users`, `auth_identities`, `refresh_tokens`, `shares`, `share_items`. Deleting that file would either be ignored by Alembic (it's already applied) or, on a fresh DB, would break everything. Leave the baseline untouched.

**Instead, write a NEW Alembic revision** in week 1 that drops the two tables in the correct order:

```python
# apps/api/alembic/versions/<rev>_drop_social_tables.py
def upgrade() -> None:
    op.drop_table("share_favorites")  # has FK to shares + users; drop first
    op.drop_table("share_comments")   # has FK to shares + users

def downgrade() -> None:
    # Recreate the bare tables (we don't carry data back; nobody used them).
    op.create_table("share_comments", ...)
    op.create_table("share_favorites", ...)
```

Order: drop `share_favorites` first, then `share_comments`. (Both reference `shares` and `users`; neither references the other; either order works in practice. Doing favorites-first is a defensive habit for if either ever gains a cross-FK.)

Code-side cleanup (D-S-Iss4):

- **Edit `apps/api/src/myetal_api/models/__init__.py`** — remove imports + exports at lines 5 (the `from ... import ShareComment, ShareFavorite`), 15 and 16 (the entries in `__all__`).
- **Delete `apps/api/src/myetal_api/models/social.py`** entirely.
- **Edit `apps/api/tests/test_models.py`** — remove references at lines 8, 9 (imports), 23, 24 (probably __all__ checks), 53, 54 (the actual model usage in tests). Run the suite to confirm nothing else breaks.
- **Run a repo-wide grep** for `ShareComment`, `ShareFavorite`, `share_comments`, `share_favorites` to catch any web/mobile UI references (audit S1 implies they're absent — verify before deleting).

### D14. Share deletion semantics: tombstone + 410 Gone
**Resolves audit s5. All call sites enumerated per D-BL2.**

- Add `Share.deleted_at: timestamptz | None`, indexed.
- `DELETE /shares/{id}` flips `deleted_at = NOW()`. Row stays. Returns 204.
- A separate cron permanently deletes rows where `deleted_at < now() - interval '30 days'` (cascade drops `share_papers`, `share_views`, `share_similar` rows for that share).
- The similar-shares cron's `WHERE deleted_at IS NULL` clause means tombstoned shares disappear from the precomputed table on the next nightly rebuild; the worst case is a one-day stale link.

**All call sites that need updating (D-BL2 — week-1 audit row):**

| File:function | Behaviour |
|---|---|
| `services/share.py:get_public_share` (line 65) | Add `Share.deleted_at.is_(None)` to the `where`. Returns `None` for tombstones. The route layer decides 404 vs 410. |
| `services/share.py:get_share_for_owner` | Owner can still see their tombstoned share (with banner). Keep INCLUDED. Expose `deleted_at` in the response so the UI can show the banner. |
| `services/share.py:list_user_shares` | Exclude tombstoned by default. Add an `include_deleted: bool = False` flag — if true, include them so a future "trash" UI can list them. |
| `routes/shares.py` PATCH `/shares/{id}` | If the share is already tombstoned, return **410 Gone**. Don't allow re-edit. |
| `routes/shares.py` DELETE `/shares/{id}` | If already tombstoned, return **410 Gone** (don't allow un-delete via re-DELETE; that's a separate "restore" endpoint we're not building in v1). |
| `routes/public.py:resolve_public_share` | Tombstoned → use new `get_public_share_with_tombstone()` helper to distinguish 404 (never existed) from 410 (was tombstoned). Returns 410 with a small JSON body explaining; HTML route returns a friendly 410 page. |
| `routes/public.py:share_qr_png` | Same as above — also calls `get_public_share`; tombstone returns 410. |

**New helper to add (D-BL2):**

```python
# services/share.py
async def get_public_share_with_tombstone(db, short_code: str) -> tuple[Share | None, bool]:
    """Returns (share, was_tombstoned). For the 410 codepath in the public route.

    - (Share, False) → live share, render normally.
    - (None, True)   → tombstoned share existed under this short_code; return 410.
    - (None, False)  → no share has ever had this short_code; return 404.
    """
    share = await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner))
        .where(Share.short_code == short_code, Share.is_public.is_(True))
    )
    if share is None:
        return None, False
    if share.deleted_at is not None:
        return None, True
    return share, False
```

The existing `get_public_share` keeps its current shape but adds `deleted_at IS NULL` to the WHERE clause; routes that don't need to distinguish 404 from 410 keep using it.

### D15. Cloudflare in front of `api.myetal.app` — assume yes
**Resolves audit S9. WAF skip-for-known-good-bots per smaller-findings.**

- DNS pointed at Cloudflare; "Bot Fight Mode" on for the public read endpoints.
- **Add a WAF skip rule for known-good search/preview bots** (Googlebot, Bingbot, DuckDuckBot, plus the link-preview UAs from D-S-Iss8: Twitterbot, facebookexternalhit, Slackbot-LinkExpanding, Discordbot, LinkedInBot, Mastodon, Bluesky, WhatsApp, TelegramBot). Cloudflare's BFM is known to challenge Googlebot intermittently otherwise — that would tank our SEO. Use Cloudflare's "Verified Bots" allowlist + a custom rule for the social previewers.
- Edge rate limit: **60/min anon read per IP** on `/public/*`. Cheap, blocks the cheap scrapers.
- App-layer slowapi limit stays as the fallback (existing `AUTH_LIMIT` infrastructure).
- Authed users get no special edge limit — they're already gated by cookies/JWT and the app-layer rate limiter is sufficient.
- Search endpoint is deferred so its tighter limit (audit S9) is too.

### D16. Take-down / reporting flow — in scope, minimal
**Resolves audit "things to decide" #5. Rate-limit per smaller-findings.**

Cheapest design-it-now-don't-fight-it-at-midnight surface in the ticket. Pre-launch is the only cheap moment to build this; the second a publisher emails about a copyrighted PDF, you'll be doing it manually otherwise.

- "Report this share" button on every public share view.
- Anon-allowed (no signup gate to report); `reporter_user_id` is captured if logged in.
- **Rate limit on `POST /shares/{id}/report`:**
  - Anon: 3 reports per IP per hour (slowapi).
  - Authed: 10 reports per user per day (application-side counter against `share_reports.reporter_user_id`).
  - Same-(reporter, share) is deduped silently — second report from the same IP/user against the same share within 24h returns 200 but is a no-op.
- Minimal `/admin` route (auth-gated to `User.is_admin = true`) showing the report queue + a "tombstone this share" button (calls D14's tombstone path).
- No moderation UI flourishes. No state machine beyond `open` → `actioned` → `dismissed`.

### D17. Privacy policy — in scope as a sub-task
**Resolves audit S2 + "things to decide" #4. Updated per D-S-Iss10 (cookie dropped).**

Cannot launch IP-derived view tracking in EU/UK without one. Roughly **1 day of work — the deliverable is a draft you'd ship pre-launch with no real users.** Counsel review is a separate ticket — do not conflate the two; this ticket ships the draft, not a lawyered-up version.

- Page at `myetal.app/privacy`, linked from the footer + the sign-up form.
- Specifies:
  - **What we collect:** view events (transient bloom-filter dedup keyed on IP+UA+accept-language for anon web; `viewer_user_id` for logged-in; `X-View-Token` header for mobile-installed apps); accounts (email, name, ORCID); papers (title/authors/DOI/year/venue).
  - **No tracking cookies.** No `mev` cookie, no consent banner. The previous design used a cookie; D-S-Iss10 dropped it specifically to avoid PECR exposure and the consent banner overhead.
  - **Retention:** 90 days for `share_views` rows; indefinite for accounts and papers; everything deleted on user delete (existing cascade).
  - **Legal basis:** legitimate interest for discovery surfaces; contract for accounts.
  - **Third parties processing data:** Neon (DB), Vercel (web hosting + edge), Cloudflare (CDN/WAF), ORCID/Crossref/OpenAlex (outgoing API calls only — no user data sent).
  - **Data subject rights:**
    - **Access:** owner analytics surface + a future `/me/export` endpoint we ship as a separate "**Data portability (GDPR Article 20)**" follow-up ticket. The privacy policy explicitly names this follow-up so we're not over-promising.
    - **Delete:** existing user-delete cascade.
    - **Rectification:** by editing account fields (web UI).
- Cookie banner is **not** required — we set no cookies on the public read paths after D-S-Iss10. (Authenticated users still have a session cookie, but that's strictly necessary for the auth flow they explicitly initiated.)

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

Updated per D-S-Iss10 (no cookie column), D-S-Iss7 (`view_token` for mobile), D-S-Iss2 (extra index), and the smaller-finding mutual-exclusion CHECK constraint.

```sql
CREATE TABLE share_views (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id        UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    viewer_user_id  UUID        NULL     REFERENCES users(id)  ON DELETE SET NULL,
    view_token      VARCHAR(64) NULL,    -- D-S-Iss7: from X-View-Token header (mobile install token)
    -- No cookie_id, no persisted IP / UA hash. The anon-web path uses a transient
    -- in-memory bloom filter (D3, D-S-Iss10) and writes a row with both
    -- viewer_user_id and view_token NULL.
    viewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Logged-in vs anon-with-token mutual exclusion (smaller-findings):
    CONSTRAINT chk_share_views_viewer_xor_token
        CHECK (viewer_user_id IS NULL OR view_token IS NULL)
);

-- Read pattern: "views for one share, ordered by recency" (analytics, owner dashboard).
CREATE INDEX ix_share_views_share_id_viewed_at ON share_views (share_id, viewed_at DESC);

-- Read pattern: dedup check — "did this token view this share recently".
CREATE INDEX ix_share_views_token_share ON share_views (view_token, share_id) WHERE view_token IS NOT NULL;

-- Read pattern: dedup check — "did this user view this share recently".
CREATE INDEX ix_share_views_user_share ON share_views (viewer_user_id, share_id) WHERE viewer_user_id IS NOT NULL;

-- D-S-Iss2: read pattern for the trending cron's no-share_id-predicate scan
-- (`WHERE viewed_at > now() - interval '14 days' GROUP BY share_id`). Without
-- this index it's a seq scan on the whole table.
CREATE INDEX ix_share_views_viewed_at ON share_views (viewed_at DESC);
```

SQLAlchemy model lives in a new `models/share_view.py` (one file per logical model, matching the existing convention).

Retention: a daily cron deletes rows where `viewed_at < now() - interval '90 days'`. Documented in privacy policy.

### `share_similar` DDL

Canonical-ordered pairs (D-S-Iss1) — `share_id_a < share_id_b` always. Read query unions both directions.

```sql
CREATE TABLE share_similar (
    share_id_a       UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    share_id_b       UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    papers_in_common INTEGER     NOT NULL,
    refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (share_id_a, share_id_b),
    CONSTRAINT chk_share_similar_canonical CHECK (share_id_a < share_id_b)
);

-- Read pattern: "neighbours of share X" — needs both directions covered.
CREATE INDEX ix_share_similar_a_score ON share_similar (share_id_a, papers_in_common DESC);
CREATE INDEX ix_share_similar_b_score ON share_similar (share_id_b, papers_in_common DESC);
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
    SUM(EXP(-EXTRACT(EPOCH FROM (now() - v.viewed_at)) / 259200.0)) AS score,  -- τ=259200s (72h time constant; ~50h half-life)
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

D-S-Iss6: SQLAlchemy model uses `TimestampMixin` (gives `created_at` + `updated_at` matching the rest of the codebase) instead of a hand-rolled `created_at`. Extra `(share_id, created_at DESC)` index for the admin lookup pattern.

```sql
CREATE TYPE share_report_reason AS ENUM ('copyright', 'spam', 'abuse', 'pii', 'other');
CREATE TYPE share_report_status AS ENUM ('open', 'actioned', 'dismissed');

CREATE TABLE share_reports (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id           UUID        NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    reporter_user_id   UUID        NULL     REFERENCES users(id)  ON DELETE SET NULL,
    reason             share_report_reason NOT NULL,
    details            TEXT        NULL,
    status             share_report_status NOT NULL DEFAULT 'open',
    -- created_at + updated_at provided by TimestampMixin in the SQLAlchemy model.
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actioned_at        TIMESTAMPTZ NULL,
    actioned_by        UUID        NULL     REFERENCES users(id)  ON DELETE SET NULL
);

-- Read pattern: admin queue — open reports newest first.
CREATE INDEX ix_share_reports_status_created ON share_reports (status, created_at DESC);
-- Read pattern: admin lookup — "all reports for this share".
CREATE INDEX ix_share_reports_share_id ON share_reports (share_id, created_at DESC);
```

```python
# models/share_report.py
class ShareReport(Base, TimestampMixin):  # D-S-Iss6: TimestampMixin not hand-rolled created_at
    __tablename__ = "share_reports"
    # ... fields per DDL above
```

---

## Phased rollout

### Week 1 — foundations (no user-visible UI changes yet)

Goal: get the data model, plumbing, and policy in place. Site looks the same after this week. The wedge keeps working unchanged.

| Piece | Effort | Risk | Refs |
|---|---|---|---|
| **Spike: read `apps/web/AGENTS.md` + `node_modules/next/dist/docs/`** for Next 16 sitemap, robots, OG (`next/og`), edge-runtime conventions before writing any of D11/D12 code | 0.25d | Low | D-BL4 |
| Drop `share_favorites` + `share_comments` via NEW Alembic revision; delete `models/social.py`; update `models/__init__.py` lines 5/15/16; clean tests/test_models.py lines 8/9/23/24/53/54 | 0.25d | Low — no callers (D-S-Iss4 enumerated targets, verified at task start) | S1, D-BL1, D-S-Iss4 |
| Add `Share.published_at` (nullable) | 0.25d | Low | A3, B1 |
| Add `Share.deleted_at` (nullable, indexed) | 0.25d | Low | s5 |
| **`deleted_at` audit row (D-BL2):** update `services/share.py:get_public_share`, `get_share_for_owner`, `list_user_shares`; `routes/shares.py` PATCH/DELETE → 410 if tombstoned; `routes/public.py:share_qr_png`; add new helper `get_public_share_with_tombstone()`; `published_at` read/write paths | 0.75d | Low — small surface but five distinct call sites | s5, B4, D-BL2 |
| `share_views` table (no cookie column, view_token column, mutual-exclusion CHECK) + write path: bloom-filter dedup for anon-web, viewer_user_id dedup for logged-in (with rolling-window SELECT before insert per D-BL3), X-View-Token dedup for mobile, owner self-view skip, bot-UA allowlist skip | 1d | Medium — new infra | A2, S3, D-BL3, D-S-Iss3, D-S-Iss7, D-S-Iss8, D-S-Iss10 |
| `share_similar` (canonical pairs) + `trending_shares` empty tables (no cron yet — populated in week 2) | 0.25d | Low | B2, B3, D-S-Iss1 |
| `share_reports` table (TimestampMixin) + minimal `/admin` queue route + rate limit on POST report (3/IP/h anon, 10/user/d authed) | 0.75d | Low — read-only + one button | #5, D-S-Iss6 |
| Cloudflare DNS + edge rate-limit config + WAF skip rule for known-good search/preview bots | 0.5d | Medium — first-time config; can be deferred to week 2 if blocked | S9 |
| Privacy policy DRAFT (pre-launch ship-without-counsel) + footer link. Counsel review is a separate ticket. | 1d | Medium — text work, not code | S2, #4 |
| **Hide `is_public` toggle** in `apps/web/src/components/share-editor.tsx` and `apps/mobile/app/(authed)/share/[id].tsx`; new shares default `is_public=true` server-side | 0.25d | Low | D-S-Iss5 |
| Tests for everything above | 0.75d | Low | — |
| **Week 1 total** | **~6.25d** | — | — |

### Week 2 — UI surfaces (the user-visible payoff)

Goal: ship the discovery surfaces that earn this ticket's keep. Each piece reads from week-1 data. Each piece is independently shippable.

| Piece | Effort | Risk | Refs |
|---|---|---|---|
| Nightly cron: populate `share_similar` (D9 SQL — canonical-ordered pairs) | 0.5d | Low | B3, D-S-Iss1 |
| Nightly cron: populate `trending_shares` (data only — no UI) | 0.25d | Low | A1, D6 |
| "Who else shares this paper" panel (web + mobile) — inline join, D8 | 0.75d | Low | A4 |
| "Similar shares" panel (web + mobile) — reads from `share_similar` (UNION both directions) | 0.75d | Low | A4, D-S-Iss1 |
| Owner analytics page — web full | 0.75d | Low | #6, D-S-Iss3 |
| Owner analytics — mobile lite (number + sparkline) | 0.25d | Low | #6, D-S-Iss3 |
| OG image generation per share via `ImageResponse` from `next/og` (Next 16) | 0.75d | Medium — first time using Next 16 OG conventions; AGENTS.md spike done in week 1 | s8, D-BL4 |
| Sitemap (`is_public AND published_at IS NOT NULL AND deleted_at IS NULL`) with `<lastmod>` from `Share.updated_at` (Next 16 `app/sitemap.ts`) | 0.25d | Low | s8 |
| Robots.txt (Next 16 `app/robots.ts`) + JSON-LD (CollectionPage outer, ScholarlyArticle items per D-S-Iss9) + canonical URLs | 0.5d | Low | s8, D-S-Iss9 |
| "Publish to discovery" button on share editor (sets `published_at`) — replaces hidden `is_public` toggle | 0.25d | Low | A3, D-S-Iss5 |
| "Report this share" button → `share_reports` insert (rate-limited per D16) | 0.25d | Low | #5 |
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
- **No cookie banner** — anon read paths set NO cookies after D-S-Iss10 (auth flows still set their own session cookie, which is strictly necessary).

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
- **Paper ownership under collaboration (audit S8): ALREADY RESOLVED by the works ticket** — papers are global, `share_papers.added_by` records who attached. No further model change needed by the collab ticket.
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

D-BL1 + D-S-Iss4 enumerated targets:

- **Write a NEW Alembic revision** (do NOT touch the baseline migration — it also creates `users`, `auth_identities`, `refresh_tokens`, `shares`, `share_items`):

  ```python
  def upgrade() -> None:
      op.drop_table("share_favorites")  # has FK to shares + users; drop first defensively
      op.drop_table("share_comments")
  ```

- **Edit `apps/api/src/myetal_api/models/__init__.py`** — remove the `from myetal_api.models.social import ShareComment, ShareFavorite` at line 5 and the entries in `__all__` at lines 15 and 16.
- **Delete `apps/api/src/myetal_api/models/social.py`** entirely.
- **Edit `apps/api/tests/test_models.py`** — remove the references at lines 8, 9 (imports), 23, 24 (likely __all__/registry checks), and 53, 54 (model usage in tests). Run the test suite to confirm nothing else breaks.
- Grep the repo for `ShareComment`, `ShareFavorite`, `share_comments`, `share_favorites` to catch any remaining references in services / routes / web / mobile (audit S1 implies they're absent — verify by search before declaring done).

---

## The hard parts (in priority order, post-rewrite)

1. **Bloom-filter dedup correctness.** With cookies dropped (D-S-Iss10), the anon-web path relies entirely on a 24h rotating in-memory bloom keyed on `(ip, ua, accept-language)`. Easy to undercount (campus WiFi: same UA on same IP) or to lose state on app restart. Decision: accept the undercount, document it, ship it. Test the rolling-window logic with deliberate clock skew fixtures.
2. **Logged-in / mobile-token dedup race.** D-BL3 acknowledges a race window of ≤1 dup per (user, share) per day under contention. Test it with a parallel-request fixture and confirm the worst case is bounded.
3. **The nightly similar-shares precompute.** SQL must be valid (the v1 ticket's wasn't — audit B3) and must complete in a reasonable window. At 100k shares × 20 papers it's a single grouped self-join on `share_papers` with the canonical-ordering filter (D-S-Iss1). Should be sub-minute on Neon's mid-tier compute. Monitor the runtime as the corpus grows.
4. **Tombstone discipline (D-BL2).** Every read path must filter `deleted_at IS NULL`. Every cron must filter `deleted_at IS NULL`. Every cache (CDN, OG image cache, sitemap) must invalidate when `deleted_at` flips. The five-call-site enumeration in D14 is non-negotiable; grep before declaring done.
5. **OG image generation correctness with Next 16's `next/og`.** Different signature from the Next 14/15 `@vercel/og` package — fonts, edge-runtime declaration, and ImageResponse options have shifted. The week-1 spike (D-BL4) buys the time to read the docs first; cache-busting on `updated_at` is critical or social shares serve stale previews forever.
6. **Privacy policy draft quality.** Not code, but launch-blocking. Better to ship a slightly conservative draft now and have counsel review it later (separate ticket) than to retroactively explain to the ICO.

---

## Open questions

- **Default value of `Share.published_at` for *new* shares: `NULL` or `NOW()`?**
  Recommendation: **`NULL`**. New shares are URL-accessible (current behaviour) but not in discovery surfaces until the owner clicks "Publish to discovery." Most-conservative-default; matches today's user mental model; avoids a "wait, why is my unfinished collection showing up on the homepage?" support ticket.
- **Should anon viewers see view counts on a share?**
  Recommendation: yes for `published_at IS NOT NULL`, no otherwise. Reinforces the published / not-published distinction visually. (Note D-S-Iss3: counts are owner-self-view-excluded so they're already a real signal of others' interest.)
- **`@handle` syntax + uniqueness rules.**
  Out of scope for option 2 (handles ship with the public profile follow-up). Recorded as a pre-req there.
- **Hosted email transport for future invite flow** (Resend / Postmark / SES).
  Out of scope for option 2 (no invites in this ticket). Recorded for the collaboration follow-up.
- **Admin route auth model.**
  Today `User.is_admin` is a boolean on the user model — sufficient for the dev being the only admin. Revisit when there are real moderators.
- ~~**Cookie name + path scope.**~~ **RESOLVED (D-S-Iss10):** no cookie. Anon-web dedup uses a transient bloom filter keyed on `(ip, ua, accept-language)`; mobile uses the `X-View-Token` header (D3.1). No PECR exposure, no consent banner.

---

## Pre-reqs before starting

- [ ] **Works ticket: foundational tables shipped.** Specifically `papers` and `share_papers` need to exist before the week-2 similar-shares + who-else surfaces can be built. Week-1 is independent and can run in parallel with the works ticket. Migration ordering: works ticket's migration runs FIRST (works W-s7); this ticket's `social.py` removal + `published_at`/`deleted_at` migration runs SECOND.
- [ ] **Cloudflare account on `myetal.app`** (or decision to defer Cloudflare and rely on app-layer rate limits only — audit S9). If yes, add the WAF skip rule for verified search bots + social previewers (D15).
- [ ] **Confirm Next 16's `next/og` is available** (it is — built into Next 16; do NOT install `@vercel/og`). Verify the web build supports edge-runtime route segments.
- [ ] **Privacy policy URL reserved at `myetal.app/privacy`** (one-page Next.js route stub committed).
- [x] ~~Decide cookie name + scope~~ — RESOLVED (D-S-Iss10): no cookie.
- [ ] **Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/`** for Next 16 conventions before writing any code in D11/D12 (the spike — D-BL4).

---

## Cross-references

- **Works Library + ORCID Sync** (`works-library-and-orcid-sync.md`): provides `papers` and `share_papers` (both global / DOI-deduplicated per the works ticket's resolution of audit S8). The week-2 surfaces (D8, D9) depend on these tables. The works ticket also owns `share_papers.added_by` (used by the deferred collab phase) and the per-share `position` namespace shared between `share_items` and `share_papers` (W-BL2 — read paths sort across both tables together by position). The works ticket also owns `user_papers` (per-user library); this ticket can ignore it for v1.
  - **The previous "single-owner papers safe to keep / S8 dodged" framing was wrong** and has been removed. Papers are global. Do not reintroduce per-user paper ownership in any future revision of this ticket; the data model assumes global papers throughout.
- **Migration ordering:** works ticket's migration runs first (W-s7); this ticket's week-1 migration runs second.
- **Audit document** (`public-discovery-and-collaboration-AUDIT.md`): every architectural decision (D1–D18) cites the audit finding it resolves. If you want to know why a v1 idea isn't in this ticket, the audit explains it.

### Deferred follow-up tickets named explicitly

- **Data portability (GDPR Article 20)** — adds `/me/export` returning a ZIP of the user's data. Named in the privacy policy so we're not over-promising; ship as a separate ticket post-launch.
- **Share with specific individuals** — gives `is_public=false` a UI surface again (D-S-Iss5 hid the toggle in v1). Likely lands alongside the deferred collaboration ticket.
- **Global paper metadata edit (with audit log + propagation rules)** — the works ticket's W-S4 deferred this; it's a cross-ticket follow-up.
