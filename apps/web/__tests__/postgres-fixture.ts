/**
 * Per-test Postgres fixture for the auth integration tests.
 *
 * Lifecycle:
 *   1. Start a fresh ``postgres:16-alpine`` container via testcontainers.
 *   2. Apply the full Alembic migration chain by shelling out to
 *      ``uv run alembic upgrade head`` against the container's host port.
 *      This is the **same migration code** that runs in production
 *      (``apps/api/Dockerfile`` does the same thing at boot), so any
 *      schema-shape bug surfaces here before it ships.
 *   3. Hand back a ``{ url, container }`` pair so the test can wire
 *      Better Auth at it.
 *
 * Why ``uv run`` and not the API docker image: building the API image
 * takes 30–60 s. ``uv sync`` of the api project takes 3–5 s on a warm
 * cache, then ``alembic upgrade head`` is sub-second. CI installs uv
 * once and reuses its cache.
 *
 * Concurrency: each call spins a fresh container with a unique port.
 * Tests within a file share the same fixture (one container per file)
 * to amortise the migration cost; cross-file parallelism is disabled
 * in ``vitest.config.ts``.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/web/__tests__ → repo root → apps/api
const API_DIR = path.resolve(__dirname, '..', '..', 'api');

export interface MigratedPostgres {
  container: StartedPostgreSqlContainer;
  /** node-postgres URL (postgres://user:pass@host:port/db). */
  url: string;
}

/**
 * Start a Postgres 16 container and apply the Alembic migration chain
 * to it. Returns the started container (for shutdown) and the node
 * connection URL (for the drizzle adapter).
 *
 * Throws if Docker isn't reachable or if alembic fails — both states
 * the developer / CI must fix before the integration tests can run.
 */
export async function startMigratedPostgres(): Promise<MigratedPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('myetal_test')
    .withUsername('myetal_test')
    .withPassword('myetal_test')
    // ``shm_size`` lift: Postgres on alpine defaults to 64 MB; the
    // alembic upgrade does a bunch of CREATE INDEX which is happier
    // with more shared memory. Keeps tests stable on slow CI runners.
    .withSharedMemorySize(256 * 1024 * 1024)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const user = container.getUsername();
  const pass = container.getPassword();
  const db = container.getDatabase();

  // Alembic reads ``settings.database_url``; we tell it to talk via
  // asyncpg (the production driver) so the env mirrors prod 1:1.
  const alembicUrl = `postgresql+asyncpg://${user}:${pass}@${host}:${port}/${db}`;
  // node-postgres wants the plain ``postgresql://`` form.
  const nodeUrl = `postgresql://${user}:${pass}@${host}:${port}/${db}`;

  const result = spawnSync(
    'uv',
    ['run', '--frozen', 'alembic', 'upgrade', 'head'],
    {
      cwd: API_DIR,
      env: {
        ...process.env,
        DATABASE_URL: alembicUrl,
        // Settings's secret_key has a placeholder default that satisfies
        // pydantic — no need to set it explicitly.
      },
      encoding: 'utf-8',
      // Long timeout for cold uv cache or slow CI disk.
      timeout: 120_000,
    },
  );

  if (result.status !== 0) {
    // Always tear the container down before bubbling the failure.
    await container.stop().catch(() => undefined);
    const stderr = result.stderr ?? '';
    const stdout = result.stdout ?? '';
    throw new Error(
      `alembic upgrade head failed (exit=${result.status}):\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }

  return { container, url: nodeUrl };
}
