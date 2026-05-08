/**
 * Drizzle pg client used by Better Auth's drizzle adapter.
 *
 * Spike-only (Phase 0 of the Better Auth migration). Reuses the same
 * `DATABASE_URL` the FastAPI app uses (the Pi dev Postgres). Better Auth's
 * drizzle adapter creates its own tables (`user`, `session`, `account`,
 * `verification`, `jwks`) on first request — these are namespaced under a
 * `ba_` prefix in `@/lib/auth.ts` so they cannot collide with the existing
 * `users` / `auth_identities` / `refresh_tokens` tables.
 *
 * NOTE: the FastAPI side uses asyncpg with the URL prefix
 *   `postgresql+asyncpg://...`
 * which `pg` (node-postgres) does not understand. Strip the `+asyncpg` suffix
 * for the node side. Both halves end up talking to the same database.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const rawUrl =
  process.env.DATABASE_URL ?? 'postgresql://myetal:myetal@localhost:5432/myetal';

// Tolerate the SQLAlchemy-flavoured URL the API uses.
const connectionString = rawUrl.replace(/^postgresql\+asyncpg:\/\//, 'postgresql://');

export const pool = new Pool({ connectionString });

export const db = drizzle(pool);
