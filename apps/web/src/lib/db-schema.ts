/**
 * Drizzle schema for the Better Auth tables.
 *
 * Mirrors the SQLAlchemy models in
 * ``apps/api/src/myetal_api/models/better_auth.py``. Single source of
 * truth for migrations is Alembic — this file is consumed only by
 * Better Auth's drizzle adapter at runtime, which uses it to read /
 * write rows. We do NOT run drizzle migrations.
 *
 * Naming:
 * * Table names follow the SQL: ``users`` (kept plural to preserve
 *   every existing FK on the API side), ``session``, ``account``,
 *   ``verification``, ``jwks``.
 * * Column names are snake_case (``user_id``, ``created_at``, etc.).
 *   Better Auth's TS code keeps camelCase in its internal field names —
 *   the per-resource ``fields`` mapping in ``./auth.ts`` translates.
 *
 * If a Better Auth upgrade adds a column, add it here AND in the
 * Alembic migration; there is no auto-drift detection.
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------
// users — Better Auth's user table (kept plural for FK compatibility)
// ----------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }),
  email: varchar('email', { length: 320 }).unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: varchar('image', { length: 2000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // additionalFields (mirrors the SQLAlchemy model). Better Auth reads
  // and writes these via the additionalFields config in ./auth.ts.
  isAdmin: boolean('is_admin').notNull().default(false),
  avatarUrl: varchar('avatar_url', { length: 2000 }),
  orcidId: varchar('orcid_id', { length: 19 }).unique(),
  lastOrcidSyncAt: timestamp('last_orcid_sync_at', { withTimezone: true }),
});

// ----------------------------------------------------------------------
// session — Better Auth's session table
// ----------------------------------------------------------------------
export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('ix_session_user_id').on(t.userId),
  }),
);

// ----------------------------------------------------------------------
// account — Better Auth's account table (federated identities + password)
// ----------------------------------------------------------------------
export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    providerId: varchar('provider_id', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('ix_account_user_id').on(t.userId),
    providerAccountIdx: uniqueIndex('ix_account_provider_account').on(
      t.providerId,
      t.accountId,
    ),
  }),
);

// ----------------------------------------------------------------------
// verification — Better Auth's verification table
// ----------------------------------------------------------------------
export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: varchar('identifier', { length: 320 }).notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('ix_verification_identifier').on(t.identifier),
  }),
);

// ----------------------------------------------------------------------
// jwks — Better Auth JWT plugin's signing-key table
// ----------------------------------------------------------------------
export const jwks = pgTable('jwks', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { users, session, account, verification, jwks };
