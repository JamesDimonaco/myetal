# Admin analytics + moderation dashboard

**Status:** Proposal — staged build, no urgency
**Created:** 2026-05-16
**Owner:** James
**Effort estimate:** ~10-12 days end-to-end across 4 stages; each stage is shippable on its own

---

## TL;DR

Today's admin surface is one page — `/dashboard/admin/reports` for the share-takedown queue. There's no "how is the platform doing" view, no "who is this user" view, no way to act on a user beyond manually editing a row in Postgres. This ticket plans a real admin section in four stages, each adding a sharper layer of capability without rewriting the previous one.

The platform-level stuff (counts, trends, lists) is genuinely cheap because the data is already in Postgres. The "advanced" bits (per-user actions, moderation, observability) cost more but are independent of each other — each stage can ship + bake before the next starts.

---

## What exists today

- **`/dashboard/admin/reports`** — share-takedown queue. Built in PR-D / `public-discovery-and-collaboration`. Lists user-reported shares, lets admins tombstone them.
- **`users.is_admin: bool`** column on the user row.
- **`ADMIN_EMAILS` env var** — seeds the initial admin list. New admins promoted by toggling `is_admin = true` directly in DB.
- **`api/deps.py::require_admin`** — FastAPI dep that 403s non-admins.
- **No** admin-only routes beyond `/admin/reports/*` and a few `/admin/users/...` placeholders.

---

## Architectural shape (applies across all stages)

