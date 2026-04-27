# Postgres Migration: Raspberry Pi to Neon

**Status:** Planning  
**Priority:** Medium-high (Pi is a single point of failure with no backups, no HA, and limited resources)  
**Estimated effort:** 1-2 weeks (including testing and cutover)

---

## Current state

- **Postgres version:** 16 (Alpine) running in Docker on a Raspberry Pi
- **Docker Compose service:** `db` with a named volume `myetal_pgdata`
- **Connection string:** `postgresql+asyncpg://myetal:myetal@db:5432/myetal` (internal Docker network), `localhost:5432` from the host
- **Driver:** asyncpg via SQLAlchemy async engine, configured in `apps/api/src/myetal_api/core/database.py`
- **Migrations:** Alembic with async engine, 6 migration files (baseline through feedback + avatar_url)
- **ORM:** SQLAlchemy 2.x with mapped_column / Mapped type hints
- **Connection pooling:** SQLAlchemy's built-in pool with `pool_pre_ping=True`

### Tables (from Alembic baseline + subsequent migrations)

| Table | Purpose | Estimated row count (early stage) |
|---|---|---|
| `users` | User accounts | < 100 |
| `auth_identities` | OAuth + password credentials | < 200 |
| `refresh_tokens` | JWT refresh token rotation | < 500 |
| `shares` | Shared research collections | < 100 |
| `share_items` | Individual items in shares | < 500 |
| `share_comments` | Comments on shares | < 100 |
| `share_favorites` | User favorites | < 100 |
| `works` | Personal works library (from 0003) | < 500 |
| `work_tags` | Tags for works (from 0003) | < 1000 |
| Various discovery tables | From 0004 | < 100 |
| `feedback` | User feedback submissions (from 0005) | < 50 |

**Total estimated data size:** Under 10 MB. This is a trivially small dataset. Migration tooling choice is driven by simplicity, not performance.

## Target: Neon serverless Postgres

Neon is a serverless Postgres platform that provides:

- **Autoscaling compute:** Scales to zero when idle, scales up under load
- **Branching:** Instant copy-on-write database branches for dev/staging/preview
- **Connection pooling:** Built-in PgBouncer-compatible pooler
- **Point-in-time restore:** Built-in backups with branch-from-any-point
- **Postgres 16 compatibility:** Same major version as our current setup
- **Free tier:** Generous for early-stage projects (0.5 GB storage, 190 compute hours/month)

## Migration strategy

Given the tiny data size, **`pg_dump` / `pg_restore`** is the obvious choice. No need for logical replication, CDC, or the Neon import tool.

### Step-by-step plan

#### 1. Pre-migration prep

- [ ] Create Neon account and project
- [ ] Create a `myetal` database in Neon (or use the default `neondb`)
- [ ] Note the connection strings: pooled (`-pooler.` hostname, port 5432) and direct (port 5432, no pooler)
- [ ] Verify Neon is running Postgres 16 (match our current version)
- [ ] Test connectivity from the deployment environment (wherever the API will run)

#### 2. Schema migration

Run Alembic against the Neon database to create all tables from scratch:

```bash
DATABASE_URL="postgresql+asyncpg://user:pass@ep-xxx.region.aws.neon.tech/myetal" \
  alembic upgrade head
```

This is preferable to `pg_dump --schema-only` because it exercises the exact same migration path we use in CI and production. If Alembic succeeds against Neon, we know the schema is compatible.

#### 3. Data migration

Export data from the Pi and import to Neon:

```bash
# On the Pi (or any machine that can reach the Pi's Postgres)
pg_dump \
  --host=pi-hostname --port=5432 \
  --username=myetal --dbname=myetal \
  --data-only \
  --format=plain \
  --no-owner --no-privileges \
  > myetal_data.sql

# Import to Neon (use the DIRECT connection string, not pooled)
psql "postgresql://user:pass@ep-xxx.region.aws.neon.tech/myetal?sslmode=require" \
  < myetal_data.sql
```

