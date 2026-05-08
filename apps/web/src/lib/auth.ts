/**
 * Better Auth — Phase 1 cutover configuration.
 *
 * Tables now live at their final names (no ``ba_`` prefix). The drizzle
 * schema in ``./db-schema.ts`` is the runtime view of the Alembic-
 * managed tables. Field-name mapping is snake_case → camelCase: BA's
 * TS code uses camelCase fields internally, but the DB columns are
 * snake_case (matching the SQLAlchemy models on the API side).
 *
 * Mount path stays at ``/api/ba-auth`` until Phase 3 collapses it to
 * ``/api/auth`` — that move is intertwined with deleting the legacy
 * route handlers, which is out of scope here.
 *
 * Pinned to ``better-auth ~1.6.9``.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';

import { db } from './db';
import { account, jwks, session, users, verification } from './db-schema';

// Argon2 is a native module. Importing at the top of the file is fine for
// a Route Handler (server-only); the Next bundler keeps it server-side.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2: typeof import('argon2') = require('argon2');

const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — matches passlib's default and our API-side argon2-cffi config
  timeCost: 2,
  parallelism: 1,
} as const;

const BA_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BA_SECRET || BA_SECRET.length < 32) {
  // Don't throw at import time during `next build` (which runs in environments
  // that may not have the secret yet) — Better Auth itself validates the
  // secret at first request.
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[better-auth] BETTER_AUTH_SECRET is missing or shorter than 32 chars',
    );
  }
}

export const auth = betterAuth({
  secret: BA_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  // Mount path stays here until Phase 3 — see file header.
  basePath: '/api/ba-auth',

  database: drizzleAdapter(db, {
    provider: 'pg',
    // Hand the adapter the explicit schema map. Without this, BA falls
    // back to model-name-based table lookup which only works for default
    // table names — we override `users` to plural below.
    schema: {
      user: users,
      session,
      account,
      verification,
      jwks,
    },
  }),

  // The MyEtAl `users` table is plural (kept that way to preserve every
  // existing FK on the API side — see better_auth.py docstring).
  user: {
    modelName: 'users',
    fields: {
      // Map BA's camelCase internal fields to our snake_case DB columns.
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      is_admin: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
      avatar_url: {
        type: 'string',
        required: false,
        input: false,
      },
      orcid_id: {
        type: 'string',
        required: false,
        input: false,
        unique: true,
      },
      last_orcid_sync_at: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  session: {
    fields: {
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  account: {
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password) => argon2.hash(password, ARGON2_PARAMS),
      verify: ({ password, hash }) => argon2.verify(hash, password),
    },
  },

  plugins: [
    jwt({
      jwks: {
        keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
      },
      jwt: {
        expirationTime: '15m',
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          // additionalField — defaults to false on the row, so this is always
          // a concrete boolean.
          is_admin: (user as { is_admin?: boolean }).is_admin ?? false,
        }),
      },
    }),
  ],
});
