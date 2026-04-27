# Ticket: Public Discovery + Collaboration

**Status:** Draft / not started
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 5–7 focused days (split into phases — see below)
**Depends on:**
- Works Library refactor (`works-library-and-orcid-sync.md`) for "similar shares" signal
- No hard auth dep — anon paths come first

---

## The user-facing pitch

> You don't need an account to enjoy MyEtal. Open the homepage, browse
> what's trending. Scan a poster, see the collection — and now also see
> the related collections, the other researchers sharing the same paper,
> and what else they share. The network effect is the product.

---

## What logged-out users can do today vs. what we want

| Capability | Today | Goal |
|---|---|---|
| Open a share by short code | ✅ (QR scan flow) | ✅ keep |
| Browse trending shares | ❌ | ✅ |
| Search shares / papers / authors | ❌ | ✅ |
| See who else shares a paper | ❌ | ✅ |
| See similar shares to the one I'm viewing | ❌ | ✅ |
| Click into an author's public works library | ❌ | ✅ (depends on works refactor) |
| Save / star without an account | ❌ | ❌ (still requires sign-up — gentle conversion gate) |

**Principle:** read = anon, write = signed in. No friction to consume, real friction to contribute. Mirrors how Twitter / Reddit / Stack Overflow earn their network effect.

---

## The privacy model — bigger than it looks

Current model has one boolean: `Share.is_public`. That's overloaded — it means both "anyone with the URL can view" AND (implicitly today) "this could appear in discovery surfaces." Those are different things and academics will care.

**Proposal: split into a three-state visibility enum.**

```
ShareVisibility:
  PRIVATE   — only owner + invited collaborators can view
  UNLISTED  — anyone with the short_code URL can view (today's "public")
  LISTED    — appears in trending / search / similar / discovery
```

Default for new shares: `UNLISTED` (matches current behaviour — link sharing works, no surprise discovery). User opts into `LISTED` deliberately ("publish to discover" toggle). Migration: existing `is_public=true` → `UNLISTED`.

**Why this matters:** an academic might create a "papers I'm reviewing for tenure" collection, share the QR with their committee, and absolutely not want it on the trending homepage. Today's single boolean gives them no way to express that. We'll get one angry email and have to retrofit it. Build it now.

---

## Discovery surfaces

### 1. Trending shares (homepage)

**Signal:** scan/view count, IP-deduped, time-decayed.

```
trending_score = sum_over_views(
  decay_weight(view_age_hours)
)
where decay_weight(h) = exp(-h / 72)   # half-life ~50h
```

72-hour decay = ~2 days half-life = trending = "hot in the last week." Tweak after seeing real traffic.