Using `--data-only` because Alembic already created the schema. Using `--format=plain` because the dataset is tiny and SQL is easiest to inspect/debug.

Alternative: Use Neon's web console SQL editor to run the import if the dump is small enough.

#### 4. Verify data integrity

```sql
-- Compare row counts
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'auth_identities', count(*) FROM auth_identities
UNION ALL SELECT 'shares', count(*) FROM shares
UNION ALL SELECT 'share_items', count(*) FROM share_items;
-- ... etc for all tables

-- Verify FK integrity
SELECT * FROM auth_identities WHERE user_id NOT IN (SELECT id FROM users);
SELECT * FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users);
-- ... etc
```

#### 5. Connection string cutover

Update the `DATABASE_URL` environment variable in all deployment contexts:

| Context | Current value | New value |
|---|---|---|
| `docker-compose.yml` (dev) | `postgresql+asyncpg://myetal:myetal@db:5432/myetal` | Keep as-is for local dev (Docker Postgres stays for offline dev) |
| Production env | Points to Pi Postgres | `postgresql+asyncpg://user:pass@ep-xxx-pooler.region.aws.neon.tech/myetal?sslmode=require` |
| CI / test | Varies | Can use Neon branching or keep a test-specific database |

**Important:** Use the **pooled** connection string (`-pooler.` hostname) for the application. Use the **direct** connection string only for migrations and admin tasks.

#### 6. Verify application

- [ ] Run the full test suite against Neon
- [ ] Sign in (email/password + OAuth) -- verify auth flow works
- [ ] Create a share, add items, comment, favorite
- [ ] Check latency -- Neon cold starts can add ~500ms to the first query after idle

#### 7. Decommission Pi Postgres

- Keep the Pi Postgres running in **read-only** mode for 2 weeks as a fallback
- After 2 weeks with no issues, stop the Docker container and archive the volume

## Neon-specific considerations

### Connection pooling

Neon provides a built-in PgBouncer pooler. SQLAlchemy's `pool_pre_ping=True` is still useful as a safety net, but we may want to adjust pool settings:

```python
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    # Neon's pooler handles connection multiplexing, so we can use a
    # smaller local pool. The default pool_size=5 is fine.
    pool_size=5,
    max_overflow=10,
    # Neon connections may be recycled by the pooler; recycle locally too
    pool_recycle=300,
)
```

### Cold starts

Neon scales to zero after a period of inactivity (configurable, 5 minutes on free tier). The first connection after a cold start takes ~500ms-1s to wake up. This affects:

- The first request after an idle period (user sees a slow page load)
- Alembic migrations in CI (first connection is slow)
- Health checks (`/readyz` may fail if the DB is cold and the timeout is tight)

Mitigations:
- Configure Neon's auto-suspend timeout to a longer period (10-15 min) if the free tier allows
- Adjust health check timeouts to tolerate cold start latency
- Consider a periodic keepalive cron job if cold starts are unacceptable

### Branching for dev/staging

One of Neon's best features: instant copy-on-write database branches. We can use this for:

- **Preview environments:** Each PR gets its own database branch with production data
- **Staging:** A long-lived branch that mirrors production schema
- **Local dev:** Developers can create personal branches instead of running Postgres locally

This replaces the need for `docker-compose` Postgres in development (though keeping it as a fallback for offline work is fine).

### SSL requirements

Neon requires SSL connections. The asyncpg driver supports this via the connection string:

```
postgresql+asyncpg://user:pass@host/db?sslmode=require
```

Our current `database.py` doesn't pass any SSL options because the Docker Postgres doesn't need them. The connection string change handles this automatically -- no code changes needed in `database.py`.

## Alembic compatibility

Alembic works with Neon without modification. The only consideration:

- **Use the direct connection string** (not pooled) for `alembic upgrade head`. PgBouncer in transaction mode doesn't support `SET` commands that Alembic sometimes uses. The direct connection bypasses the pooler.
- This means `alembic.ini` / `env.py` should use a separate env var (e.g., `DATABASE_MIGRATION_URL`) for migration runs, or we detect and swap at runtime.