- All admin pages live under `/dashboard/admin/*` — the dashboard shell already enforces auth + the layout adapts to admins.
- Backend: a single `/admin/*` router with `Depends(require_admin)` everywhere. Each Stage's endpoints colocated under that prefix.
- No new auth surface. Admins are still BA-authed users with `is_admin = true`.
- Read paths cache aggressively (5-min server cache + TanStack Query 1-min stale on the client). Write paths are no-cache, never optimistic.
- Every admin action goes through an `admin_audit` table (created in Stage 2) so we have an immutable record of "who did what when."
- Charts: use a lightweight library (`recharts` or `chart.js`). No d3.
- Tables: a small reusable table primitive (or shadcn's table — copy-paste, no new dep).

---

## Stage 1 — Platform overview (~2-3 days)

**Goal:** A single page at `/dashboard/admin` that answers "how is MyEtAl doing right now?" without leaving the keyboard.

### Page: `/dashboard/admin` (Overview)

Sections, top to bottom:

1. **Headline counters** (4-up grid)
   - Total users · new this week · new this month
   - Total shares (published only) · drafts (count)
   - Total items across all shares
   - Total views (7d) · (30d)

2. **Growth charts** (2-up)
   - Daily signups, last 30 days (bar)
   - Daily share creates, last 30 days (bar)

3. **Top lists** (3 columns)
   - Most active owners (by share count) — top 10
   - Most-viewed shares (last 30d) — top 10
   - Most-used tags — top 10

4. **Recent activity** (single column, scrollable)
   - Last 20 signups (avatar + email + provider + when)
   - Last 20 feedback submissions (truncated body, "view" link to detail)
   - Last 20 share reports (with link to existing reports queue)

5. **Storage + health snapshot** (4-line summary)
   - R2 PDF count + cumulative MB
   - Postgres row counts for the 5 biggest tables
   - Trending refresh: last run timestamp
   - Similar refresh: last run timestamp

### Backend
- `GET /admin/overview` — single endpoint returns all of the above in one JSON payload. Cached server-side for 60s.
- Queries are all index-friendly (mostly `COUNT(*) WHERE ...` and `ORDER BY view_count DESC LIMIT 10`).

### Scope cuts (defer to later stages)
- No filters / date pickers — fixed windows only.
- No drill-down — click "Most active owners" → goes to placeholder until Stage 2 ships user detail.
- No export / CSV.

**Effort breakdown:** 1 day backend, 1 day frontend, 0.5 day polish.

---

## Stage 2 — User detail + basic actions (~3 days)

**Goal:** Find any user, see what they've done, and take small recoverable actions.

### Page: `/dashboard/admin/users` (list + search)
- Searchable table: email, name, ORCID, providers (icons), share count, last seen.
- Search hits email-prefix, name-prefix, ORCID iD-prefix.
- Sortable columns. Default sort: most recent signup.
- Pagination (50 per page, cursor-based).
- Filter chips: "has ORCID iD," "has shares," "admin," "email-verified."

### Page: `/dashboard/admin/users/[id]` (detail)
- Header: avatar + name + email + ORCID + admin badge.
- Sidebar: created, last sign-in, email-verified status, provider mix (with timestamps), session count, IP of last session.
- Tabs:
  - **Shares** — list of every share they own (draft + published), with links into the existing share dashboard.
  - **Library** — paper count, last ORCID sync timestamp.
  - **Activity** — last 50 events (sign-in, share create, share publish, item add, feedback, report).
  - **Audit log** — admin actions taken AGAINST this user.

### Actions (right rail on detail page)
- **Force sign-out** — revoke all BA sessions for this user (admin clicks → confirm → API revokes session rows → toast).
- **Toggle admin** — flip `users.is_admin`. Self-toggle disabled (you can't unmake yourself).
- **Force email-verify** — set `email_verified = true`. Useful for users stuck on bouncing email.
- **Soft-delete** — mark user as deleted (sets `deleted_at`, tombstones all their shares). Hard delete reserved for GDPR ticket later.
- **Send password-reset email** — triggers Better Auth's flow on the user's behalf.

### Backend
- `GET /admin/users?q=&filter=&cursor=&sort=` — paginated.
- `GET /admin/users/{id}` — single detail payload (includes activity).
- `POST /admin/users/{id}/sign-out` — revoke sessions.
- `POST /admin/users/{id}/admin?value=true|false` — toggle.
- `POST /admin/users/{id}/verify-email` — flip flag.
- `POST /admin/users/{id}/soft-delete` — tombstone the user + cascade.
- `POST /admin/users/{id}/send-password-reset` — triggers Resend via BA.

### Audit log
- New table `admin_audit`:
  - `id uuid pk`
  - `admin_user_id uuid fk users`
  - `target_user_id uuid fk users (nullable)`
  - `target_share_id uuid fk shares (nullable)`
  - `action varchar` — e.g. `force_sign_out`, `toggle_admin`, `soft_delete_user`, `tombstone_share`
  - `details jsonb` — small free-form payload
  - `created_at timestamptz`
- Every Stage 2 action writes a row. The user-detail page surfaces a sub-tab. The reports queue (existing Stage 0) is back-filled with retroactive rows on migration.

**Effort breakdown:** 1.5 days backend (incl. audit table + Alembic), 1.5 days frontend.

---

## Stage 3 — Share + content moderation (~3 days)

**Goal:** Match Stage 2 but for shares: find any share, see who reads it, take action.

### Page: `/dashboard/admin/shares` (list + search)
- Searchable table: short_code, name, owner, type, items, views (30d), published date, drafts hidden by default.
- Search hits: name prefix, short_code exact, owner email prefix, paper DOI within items, tag.
- Filters: published vs draft vs tombstoned, type, age bucket.

### Page: `/dashboard/admin/shares/[id]` (detail)
- Header: short_code + name + owner (link to user detail) + status pill.
- View timeline (daily bar, last 90 days).
- Item list (full, including paper DOIs + R2 PDF links for admins).
- Tags, reports against this share, similar-shares precompute snapshot.
- Audit log filtered to this share.

### Actions
- **Force tombstone** (with reason — required, written to audit).
- **Restore** (unset `deleted_at`).
- **Force unpublish** (set `published_at = NULL` without tombstoning — useful for shares that violate guidelines but the owner deserves a chance to fix).
- **Rebuild similar/trending precompute** (just for this share — useful for debug).

### Discovery moderation
- Promote the existing `/admin/reports` queue into this section. Same data, refreshed UI to match the new admin layout.

**Effort breakdown:** 1.5 days backend, 1 day frontend, 0.5 day moving reports queue.

---

## Stage 4 — Operational / observability (~2 days)

**Goal:** Lightweight runtime health view so a 5am page about "site is down" can be answered without sshing to the box.

### Page: `/dashboard/admin/system`

1. **Request rate + error rate** — last 24h, broken down by route prefix (`/public/*`, `/auth/*`, `/me/*`, etc.). Sourced from a small `request_metrics` aggregate table populated by the FastAPI middleware (1-minute buckets).
2. **Background job status** — `refresh_trending`, `refresh_similar_shares`, `gc_tombstoned_shares`, `prune_share_views`. Each row: last-run timestamp, last-run duration, last-run row count, next-run schedule.
3. **DB connection pool** — current in-use vs max, slow-query count (>1s) over last hour.
4. **R2 storage** — total objects, total bytes, breakdown by prefix.
5. **Auth health** — sign-in attempts vs completions per provider over last 24h. Surfaces "Google OAuth broken" or "ORCID returning 5xx" without waiting for support ticket.

### Backend
- `GET /admin/system/metrics` — read-only aggregates.
- New `request_metrics` table populated by middleware. Roll up to daily after 7 days, drop after 30.
- Background jobs already write `*_last_run_at` columns — surface them here.

### Scope cuts
- Not a real observability stack. PostHog covers the deep dives. This is "is the patient breathing?" not "what did the patient have for breakfast."

**Effort breakdown:** 1 day backend (middleware + table + endpoints), 1 day frontend (mostly chart wiring).

---

## Cross-stage acceptance

- [ ] Every admin page requires `is_admin = true` server-side. Client-side redirect is a UX nicety only — backend is the source of truth.
- [ ] All write actions write to `admin_audit`.
- [ ] No new auth surface — admins are still BA users.
- [ ] Mobile: admin pages are web-only. The mobile app doesn't render them; the bottom-tab "Admin" entry is hidden for non-admins on mobile and routes to a "admin tooling is web-only" message for admins.
- [ ] Every admin endpoint is rate-limited to a generous-but-finite rate (e.g. 600/min/admin) to defend against a compromised admin token.

---

## Open questions

1. **Email blasts to all users** — defer to a separate ticket. Worth its own design + GDPR review.
2. **Feature-flag UI** — defer until we actually have feature flags.
3. **Multi-tenant / org admin** — not a thing today; this is single-tenant admin.
4. **Audit log retention** — keep forever, or roll up after a year? Default to forever; review when the table hits ~100k rows.
5. **Charts library** — `recharts` is React-native-friendly (we use it on mobile), keeps the bundle smaller. `chart.js` is fine too. Pick at Stage 1 implementation time.

---

## Why staged

- Stage 1 alone is genuinely useful — answers "how are we doing" without any moderation muscle.
- Stage 2 unlocks "who is this user" — biggest support-time saver.
- Stage 3 supersedes the current reports queue, but the queue keeps working in the meantime.
- Stage 4 only matters at scale. Easy to skip if PostHog covers the case.

Each stage is one PR. Each PR can ship behind a feature flag if we want to soak it. None of the four require backend changes that block other product work.

---

## When to start

Not now. Prod is mid-stabilisation post-cutover (2026-05-15 launch). Pick this up:

- When the first "I can't find user X" support request lands and SQL editor isn't a great answer. (Stage 2.)
- When you start a fundraising deck and want headline metrics that aren't "I checked yesterday." (Stage 1.)
- When the report queue gets >20 entries and lookup feels slow. (Stage 3.)

Stage 4 is last; only when an outage is hard to diagnose from PostHog alone.
