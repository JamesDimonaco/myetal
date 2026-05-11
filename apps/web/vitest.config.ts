/**
 * Vitest config for @myetal/web integration tests.
 *
 * Scope: the only tests living in this workspace are slow integration
 * tests that need a Docker daemon (Postgres via testcontainers, the
 * real Alembic migration chain applied via a one-shot container, the
 * real Better Auth runtime wired to that Postgres). Unit tests for
 * pure functions can stay in their own `*.test.ts` next to source —
 * vitest will pick them up automatically.
 *
 * Why not jest: the API side uses pytest, the mobile side uses jest
 * already; vitest is the natural fit for an esm-first Next 16 codebase
 * with native TS support and no transformer wiring needed.
 *
 * Long timeout: spinning up a fresh Postgres container + applying ~16
 * Alembic revisions takes 8–15s on first run (longer in CI if the image
 * isn't cached). Per-test 60s, per-hook 120s gives headroom without
 * masking real hangs.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Integration tests live in __tests__ at the workspace root; unit
    // tests can colocate (`*.test.ts` next to source). Both patterns
    // are picked up.
    include: [
      '__tests__/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    // The integration tests share state via the testcontainers Postgres
    // container fixture — running them in parallel would race on
    // CREATE/INSERT against the same database. Force sequential
    // execution at the file level; tests within a file run sequentially
    // by default.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // BA's drizzle adapter, the jwt plugin, and the email path all read
    // process.env at first request — make sure each test file gets a
    // clean import graph so the env vars set in the setup file are
    // visible to the auth.ts import (Vitest re-uses workers across
    // files by default, which can carry over imports).
    isolate: true,
    // Node env (default) — no DOM needed; auth flows are server-side.
    environment: 'node',
    // Pre-import env setup — see __tests__/setup-env.ts. Runs once per
    // test file before any user code imports.
    setupFiles: ['./__tests__/setup-env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