```python
# In alembic/env.py
migration_url = settings.database_migration_url or settings.database_url
config.set_main_option("sqlalchemy.url", migration_url)
```

Add to `Settings`:
```python
database_migration_url: str | None = None  # Direct (non-pooled) Neon URL for Alembic
```

## Env var changes

| Variable | Current | After migration |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://myetal:myetal@...` | Neon pooled connection string with `?sslmode=require` |
| `DATABASE_MIGRATION_URL` | (new) | Neon direct connection string for Alembic |

No other env vars change. OAuth credentials, secret keys, and application config are unaffected.

## Downtime expectations

**Near-zero downtime is achievable** given the tiny dataset:

1. Put the application in maintenance mode (optional -- with < 100 users, a 5-minute window is fine)
2. `pg_dump` from Pi (seconds for this data size)
3. `psql` import to Neon (seconds)
4. Swap `DATABASE_URL` in production env
5. Restart the API server
6. Verify

Total: **5-10 minutes**, most of which is the deploy/restart cycle, not the data transfer.

If we want true zero-downtime, we could set up logical replication from Pi to Neon to keep them in sync, then do an instant cutover. But this is massive overkill for < 10 MB of data and < 100 users.

## Rollback plan

1. **Keep the Pi Postgres running** for at least 2 weeks after cutover
2. If Neon has issues, revert `DATABASE_URL` to point at the Pi
3. Any data written to Neon during the incident window would need manual reconciliation (dump from Neon, import to Pi) -- but with the current user base this is manageable
4. The Pi volume (`myetal_pgdata`) is preserved and can be restarted with `docker compose up db`

## Testing strategy

### Before cutover

- [ ] Create a Neon branch from the migrated data
- [ ] Run the full API test suite against the branch
- [ ] Run Alembic `upgrade head` and `downgrade -1` to verify migration reversibility
- [ ] Manually test auth flow (sign in, OAuth, refresh), share CRUD, and works library
- [ ] Measure query latency from the deployment environment to Neon (should be < 50ms p99 for warm connections)
- [ ] Test cold start latency (stop compute, reconnect, measure first query time)

### After cutover

- [ ] Monitor error rates and latency for 48 hours
- [ ] Verify Sentry captures any connection errors (if Sentry is configured)
- [ ] Check Neon dashboard for connection count, compute usage, and storage
- [ ] Verify the Pi fallback still works by briefly pointing a test client at it

## Cost considerations

Neon free tier includes:
- 0.5 GB storage
- 190 compute hours/month
- Autoscaling 0.25-2 CU

For MyEtAl's current scale (< 10 MB data, < 100 users), the free tier is more than sufficient. If the app grows, the Pro plan ($19/month) provides 10 GB storage and 300 compute hours.

Compare to the Pi: free compute (already owned), but no backups, no HA, no branching, and limited by the Pi's ARM CPU and SD card I/O.

## Open questions

1. **Where does the API server run?** If it's on the Pi too, the Neon migration only addresses the database. The API server would still be on the Pi, now making network calls to Neon instead of local socket connections. Latency increases. If the API moves to a cloud host (Fly.io, Railway, etc.), that's a separate ticket.

2. **Do we keep Docker Postgres for local dev?** Recommendation: yes. Local dev should work offline. Developers who prefer Neon can use a personal branch. The `docker-compose.yml` stays as-is.

3. **Should we migrate before or after Better Auth?** Recommendation: migrate to Neon first. It's lower risk, the data migration is trivial, and Better Auth doesn't care which Postgres it connects to. Doing Neon first also means Better Auth's spike can test against the production-like Neon environment.

4. **Backup strategy on Neon?** Neon provides point-in-time restore out of the box (7-day history on free tier, 30 days on Pro). This is a massive upgrade from the Pi, which has no automated backups. Should we also set up a periodic `pg_dump` to a separate location as belt-and-suspenders?
