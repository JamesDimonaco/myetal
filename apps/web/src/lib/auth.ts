/**
 * Better Auth — Phase 0 spike configuration.
 *
 * Goal: prove cross-stack identity (Next.js mints a session JWT, FastAPI
 * verifies it via JWKS). Nothing else. Phase 1+ (cutover, OAuth, ORCID
 * hijack-hardening, etc) happens later under human supervision.
 *
 * Spike isolation: Better Auth's drizzle adapter wants to own its tables.
 * The legacy MyEtAl schema has a `users` table (plural) — Better Auth's
 * default user table is `user` (singular), so technically there's no
 * collision. We still namespace BA's tables under a `ba_` prefix via
 * `modelName` overrides on every core resource so the spike cannot
 * accidentally write to or read from the legacy auth tables. Phase 1
 * drops the prefix when the cutover replaces the legacy auth.
 *
 * Pinned to `better-auth ~1.6.9` — the first stable release with native
 * Next 16 support (peer-dep accepts `^16.0.0`).
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';

import { db } from './db';

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
  // Spike-only mount path — keep clear of the legacy /api/auth/* routes.
  // Phase 1 deletes the legacy routes and this drops back to the default.
  basePath: '/api/ba-auth',

  database: drizzleAdapter(db, {
    provider: 'pg',
  }),

  // Spike isolation — every BA-owned table sits under a `ba_` prefix so
  // it cannot collide with anything we already have.
  user: {
    modelName: 'ba_user',
    additionalFields: {
      is_admin: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    modelName: 'ba_session',
  },
  account: {
    modelName: 'ba_account',
  },
  verification: {
    modelName: 'ba_verification',
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
