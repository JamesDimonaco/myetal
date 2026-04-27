# Audit: Public Discovery + Collaboration ticket

Independent review of `public-discovery-and-collaboration.md`. Section refs are line numbers in that ticket.

---

## Blockers

### B1. The `is_public → unlisted` migration silently changes today's behaviour for every user
**Section:** lines 47–53, 187 ("Migration: existing `is_public=true` → `UNLISTED`").

`Share.is_public` defaults to `True` (`share.py:47`). Every share ever created by every existing user is `is_public=True`. The ticket maps all of them to `UNLISTED`. That sounds conservative — but the ticket's own framing of `LISTED` is "this is the discoverable set." So nobody is in the trending corpus on day one. The trending homepage launches empty.

Worse, the inverse case: the ticket nowhere asks "should anyone become LISTED in the migration?" Realistically you want to either (a) bulk-prompt every owner to opt in, or (b) seed LISTED from a heuristic (e.g. `is_public=True AND has > N items AND owner has display_name`) so the homepage isn't a ghost town on launch day. Decide before writing the migration; retrofitting later means another disruptive UX prompt to the same users.

**Fix:** add a third migration step — flag a subset of `is_public=true` shares for an in-app "would you like to publish this to discovery?" prompt. Or just be honest: ship discovery cold and accept a bootstrapping period.

### B2. `REFRESH MATERIALIZED VIEW` will lock the homepage hourly
**Section:** lines 78–80, 202–207, 249.

`REFRESH MATERIALIZED VIEW trending_shares` takes an `ACCESS EXCLUSIVE` lock by default. Every read of the materialised view blocks during refresh. On Neon (eu-west-2) with cold compute, refresh time on a few thousand shares with millions of view rows will be tens of seconds to minutes — and that's the homepage of a public-read product.

`REFRESH MATERIALIZED VIEW CONCURRENTLY` avoids the lock but **requires a unique index on the matview**. The ticket lists `share_id (uuid, pk)` — that needs to be created as `CREATE UNIQUE INDEX ON trending_shares (share_id)` explicitly; "PK" syntax doesn't exist on matviews in Postgres.

**Fix:** (a) explicitly call out `REFRESH MATERIALIZED VIEW CONCURRENTLY` and the required unique index; (b) consider skipping the matview entirely for v1 — a regular table populated by an `INSERT ... ON CONFLICT` cron job is simpler, gives you the same semantics, and you control locking.

### B3. The Jaccard SQL doesn't compile and won't scale
**Section:** lines 90–98.

```sql
SELECT share_b, count(distinct paper_id) / |union| as score
```

`|union|` is not SQL. The intersection is `count(distinct paper_id)` from the join, but the union has to be computed separately per candidate share — which the query doesn't do. The actual query needs something like:

```sql
WITH a_papers AS (SELECT paper_id FROM share_papers WHERE share_id = :id),
     candidates AS (
       SELECT b.share_id,
              COUNT(*) FILTER (WHERE b.paper_id IN (SELECT paper_id FROM a_papers)) AS inter,
              COUNT(*) AS b_size
       FROM share_papers b
       WHERE b.share_id != :id
       GROUP BY b.share_id
     )
SELECT share_id, inter::float / NULLIF(inter + (b_size - inter) + (a_size - inter), 0) AS jaccard
FROM candidates, (SELECT COUNT(*) AS a_size FROM a_papers) ap
WHERE inter > 0
ORDER BY jaccard DESC LIMIT 5;
```

Even that is a full scan of `share_papers` per request. With 100k shares averaging 20 papers, that's 2M-row aggregations per request. **It cannot run inline on a public page.** The ticket says "cheap once papers are first-class" — that's wrong; it's cheap *to write*, expensive *to run*.

**Fix:** precompute. Either (a) nightly batch into a `share_similar (share_id, similar_share_id, score)` table, or (b) do it lazily on first request and cache in Redis/postgres for 24h. Either way, this is not an inline query. Update the ticket SQL to be syntactically valid and add a precompute step.

### B4. Phase 1's "anon already works" claim is wrong-shaped
**Section:** line 218.

