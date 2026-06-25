# Redis caching layer (Railway managed)

**Status:** To-do — design ticket. Decision needed before implementation.
**Created:** 2026-06-25
**Owner:** TBD
**Trigger conditions:** Either (a) sustained ≥ 20 req/s on FastAPI in prod, (b) explicit need for shared state across uvicorn workers, (c) we want first-class rate limiting, OR (d) we want sub-100ms responses on currently-DB-bound public reads. None hit yet — this ticket exists to short-circuit the inevitable "shall we add Redis?" conversation when it does.

---

## TL;DR

For MyEtAl's current shape (sub-1k users, low QPS, single FastAPI worker, Vercel edge caching most public reads), **Redis would be premature optimisation.** The two real problems people reach for it to solve — *shared-state across workers* and *rate limiting* — both have lighter-weight Postgres-backed fixes that are good enough at this scale.

That said, Redis is a near-zero-friction add on Railway, and there are 2–3 future features (real-time popularity counters, per-user write rate limits, dedup tokens for ORCID sync idempotency) where it would be the natural primitive rather than something we're forcing.

**Recommendation:** don't add it now. Re-open this ticket when the trigger conditions above fire. When that happens, the implementation is one Railway click + a 50-line cache adapter.

---

## What we already have (cache topology today)

This is what the next person needs to know before deciding Redis is missing:

| Layer | Where | What it caches | TTL |
|---|---|---|---|
| Vercel edge | `/c/[code]`, `/u/[slug]`, `/browse`, `/sitemap.xml` | Full HTML responses | 300s + `stale-while-revalidate` |
| Next.js fetch cache | `api()` calls with `next: { revalidate: N }` | API JSON responses keyed by URL | per-call (300s for browse, 3600s for OpenAlex) |
| `Cache-Control` headers from FastAPI | `/public/*` routes | Same data via CDN/Vercel | `public, s-maxage=300, stale-while-revalidate` |
| In-process Python LRU caches | `services/papers.py`, `services/orcid_client.py` | Crossref / ORCID API lookups | Various — see comments |
| `_presign_cache` (process-local dict) | `api/routes/shares.py:47` | R2 presigned-upload URLs | Per-process — DOES NOT survive multi-worker |
| Postgres materialised data | Trending / similar-shares cron jobs | Sort orders pre-computed | Refreshed every N hours |

**Three observations from this list:**

1. Public reads are already mostly cached at the edge. Adding Redis would shave the *cold-cache* path (~100-300ms first hit, then free). Real impact on user-perceived latency: small.
2. The one genuinely process-local cache (`_presign_cache`) is a known landmine called out in `pre-launch-codebase-review.md`. Either pin `--workers 1` (documented) or move to Postgres or Redis. This is the one piece of broken state that Redis would fix cleanly. Cost-benefit: ~30 lines either way.
3. Crossref/ORCID/OpenAlex calls cache in-process. With `--workers 1` (current prod), that's fine. With multi-worker, cold-hit penalty multiplies by worker count. Redis would dedup across workers.

---

## What Redis would let us do

### A. Things we currently can't / hack around

