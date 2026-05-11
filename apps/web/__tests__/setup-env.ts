/**
 * Vitest pre-import env setup.
 *
 * Better Auth's drizzle adapter reads ``process.env.DATABASE_URL`` (via
 * ``apps/web/src/lib/db.ts``) at module-import time, and ``auth.ts``
 * itself reads ``BETTER_AUTH_SECRET`` / ``BETTER_AUTH_URL`` lazily on
 * first request — but we want the secret to satisfy BA's 32-char floor
 * before any test imports it. Set deterministic test values here, BEFORE
 * the test files run their imports.
 *
 * ``DATABASE_URL`` is intentionally not set here — each test that needs
 * a real database mutates it through the testcontainers fixture, and we
 * rely on Vitest's per-file isolation (vitest.config.ts ``isolate: true``)
 * + lazy/dynamic ``import('@/lib/auth')`` to re-import ``db.ts`` with
 * the right URL.
 */

// process.env writes type ``Record<string, string>``; the NODE_ENV
// property is read-only in the Node type defs so we cast away through
// the Record form. Setting NODE_ENV=test silences Next-runtime warnings
// inside BA's emailVerification path and matches the convention every
// other test framework on the planet uses.
const env = process.env as Record<string, string | undefined>;
env.BETTER_AUTH_SECRET ??=
  'integration-test-secret-32chars-minimum-padding-bytes-xxxxxxxxxxxxx';
env.BETTER_AUTH_URL ??= 'http://localhost:3000';
// Empty ORCID/Google/GitHub creds are fine; auth.ts tolerates them and
// the OAuth tests only exercise mapProfileToUser + handleOAuthUserInfo
// directly, not a real OAuth round trip.
env.NODE_ENV ??= 'test';