Reading `apps/api/src/myetal_api/services/share.py:65`, `get_public_share` filters on `Share.is_public.is_(True)`. After phase 1 introduces the visibility enum and drops `is_public`, this query breaks. Phase 1 is not "just confirm + add OG tags" — it's a coordinated rename across `models/share.py`, `schemas/share.py` (3 references), `services/share.py` (4 references), `routes/public.py`, and any web/mobile clients that read/write `is_public`. The ticket undersells the work.

Also: the public route currently lets any `is_public=True` share be resolved by short_code. Under the new model, it must allow both `UNLISTED` and `LISTED` — so the filter becomes `visibility != PRIVATE`. That's a one-character logic flip, but the ticket doesn't state it.

**Fix:** add the rename audit to phase 1's checklist. Re-estimate phase 1 to 1.5–2 days minimum.

---

## Significant issues

### S1. The ticket contradicts the existing codebase on "no social"
**Section:** lines 255–258 ("What this is NOT — Comments / replies / likes — not a social network").

`apps/api/src/myetal_api/models/social.py` already defines `ShareComment` and `ShareFavorite` with FKs into `shares` and `users`. They're in the schema. Either they're vestigial (delete them — and the migration that created them) or they're real (the ticket's "not a social network" stance is already false). Don't ship discovery while pretending these tables don't exist; future devs will see them and be confused about the product direction.

**Fix:** decide and act. If they're dead, drop them in phase 1. If they're real, update the ticket's "what this is NOT" section.

### S2. Hashed IP is still PII under GDPR; HMAC-with-secret is reversible
**Section:** lines 73–74, 195.

UK/EU GDPR explicitly classifies hashed IPs as personal data when the hash is reversible. HMAC with a static secret is reversible by anyone with the secret — including a future leak from the server, including you under legal compulsion. The IPv4 keyspace is 4.3B; brute-forcing an HMAC-SHA256 of every IP takes minutes on a laptop once the secret is known.

