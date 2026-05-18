# Admin dashboard — post-prod hardening follow-ups

**Status:** Backlog — flagged by the prod-readiness reviewer; nothing blocks the staging→main merge
**Created:** 2026-05-18
**Owner:** James
**Effort estimate:** ~1-2 days total across 4 items, separable
**Companion to:** `admin-analytics-dashboard.md` (Stages 1-4 shipped)

---

## Why these are deferred, not blockers

The prod-readiness reviewer's verdict was YELLOW / 0 blockers. Three of its recommendations (lifespan shutdown flush, cron-overlap guard, docker-compose `--workers 1` alignment) landed in the same fix-batch commit. These four are the ones that take real effort or coordination and don't bite at v1 scale.

---

## T1. Functional indexes on `LOWER(...)` for admin search (~30 min)

**Why:** `/admin/users` search hits `func.lower(User.email).like('term%')` (`apps/api/src/myetal_api/services/admin_users.py:117-124`). The existing unique BTREE on `users.email` (Alembic 0016:89) can't be used because of the `LOWER()` wrap. Same shape for `User.name` and `User.orcid_id`. At v1 user volume (<1k) this is a sequential scan over a tiny table — invisible. At ~10k users you start to feel it.

**Fix:**

```sql
-- New Alembic migration
CREATE INDEX ix_users_email_lower ON users (lower(email) varchar_pattern_ops);
CREATE INDEX ix_users_name_lower  ON users (lower(name)  varchar_pattern_ops);
CREATE INDEX ix_users_orcid_lower ON users (lower(orcid_id) varchar_pattern_ops);
```

The `varchar_pattern_ops` opclass is what lets the BTREE accelerate `LIKE 'prefix%'` patterns. Postgres-only — SQLite tests skip this layer via `op.create_index(...)` with dialect-checks.

**Trigger:** when the user count crosses ~5k or the first admin reports the user list feels slow.

---

## T2. Retention crons for `request_metrics` and `script_runs` (~1 hour)

**Why:** Two new tables shipped without retention:

- `request_metrics` accumulates ~1440 buckets/day × ~10 route prefixes = **~14k rows/day, ~5M rows/year**. Index is small (composite on `(bucket_start, route_prefix)`), but unbounded growth eats disk.
- `script_runs` accumulates ~30 rows/day at current cron cadence. **~10k rows/year** — practically forever-fine, but the principle stands.

**Fix:**

- `scripts/prune_request_metrics.py` — daily cron. Roll up minute buckets older than 7 days into daily buckets, drop anything older than 30 days.
- `scripts/prune_script_runs.py` — daily cron. Drop rows older than 90 days.

Both wrapped in `run_script` per the existing pattern. Add to Railway Cron + Pi crontab.

**Trigger:** put this on the next monthly Friday-afternoon batch.

---

## T5. Admin DOI substring search performance (~1.5 hours)

**Why:** `apps/api/src/myetal_api/services/admin_shares.py:139-146` does `LOWER(ShareItem.doi) LIKE '%term%'` — leading wildcard guarantees a sequential scan. `ix_share_items_doi` (Alembic 0001:165) is a plain BTREE; can't help contains-pattern searches.

**Options:**

- **(a) `pg_trgm` index** — `CREATE INDEX ix_share_items_doi_trgm ON share_items USING gin (doi gin_trgm_ops)`. Postgres learns to plan `LIKE '%term%'` via the trigram index. ~5 min migration + zero query change. **Recommended.**
- **(b) Restrict admin DOI search to prefix-only** — Cheaper but worse UX. Skip.

**Trigger:** when admin reports "the DOI search hangs," or when `share_items` row count crosses ~50k.

---

## T6. R2 storage tally as a periodic background job (~3-4 hours)

**Why:** Today the R2 LIST runs inline on the first admin to hit `/admin/system/metrics` after a cache miss (`apps/api/src/myetal_api/services/admin_system.py:189-220`). Capped at 50 pages × 1k = 50,000 keys. Once the bucket crosses that, the system page shows `truncated=true` and the tally is stale until the next cold-cache hit re-runs the LIST.

**Fix:**

- New `scripts/refresh_r2_tally.py` — runs the full LIST hourly, writes a snapshot row to a new `r2_storage_snapshots` table.
- `/admin/system/metrics` reads the latest snapshot row (cheap) instead of LIST-ing live.
- The 5-min in-process cache becomes redundant; remove.
- Snapshot table retains 30 days (use the T2 retention pattern).

**Trigger:** when staging's R2 bucket crosses ~10k objects, OR when an admin reports the System page feels slow.

---

## Smaller — bundled with the next admin-touching PR

| Item | Source | Effort |
|---|---|---|
| Cron-overlap log line consistency — `_wrapper.py` logs "skipped" but `script_runs` table doesn't get a row. Decide: skip-and-record (audit trail) vs skip-silently (no clutter). | Reviewer §3 | 5 min |
| `request_metrics` retains the in-memory bucket across restarts via a quick file-checkpoint? | Reviewer §3 | 30 min |
| R2 LIST cap currently 50 pages; revisit cap value once we know real bucket size | Reviewer §3 | 1 min config tweak |

---

## When to pick this up

- **Soonest trigger** — first "the user list feels slow" complaint → T1.
- **Most likely trigger** — first time someone notices the system page shows `truncated=true` → T6.
- **Discipline trigger** — when the request_metrics table tips past 10M rows → T2.
- **One-day-this-bites trigger** — DOI search complaint → T5.

None block launch.
