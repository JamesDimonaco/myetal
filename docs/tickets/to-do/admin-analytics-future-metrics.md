# Admin analytics — future metric surfaces

**Status:** Backlog — to follow once Stages 1–4 of the admin dashboard have baked in prod
**Created:** 2026-05-18
**Owner:** James
**Effort estimate:** highly variable (~30 min per cheap metric, 1-2 days per medium one, 3-5 days per the "bigger" ones with new collection)
**Companion to:** `admin-analytics-dashboard.md` (already-shipped Stages 1-4)

---

## TL;DR

The four shipped admin stages cover the load-bearing operational stuff (overview counters, user & share moderation, system health). This ticket parks the longer list of metrics worth adding **once we have real usage and can tell which signals matter** — splitting them by how much extra plumbing each needs.

Don't build any of these before you actually need them. The single highest-ROI starter is **cohort retention** under the Cheap section.

---

## Cheap — data already collected, just needs a query + a card

| Metric | Why useful | Source |
|---|---|---|
| Funnel: signup → first share → first publish → first view | Tells you where new users drop off | `users.created_at` + `shares.created_at` + `share_views` |
| Avg items per share + distribution | Spot tail-end power users vs casual saves | `share_items` GROUP BY share_id |
| Drafts:published ratio over time | Editor flow signal | `shares.published_at IS NULL` weekly |
| OAuth provider mix over time | Spot a provider regression early (e.g. ORCID 5xx week) | `account.provider_id` GROUP BY created_at week |
| ORCID sync success rate | Already have `orcid_sync_runs`; just surface | `orcid_sync_runs` |
| **Cohort retention** (signup month → returning users by week N) | **Single most useful long-term metric for early-stage PMF** | `users` + `share_views` |
| Most-shared papers (papers appearing in many shares) | Discovery-side network signal | `share_papers` GROUP BY paper_id |
| Feedback by category / reason | Already captured in the feedback form | `feedback.category` |

**Recommendation:** start with cohort retention. ~2 hours of work, one chart, single highest-signal metric for "are we keeping the users we're acquiring."

---

## Medium — small extra collection layer

| Metric | Notes |
|---|---|
| Search-query log (`/public/search`, `/dashboard/search`) | New table `search_queries`; trim/dedupe noise. Useful for "people search for X but we have no shares about X." |
| Per-share referrer / source breakdown | We capture `request.headers.referer` already at view-record time; surface top 5 referrers per share on the share-detail page |
| Time-of-day usage histogram | One COUNT per hour-bucket over `share_views`; cheap rollup table |
| Mobile vs web share-creates | UA fingerprint at create-time; already in PostHog if consent given (admin would query their API) |
| Email delivery rate (Resend) | Resend has an API; weekly pull into a `email_delivery_stats` table |
| Empty searches / failed DOI lookups | Telltale for "we need to expand the corpus" |
| Tombstones / restores per day | Already in `admin_audit`; just aggregate by `action` + day |
| Pending PDF uploads vs successful | Compare R2 `pending/` LIST tally to `share_items WHERE kind='pdf'` daily counts |

---

## Bigger — new tables / new instrumentation

| Metric | Why bigger |
|---|---|
| Geographic distribution (country/region) | Needs IP→country lookup in `record_view`. Suggest GeoLite2 or Cloudflare's CF-IPCountry header. |
| API 4xx/5xx by endpoint over a long window | `request_metrics` retains 7 days today; needs longer retention + a rollup table |
| Slow-query log | `pg_stat_statements` extension OR a custom SQLAlchemy after-execute event listener |
| Auth flow funnel (per-provider attempts vs completions) | The Stage 4 placeholder. Wire BA event hooks → `auth_events` table |
| A/B test surface | Needs an experiment framework first; probably PostHog feature flags as the backing |
| Cost trends (R2 GB-months, Postgres GB) | Cron-collected billing snapshots; Cloudflare R2 + Railway both expose them |
| Conversion rate (visitor → signup) | Server-side visitor counting (Stage 4's request_metrics is request-level, not unique-visit) |
| Engagement score per user | Composite metric (weighted views/shares/sessions) for segmentation |
| Per-tag growth curve | Cron-snapshotted tag-counts → time-series table |

---

## How to pick what to build

1. **Don't build until there's a question you can't answer.** Building "just in case" creates dashboard noise.
2. **Cheap-section items are the right defaults** — they cost a single afternoon each and the data is already on disk.
3. **Medium-section items unlock real product questions** — wait for one to bite (e.g. "what are people searching for") then build it.
4. **Bigger-section items wait for scale OR fundraising** — geographic, cost trends, A/B test surface only matter at >1k DAU or when answering "how does this become a business."

---

## Out of scope

- Payment / monetisation metrics — comes with the monetisation ticket, not this one.
- Real-time analytics (WebSocket pushes) — PostHog already serves that need.
- Public-facing analytics (per-owner view-count dashboards) — that's a product feature, not admin tooling. Different ticket.

---

## Triggers to revisit

- First fundraising deck → cohort retention + funnel become non-negotiable.
- First admin asking "where are our users from?" → geographic distribution.
- First "I can't find anything in the search" feedback → search-query log.
- First "is Provider X broken?" → OAuth mix over time, auth funnel.
- Any one-off "we should know X" question that takes >30 min to SQL-by-hand → write it up here as a new row first; build only if it recurs.