This means:
- Privacy notice has to declare you collect IP-derived data.
- Subject access requests must include view logs (you'd have to be able to identify "all rows belonging to user X" — which means storing the un-hashed IP at write-time, which defeats the point).
- 90-day retention (line 209) needs documenting in a privacy policy that doesn't yet exist.

**Fix:** rotate the HMAC secret weekly (so old hashes become unlinkable), document retention in a privacy policy, and accept that your dedup window has to fit inside the rotation window. Or: don't store IP-derived data at all; use a short-lived in-memory bloom filter for dedup and accept slightly noisier counts.

### S3. CGNAT and corporate proxies will undercount real traffic
**Section:** lines 73–74.

Mobile carriers (EE, Vodafone, T-Mobile US) NAT thousands of devices behind one IPv4. Universities and hospitals — i.e. the academic audience — sit behind one egress IP for the whole campus. With the proposed dedup ("one view per IP per share per 24h"), a share that goes around a 500-person UCL lab counts as 1 view. The ticket's anti-gaming rule (min N=3 unique IPs) becomes "min 3 different organisations." That kills the genuine "trending in a department" signal that's one of the most important early-stage signals for an academic product.

**Fix:** dedup on `(ip_hash, ua_hash, accept_language_hash)` not just IP+UA. Accept higher false-positive rate on dedup — better to over-count slightly than to silently zero out the audience you're actually trying to reach.

### S4. The "min 3 unique IPs" gate is trivially bypassed and also bites first launches
**Section:** line 76.

Three friends with three phones on three networks = trending eligibility. Anyone who's ever done a launch tweet knows this. It's not anti-gaming, it's a speedbump.

Conversely it punishes the legitimate "I tweeted my new share, 100 views from 100 followers all on the same Twitter referrer" — wait, that's fine since they're 100 different IPs. But it punishes "I scanned my own poster at a conference and 5 people in the same room with the same WiFi did too" — that's 1 IP, no trending.

**Fix:** the threshold should be "at least N different /24 subnets" not "N different IPs," and the threshold should be higher (10–20). And consider: do you even need a threshold pre-launch? You have no users. The threshold is solving a problem you don't have, while creating a real one.

### S5. The 1.5× logged-in weight is unjustified and gameable
**Section:** lines 74–75.

If logged-in is 1.5× anon, and signing up is free, every gamer signs up 10 throwaway accounts to boost their share by 50%. Either weight by something account-quality-correlated (account age, ORCID-verified, has-posted-a-share-themselves) or skip the weighting entirely for v1. "Real users worth more" is a defensible product instinct but the implementation here just adds attack surface.

**Fix:** drop the weighting for v1. Add it back when you have actual abuse to fight.

### S6. Postgres tsvector is a poor v1 for academic search
**Section:** lines 82–86.

Academic content is multilingual (a Spanish researcher's titles, a German abstract). `tsvector` requires a fixed `regconfig` per index (`'english'`, `'german'`, etc.). It also doesn't handle:
- **Author name disambiguation:** "K. M. Smith" vs "Smith, K." vs "Karen Smith" — tsvector tokenises these differently and won't match.
- **Diacritics:** "Müller" vs "Muller" — needs `unaccent` extension explicitly enabled (Neon supports it but you must declare).
- **Typo tolerance:** none. "trasformer" finds nothing.
- **Phrase ranking:** trivial only via `ts_rank`, which is largely meaningless for relevance.

It's adequate for "find shares whose name contains the typed word." It's not adequate for an academic search experience users will compare to Google Scholar.

**Fix:** for v1, scope search down honestly. Either (a) call it "find shares" and limit to title + author exact-prefix matching with `pg_trgm` (handles typos and diacritics, lighter to set up), or (b) defer search to phase 6 and ship discovery without it. Don't claim full academic search and deliver tsvector.

### S7. Collaboration permissions are described in prose, not enforced anywhere
**Section:** lines 141–143.

"Editors can add/remove papers and edit metadata, not delete the share or change visibility (owner-only)." Where does this live? There's no RLS in the codebase. The current pattern (judging by `routes/shares.py` and the sketch in `routes/public.py`) is FastAPI permission decorators. With collaborators added, every share-mutation endpoint needs a permission check that asks "is this user the owner OR an accepted editor?" — and a separate check on the destructive endpoints that asks "is this user the owner?"

The ticket doesn't list this work. It's not zero — you need a `permissions.py` module, a decorator or dependency, tests for each role × endpoint cell (probably 6–10 endpoints × 3 roles = 20+ test cases), and you need to audit every existing share mutation route to add the check.

**Fix:** add a "permission enforcement" sub-task to phase 5 with explicit endpoint enumeration. Estimate +0.5d.

### S8. Cross-ticket: paper ownership becomes incoherent under collaboration
**Section:** lines 127–143 vs `works-library-and-orcid-sync.md` lines 41–65.

The works ticket defines `papers.owner_user_id` — every paper belongs to one user. An editor on a share now wants to attach a paper. Whose paper is it?

- If editor adds from *their* library: paper has `owner_user_id = editor.id`. The share's owner sees a paper in their share they don't own. If editor leaves, can owner still display the paper? Edit its metadata?
- If owner is forced to "adopt" the paper (clone into their library): now you have two `papers` rows for the same DOI for two users, dedup constraint is `(owner, doi)` so that's fine, but you've duplicated data and any later edit by the editor diverges from the owner's copy.

The works ticket was written assuming single ownership. The discovery ticket adds collaboration without revisiting it. **This will block phase 5.**

**Fix:** decide before writing either migration:
- Option A — papers are global (drop `owner_user_id`, dedup on DOI globally; track `added_by` in `share_papers`).
- Option B — papers are per-user, share_papers stores a denormalised snapshot for collaboration (rejects the whole point of the works refactor).
- Option C — share owner's library is the canonical source for that share; editors add by copying into owner's library on attach (most surprising; documents disappear from editor's library when share is deleted? messy).

Recommend A. Update the works ticket too.

### S9. 300/min anon read limit allows 432k requests/day from one IP
**Section:** line 158.

300/min × 1440 min = 432,000 requests per IP per day. A scraper behind a single IP can pull your entire share corpus in hours. Behind a small proxy pool (10 IPs from $5/mo proxy services), 4.3M req/day — your full DB twice over. You also pay for every one of those on Neon. Compute units add up fast on hot reads.

**Fix:** layer the defence. (a) Cloudflare in front of api.myetal.app with bot management; (b) tighter limits on the search endpoint specifically (10/min is plenty for a human); (c) cap per-share-listing pagination depth (no `?offset=10000`); (d) consider requiring auth for the "list all shares" endpoints, with anon limited to single-share reads.

### S10. View pruning at 90 days breaks any 7-day-and-longer trending window if cron fails
**Section:** line 209, 199.

The partial index is `WHERE viewed_at > now() - interval '14 days'` — that's a misuse of partial indexes. `now()` isn't immutable; Postgres won't accept it in an index `WHERE` clause without a workaround (you'd need to recreate the index periodically, which means you don't really have a static partial index — you have a moving target that requires maintenance). This is a footgun the ticket presents as a feature.

**Fix:** either use a fixed boundary you bump occasionally (`viewed_at > '2026-01-01'` and recreate quarterly), or skip the partial index and rely on `(share_id, viewed_at DESC)` index + the matview to absorb load. The matview is the right answer.

---

## Smaller concerns

### s1. Default visibility "UNLISTED" + "homepage prompt to publish" is two systems doing one job
Ticket's open question (line 265) recommends UNLISTED default with a prompt. But the homepage prompt is unspecified — when does it appear, how often, can it be dismissed, does dismissing it count for any future shares? Specify or drop.

### s2. `view_count_total` denormalised counter has no specified update story
Line 189 says "updated by cron" — but the trending matview already has `view_count_7d`. What's `view_count_total` for that the matview doesn't cover? If it's for the share owner's analytics view (good idea, see "things to decide"), say so. If it's just a duplicate, drop it.

### s3. Pending invite spam is acknowledged in the prompt, not the ticket
The ticket has zero anti-spam on invites. Owner can spam-invite 10,000 emails. Add: rate limit (e.g. 50 invites/owner/day), dedup pending invites for the same email, expire pending invites after 30d.

### s4. Editor account deletion doesn't cascade cleanly
`share_collaborators.user_id` needs an explicit `ondelete` policy. CASCADE means losing audit trail of who edited what; SET NULL means orphan rows; RESTRICT means user deletion fails. Pick one and write it in. The current `User.shares` cascade is `all, delete-orphan` (`user.py:27`) — be sure deleting a user doesn't also delete shares they're an editor of.

### s5. Share deletion semantics for LISTED shares is undefined
What happens to (a) cached trending matview rows, (b) sitemap entries, (c) Cloudflare/CDN cache, (d) other users' "similar shares" panels that referenced this one? The ticket doesn't say. At minimum: tombstone with a `deleted_at`, return 410 Gone (not 404) so search engines drop it cleanly, exclude tombstoned from matview refresh.

### s6. "Soft network" vocabulary protection is convention, not enforced
Line 152 — "never display a soft connection as a 'collaboration.'" Currently this is just a sentence in a doc. To make it stick: name your DB column / Pydantic field `soft_connection` not `collaborator`, and don't ever serialise a `soft_connection` into a field called `collaborators`. Type-system-level separation, not naming convention.

### s7. Phase 4 dependency math doesn't add up to the launch claim
Works ticket: 3.5d. Discovery ticket: 5–7d. Total: 8.5–10.5d of solo focused work, plus the cross-ticket integration work that's currently un-scoped (S8). Realistic elapsed for a solo dev with a day job is 4–6 weeks. The ticket says "phases 1–3 can ship before the works refactor" which is true, but 4–5 are most of the network-effect value. Be honest about what ships when.

### s8. SEO is a one-line mention but it's the entire growth model
Lines 161–162 mention sitemap and robots only. For an academic discovery product the SEO surface needs: per-share OG image (acknowledged in open Q), JSON-LD `ScholarlyArticle` markup (papers!), canonical URLs, `noindex` on UNLISTED but `index` on LISTED (with explicit `<meta>` from the page, not just sitemap-driven), per-author profile pages with author-Person schema. This deserves a section, not a bullet.

---

## Better alternatives

### A1. Replace materialised view with a small `trending_shares` table populated by a simple cron-run query
Drops the lock issue, drops the unique-index gotcha, gives you a normal table you can update incrementally and read freely. ~10 lines of Python in a scheduled task. Use the matview later if it becomes a perf problem (it won't at your scale for the next year).

### A2. Replace IP-hash dedup with cookie-based dedup for trending counts; keep IP-hash only as a fallback for cookie-less clients
Cookies aren't perfect either, but they correctly count "same person on uni WiFi" as 1 instead of "whole campus" as 1. GDPR-wise, a session-only cookie is clearly less intrusive than IP fingerprinting.

### A3. Drop the `LISTED` enum in favour of an explicit "Publish" action that sets a `published_at` timestamp
Same effect, but `published_at IS NOT NULL` is a richer signal — gives you "publication date" for sorting, "freshly published" carousel, and "republish" semantics if a user re-publishes after edits. Three-state enums age badly; nullable timestamps don't.

### A4. For similar-shares, ship "papers in common" before Jaccard
"X also has 3 of these papers" is a one-line query, mentally trivial for users to understand, and doesn't need precomputation. Real Jaccard scoring is overkill for v1 and the SQL doesn't compile (B3) so you'd rewrite it anyway. Ship the cheap version, see if anyone clicks it.

### A5. For search v1, use `pg_trgm` GiST index on `share.name || ' ' || share.description || ' ' || authors`
Handles typos, diacritics, and partial matches. Setup is one extension + one index. You can swap to tsvector later if relevance becomes a problem; you can swap to Meilisearch/Typesense if both fail. Trgm is a strictly better v1 than tsvector for this domain.

---

## Things worth deciding before starting

1. **Paper ownership under collaboration** (S8). Block both tickets until decided.
2. **What happens to existing `is_public=true` shares on migration day** (B1). Specifically: do you want a homepage to show on launch, or are you fine with a cold start?
3. **Cloudflare in front of api.myetal.app, yes/no.** If yes, much of the rate-limit logic can be done at the edge cheaper. If no, accept Neon will get pummelled.
4. **Privacy policy for view tracking.** Cannot launch IP-derived tracking in EU/UK without one. ~1 day of work itself.
5. **Reporting / takedown flow.** Pre-launch is the only cheap moment to design "report this share" + an admin takedown UI. Once a copyright PDF is up and a publisher emails you, you'll be doing it manually at midnight. **Add to ticket.**
6. **Owner analytics.** The view data is being collected but not exposed to owners. That's a cheap win (one extra route, one chart) and the *most-asked feature* you'll get from real users. **Add to ticket.**
7. **What does a share's deletion mean to the ecosystem of caches/matview/sitemap pointing at it** (s5). Define before writing the delete endpoint.
8. **Vocabulary lock-in for "collaborator" vs "soft connection"** (s6). Decide naming + type structure now, not after the first PR.
9. **Reality check.**

   You have zero users. The QR-scan-poster-see-collection flow is the actual product wedge. Discovery is the *retention* layer — it matters once you have inbound traffic, and it matters most for the *second* visit ("I scanned a poster, what else is here?"). Phases 1, 2, and 4 (visibility split, view counting, similar/who-else-shares) are directly in service of the wedge. Phase 3 (search) and phase 5 (collaboration) are not — they're features for users you don't have yet.

   **The smallest valuable version:**
   - Phase 1 (visibility + OG tags + sitemap) — needed because you can't easily un-make `is_public` decisions later.
   - Phase 2 minus trending matview (just count views, don't show trending yet) — collect data so when you do build trending, you have history.
   - Phase 4's "who else shares this paper" — turns each scan into a discovery moment, which IS the wedge.
   - Skip search, skip collaboration, skip trending UI, skip soft network until you have at least 100 weekly active users to draw signal from.

   That's 2–3 days, not 5–7. Ship it, watch what happens, build the rest reactively.

---

**Files referenced**
- `apps/api/src/myetal_api/models/share.py`
- `apps/api/src/myetal_api/models/social.py` (the contradiction in S1)
- `apps/api/src/myetal_api/models/user.py`
- `apps/api/src/myetal_api/services/share.py` (lines 30, 61, 65, 76, 77 — all need updating in phase 1)
- `apps/api/src/myetal_api/schemas/share.py` (lines 26, 36, 65 — same)
- `apps/api/src/myetal_api/api/routes/public.py`
