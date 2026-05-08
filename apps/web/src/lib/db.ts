/**
 * Drizzle pg client used by Better Auth's drizzle adapter.
 *
 * Reuses the same ``DATABASE_URL`` the FastAPI app uses (single
 * Postgres, two clients). The schema lives in ``./db-schema.ts`` and is
 * the runtime mirror of the Alembic-managed tables. Migrations are
 * Alembic-only; drizzle never writes DDL.
 *
 * NOTE: the FastAPI side uses asyncpg with the URL prefix
 *   ``postgresql+asyncpg://...``
 * which ``pg`` (node-postgres) does not understand. Strip the
 * ``+asyncpg`` suffix for the node side. Both halves end up talking to
 * the same database.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { schema } from './db-schema';

const rawUrl =
  process.env.DATABASE_URL ?? 'postgresql://myetal:myetal@localhost:5432/myetal';

// Tolerate the SQLAlchemy-flavoured URL the API uses.
const connectionString = rawUrl.replace(/^postgresql\+asyncpg:\/\//, 'postgresql://');

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