1. **Shared cache across uvicorn workers.** Replace `_presign_cache` with a Redis hash. Same primitive solves the Crossref/ORCID cache cold-hit penalty.
2. **First-class rate limiting.** Currently the only rate handling I can see is `429` graceful-degrade in the web client. Redis (`INCR` + `EXPIRE`) is the standard primitive for per-IP / per-user / per-endpoint limits. Postgres CAN do this with `UPDATE ... RETURNING` + a `last_seen` table, but Redis is one tenth the latency and the de-facto pattern.
3. **Dedup / idempotency tokens.** The new ORCID first-sync (PR #11) handles race via `SELECT ... FOR UPDATE`. Works. Redis `SETNX` + TTL is the standard alternative — slightly cleaner, no row lock, no transaction overhead. Marginal win.
4. **Real-time popularity counters.** Currently `services/share.py` materialises trending/similar via cron. Redis `ZINCRBY` on view → sorted-set leaderboard updates in microseconds. Removes the cron lag (you publish a share, it doesn't show up in trending for up to N hours). Real UX win once we have enough traffic for trending to mean anything.
5. **Better Auth session store.** BA currently stores sessions in Postgres. Switching to a Redis session store (BA supports it via adapter) means cookie validation skips a DB hop. For a researcher app that's ~1ms saved per request — meaningful at scale, invisible today.

### B. Things people reach for Redis to do that we don't need yet

- **Pub/sub for fan-out.** Useful for real-time features (live notifications, presence). Not on our roadmap.
- **Queue / job processing.** Useful if we offload heavy work (PDF parsing, OpenAlex batch sync). Currently everything is synchronous. If we ever need a queue, Redis-backed (RQ, Celery+Redis) or Railway-managed alternatives both work. Not now.
- **Distributed locks.** We don't have a distributed system — one FastAPI service, one Postgres. Locks live in Postgres.

---

## Pros

- **Solves the multi-worker future cleanly.** If we ever scale uvicorn past `--workers 1`, the process-local caches become bugs. Redis is the obvious fix.
- **Microsecond reads.** Postgres-backed cache lookups are ~1-5ms; Redis is ~0.1-0.5ms. For a hot path (every API request validating a session), this compounds.
- **Built-in TTLs + atomic counters.** `SET key value EX 60`, `INCR`, `ZADD` — these are the right primitives for caching / rate limiting / leaderboards. Postgres can do all of them but the code is uglier.
- **Standard tooling.** `redis-cli`, `redis-py`, sentinel/cluster patterns — everyone knows them. Postgres-as-cache is an in-house pattern that's harder to hand off.
- **Railway makes it trivial.** Managed Redis on Railway is `railway add redis` → service appears in the project → `REDIS_URL` injected via reference variable → internal-network (no egress cost, sub-ms latency from FastAPI). Persistent storage is a flag. ~$5-10/mo for the smallest plan, scales linearly.
- **Optional but easy session-store swap.** Better Auth supports Redis as a session backend. One config change once the adapter is wired.

## Cons

- **New piece of infra to monitor + back up.** Currently we have Postgres (managed), Vercel (managed), R2 (managed). Adding Redis is +1 service to keep alive. Railway makes this easy but it's not free of operational overhead — alerting, capacity, version upgrades.
- **Another network hop = a latency floor.** Even on Railway's internal network it's 0.5–2ms per call. If used carelessly (cache lookup that's slower than the underlying query), it's a regression. Needs benchmarking before each integration.
- **Cost.** Not much (~$60-120/yr for a small instance), but it's recurring and grows with usage. Today we run on free tiers across the board.
- **Cache invalidation is the hard problem.** Adding a cache layer means adding a "when does the cache go stale?" problem. Every write path needs to think about cache key invalidation. The bugs that follow ("why is this old data sticking around?") are hard to debug.
- **MyEtAl's bottleneck isn't there yet.** Profile the actual slow paths first — the answer might be "add a Postgres index" not "add Redis". For research-app traffic patterns (long-tail, low write volume, heavy public read), Vercel edge caching is doing most of the work.
- **Premature distributed-systems-itis.** Once you have Redis, the temptation to use it for everything (jobs, locks, fan-out, etc.) grows. We don't have a queue need yet; if Redis is there, someone will inevitably reach for it.

---

## Railway specifics

Railway makes Redis a one-click add. Implementation flow:

1. **Provision.** Inside the myetal project on Railway: New → Database → Redis. Picks up `REDIS_PASSWORD`, exposes `REDIS_URL` as a reference variable that gets injected into the FastAPI service env on next deploy.
2. **Internal networking.** Railway puts all services on the same project on a private network — the FastAPI service connects to Redis at `redis.railway.internal:6379` with sub-ms latency, no public-internet hop, no egress cost.
3. **Persistence.** Default is in-memory only (RDB snapshots periodically). Toggle persistent volume + AOF if we use Redis for anything we can't afford to lose (sessions, rate-limit state if you don't want a quick reset on restart). Caches don't need persistence — cold-restart re-warms from source.
4. **Resource sizing.** Smallest plan is 256MB RAM (~$5/mo). MyEtAl's working set today would fit in 50MB. We'd outgrow it at maybe 50k active users.
5. **Backups.** Railway has automated daily snapshots on paid plans. For cache-only usage, snapshots are noise. For session storage, useful.
6. **Failover.** Single-instance Redis is the default. Railway doesn't have multi-AZ Redis in the standard plan. If we ever need HA Redis, switch providers or accept ~minutes of downtime per year.

## Implementation sketch (when we do it)

Code-side: thin adapter so we can swap providers without rewriting callers.

```python
# apps/api/src/myetal_api/services/cache.py
class Cache(Protocol):
    async def get(self, key: str) -> bytes | None: ...
    async def set(self, key: str, value: bytes, *, ttl_s: int) -> None: ...
    async def incr(self, key: str, *, ttl_s: int) -> int: ...

# Single Redis client per process. Reuse via FastAPI dependency.
@lru_cache(maxsize=1)
def get_redis() -> Redis:
    return Redis.from_url(os.environ["REDIS_URL"], decode_responses=False)
```

Wire-in order (smallest-blast-radius first):

1. **`_presign_cache`** in `routes/shares.py` — single migration, solves the documented multi-worker landmine. ~30 lines.
2. **Rate limiter** — middleware that does `INCR key=ip:hour, TTL=3600`. Apply to write endpoints first (`POST /me/works`, `PATCH /me/handle`). ~50 lines.
3. **Crossref / ORCID API caches** — move from in-process LRU to Redis-backed with same TTLs. ~lines per service. Optional — only useful if we scale workers.
4. **Trending counters** — `ZINCRBY share:trending:<window> 1 <short_code>` on every `/c/{code}` page view. Replace cron-driven trending. Bigger redesign — separate ticket.
5. **BA session store** — config change in `apps/web/src/lib/auth.ts`, requires Redis available from Vercel (not internal network — public Redis URL with TLS). Adds latency from Vercel→Railway. Probably not worth it.

---

## Recommendation

**Don't add Redis now.** The signal-to-noise ratio of the integration is wrong for our current scale.

**Specific next moves instead:**
- Document the `--workers 1` constraint in `apps/api/DEPLOY.md` so it doesn't get accidentally bumped (`_presign_cache` will silently break).
- Re-open this ticket when any trigger condition fires (sustained ≥ 20 req/s, multi-worker need, rate-limit need, real-time trending need).
- If we want any of (4) trending or (5) session store sooner: those are the two cases where Redis is a real product win, not just a perf optimisation. File as separate tickets.

If we DO decide to add it sooner, the implementation order in the sketch above is the lowest-friction path: presign cache first (solves a real bug), rate limiter next (adds a capability we don't have), everything else later.