**Anti-gaming:**
- IP+UA hash dedup (one view per IP per share per 24h)
- Logged-in views weighted 1.5×, anon 1× (real users worth more, but anon still counts so we don't punish unsigned-in tasters)
- Owner views excluded
- Min N=3 unique IPs before a share is eligible (kills self-promotion)
- Computed offline (cron + materialised view), not per-request

**UI:** simple grid of share cards on the homepage. Author, title, paper count, snippet. Refresh hourly.

### 2. Search

`/search?q=...` — full-text on share name, description, paper titles, authors. Postgres tsvector + GIN index. Returns shares only (not raw papers — keep the abstraction).

Filters: by author, by year range, by venue (post-works-refactor only).

### 3. "Similar shares" (on a share page)

**Signal (after works refactor):** Jaccard overlap on paper sets.

```sql
similar(share_a) =
  SELECT share_b, count(distinct paper_id) / |union| as score
  FROM share_papers a JOIN share_papers b ON a.paper_id = b.paper_id
  WHERE a.share_id = :id AND b.share_id != :id
  GROUP BY b.share_id
  ORDER BY score DESC LIMIT 5
```

Cheap once papers are first-class. **Pre-refactor fallback:** title text similarity (much worse — defer this surface until works lands).

### 4. "Who else shares this paper" (on an item)

When viewing a paper inside a share, surface "X other researchers have this in their collection." Click → list of those shares (filtered to LISTED only). One of the strongest network signals — turns each paper into a meeting point.

### 5. Public works library (per user)

`myetal.app/u/{handle}` — author's profile + public works + listed shares. Defer until handles + works refactor land.

---

## Collaboration — the harder part

### Three different "collaboration" relationships, often confused

1. **Co-author of a paper** — factual, derivable from paper metadata (ORCID gives this for free).
2. **Co-owner of a share** — explicit, "let me + my postdoc both edit this collection."
3. **Network connection** — soft, "you both share work by Smith et al."

Treat them differently. Don't conflate.

### #1 Co-authors (free, inferred)

When a paper has multiple ORCID-identified authors, and >1 of them are MyEtal users, automatically display "co-authored with {names}" on the paper card. **No invite needed** — it's public fact. Makes the network feel populated without anyone having to "add a friend."

### #2 Share collaborators (explicit, opt-in)

New table:

```
share_collaborators
├── share_id (uuid, fk)
├── user_id (uuid, fk)
├── role (enum: editor | viewer)
├── invited_by (uuid, fk users)
├── status (enum: pending | accepted | declined)
├── invited_at, responded_at
└── PK (share_id, user_id)
```

Owner sends invite by email or @handle. Invitee gets a notification (in-app + email if address known), accepts/declines. Editors can add/remove papers and edit metadata, not delete the share or change visibility (owner-only).

**Why this matters for the network:** it lets a lab create a shared "lab publications" collection that survives a postdoc leaving. It also gives us an answer to "how do I let my supervisor add to this without sending them my password" — which we will get asked.

### #3 Soft network ("people you might know")

Inferred from:
- Co-authorship on imported works (strongest)
- Shares that appear in your "similar shares" list with high overlap
- People who scanned a share you also scanned (weakest, may not bother)

Surface only as suggestions ("X is on MyEtal — they share work by Smith et al. you have"), never as automatic links. Crucially: **never display a soft connection as a "collaboration."** That word is reserved for #1 and #2. Misusing it would make the platform creepy.

---

## Anti-abuse (anon access opens the door)

- **Rate limiting:** anon GET endpoints capped per IP (slowapi already in stack). Existing `AUTH_LIMIT` is for auth — add a `READ_ANON_LIMIT` (generous, e.g. 300/min).
- **Search:** debounced + min query length 2 + capped to 50 results to stop "scrape my whole DB" via paged search.
- **No public listing of users by default** — opt-in via the works-library publication step, not auto-discoverable.
- **Robots.txt:** allow indexing of LISTED shares + public profiles. Disallow `/dashboard/`, `/me/`, search result pages.
- **Sitemap:** generate from LISTED shares only. Helps SEO without leaking unlisted URLs.

---

## Mobile vs. web split

Web does the heavy lifting for discovery — bigger screen, SEO matters. Mobile gets a stripped-down version:

| Surface | Web | Mobile |
|---|---|---|
| Trending homepage | ✅ rich grid | ✅ list view |
| Search | ✅ full | ✅ basic |
| Similar shares | ✅ inline section | ✅ inline section |
| "Who else shares this" | ✅ | ✅ |
| Public profiles | ✅ | Defer to later |
| Collaborator invites | ✅ | View only (accept/decline), invite from web |

Mobile app's primary use case is still scan-poster-see-share. Discovery is a bonus there, central on web.

---

## Data model deltas

```
shares
- ADD visibility ShareVisibility default 'unlisted'
- DROP is_public (after migration: true → unlisted, false → private)
- ADD view_count_total (denormalised counter, updated by cron)

share_views (new)
├── id (uuid)
├── share_id (uuid, fk, indexed)
├── viewer_user_id (uuid, fk, nullable)  -- null for anon
├── ip_hash (string)                     -- HMAC(secret, ip+ua), for dedup
├── viewed_at (timestamptz, indexed)
└── INDEX (share_id, viewed_at)
   -- partial index WHERE viewed_at > now() - interval '14 days' for trending query speed

share_collaborators (new) -- see above

trending_shares (materialised view, refreshed hourly by cron)
├── share_id (uuid, pk)
├── score (float)
├── view_count_7d (int)
└── refreshed_at
```

Plus a nightly cron job to refresh `trending_shares` and prune `share_views` older than 90 days (we don't need raw view rows forever).

---

## Phased rollout (so we don't ship a 5-day PR)

### Phase 1 — Public read (1–2 days)
- Add `ShareVisibility` enum + migration from `is_public`
- Public share view route works for anon (already does, just confirm + add proper open-graph tags + JSON-LD)
- Robots.txt + sitemap

### Phase 2 — View counting + trending homepage (1.5 days)
- `share_views` table + dedup
- Cron-refreshed `trending_shares`
- Homepage grid (web) + list (mobile)

### Phase 3 — Search (1 day)
- Postgres tsvector on shares + papers
- `/search` route + UI

### Phase 4 — Similar shares + paper crossover (1 day, **needs works refactor first**)
- `share_papers` already in place from works ticket
- Add the Jaccard query + cache results per share
- "Who else shares this" panel on item view

### Phase 5 — Collaborators (1.5 days)
- `share_collaborators` table + invite flow + email notifications
- Permissions enforcement in share editor
- Soft co-author inference panel (read-only)

Phases 1–3 can ship before the works refactor. Phases 4–5 should follow it.

---

## The hard parts (in priority order)

1. **The visibility model migration** — getting `private/unlisted/listed` right at the schema level on day one is much cheaper than retrofitting. Easy to write, expensive to delay.
2. **Defining "trending" without it gaming itself** — IP dedup + decay + min-views threshold is enough for early traffic, but watch the trending feed weekly and adjust. The day someone's "rate my CV" share goes viral on Twitter is the day we earn this complexity.
3. **The collaboration vocabulary** — "collaborator" must mean explicit + opt-in. Inferred network connections need a different word ("you might know," "co-authored with," "shares similar work"). Loose vocabulary here would make the platform feel surveillance-y.
4. **Anti-abuse for anon endpoints** — rate limits + bot protection + robots.txt are not exciting work but skipping them means a single scraper makes our Neon bill alarming.
5. **Cache invalidation for trending and similar** — these can't be computed per-request at scale. Materialised views + cron is the boring-but-correct answer; resist the urge to compute on the fly.

---

## What this is NOT

- Comments / replies / likes — not a social network. We're a discovery layer.
- Following users — defer. Adds notifications complexity. "Trending" + "similar" carry the network effect for v1.
- DMs / collaboration chat — out of scope forever. Use Slack.
- Public commenting on shares — invites moderation we can't afford. Maybe "send the owner a private note" later.
- Rewriting the recommendation algorithm — start dumb (Jaccard + view count). Go ML only when traffic warrants it.

---

## Open questions

- **Default visibility for new shares: UNLISTED or LISTED?** Recommend UNLISTED — least surprising, opt-in to discovery is the academic-friendly default. Add a homepage prompt for users to publish their first share.
- **Should @handles be required, or optional with a fallback to display name?** Recommend optional + claim flow ("claim your @handle" prompt after first sign-in).
- **Should anon viewers see view counts on a share?** Probably yes for LISTED, no for UNLISTED. Reinforces the visibility distinction visually.
- **OG image generation per share** — would help massively for Twitter/Bluesky/email sharing. Vercel `@vercel/og` is one route. Defer to phase 2.5 if discovery surfaces start performing.

---

## Pre-reqs before starting

- [ ] Decide on visibility default + write the migration test
- [ ] Confirm that `apps/web` routing supports anon access cleanly (it should — only `/dashboard/*` is gated)
- [ ] Pick a hosted email transport for collaborator invites (Resend / Postmark / SES — none chosen yet)
- [ ] Settle on @handle syntax + uniqueness rules (case-insensitive? length? reserved names?)
