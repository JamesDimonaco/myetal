/**
 * Better Auth ↔ Postgres integration test.
 *
 * The single test that would have saved 6+ hours of debug time on
 * staging cutover day: spin up a real Postgres, apply the Alembic
 * migration chain, wire Better Auth to it via the drizzle adapter, and
 * exercise the actual write paths that broke today. Every BA-config-
 * drift bug (UUID generator format, schema map key, additionalFields
 * keys, fields: mappings, `id`/`expires_at` shape on verification
 * rows) fails loudly here instead of silently in a Vercel function log
 * six redeploys later.
 *
 * Scope:
 *   • Email sign-up → users row exists with right shape (orcidId NULL,
 *     isAdmin false, emailVerified false, name + email present).
 *   • Email sign-in → session row exists; auth.api.getToken mints a
 *     valid Ed25519 JWT.
 *   • Verification record creation — the row whose ``id`` UUID format
 *     and ``expires_at`` shape bit us at cutover.
 *   • OAuth account write path via BA's internal
 *     ``handleOAuthUserInfo`` — assert ``users`` row + ``account`` row
 *     both exist with right fields.
 *   • ORCID ``mapProfileToUser`` shaping — name/email fallbacks and the
 *     ``OrcidIdAlreadyLinkedError`` hijack guard.
 *
 * Where this runs:
 *   ✓ Local dev (assumes Docker daemon + ``uv`` on PATH).
 *   ✓ CI (GitHub Actions ``api-tests`` workflow has both).
 *   ✗ Vercel preview deploys / Vercel build. Testcontainers does NOT
 *     run inside Vercel's serverless build environment — no Docker
 *     daemon there. The test is intentionally gated to local + CI;
 *     Vercel's ``next build`` ignores ``__tests__/`` by default
 *     (``vitest.config.ts`` does the include, not ``tsconfig.json``).
 *
 * Cost:
 *   • Cold: ~10–20 s (Postgres pull + Alembic upgrade).
 *   • Warm: ~5–8 s.
 */

import { spawnSync } from 'node:child_process';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { startMigratedPostgres, type MigratedPostgres } from './postgres-fixture';

/* ------------------------------------------------------------------- *
 * Container + auth module lifecycle.
 *
 * ``auth.ts`` and ``db.ts`` read ``process.env.DATABASE_URL`` at
 * module-import time, so we must set the env var BEFORE the dynamic
 * import. ``beforeAll`` starts the container, sets the env, and
 * dynamically imports the modules; ``afterAll`` tears the container
 * down.
 * ------------------------------------------------------------------- */

let pg: MigratedPostgres;
type AuthModule = typeof import('@/lib/auth');
type DbModule = typeof import('@/lib/db');
type SchemaModule = typeof import('@/lib/db-schema');
type ClaimModule = typeof import('@/lib/auth-orcid-claim');

let authModule: AuthModule;
let dbModule: DbModule;
let schemaModule: SchemaModule;
let claimModule: ClaimModule;

beforeAll(async () => {
  pg = await startMigratedPostgres();
  process.env.DATABASE_URL = pg.url;
  // Dynamic imports AFTER the env is set so the drizzle Pool wired up
  // inside ``db.ts`` points at the test container, not the dev compose
  // Postgres.
  authModule = await import('@/lib/auth');
  dbModule = await import('@/lib/db');
  schemaModule = await import('@/lib/db-schema');
  claimModule = await import('@/lib/auth-orcid-claim');
}, 180_000);

afterAll(async () => {
  // Close pool first so the container teardown doesn't deadlock on
  // active connections.
  await dbModule?.pool?.end().catch(() => undefined);
  await pg?.container?.stop().catch(() => undefined);
}, 30_000);

beforeEach(async () => {
  // Each test starts from a fresh row state. Truncate the tables we
  // touch (CASCADE clears session/account/verification rows that FK
  // to users). jwks survives so the JWT plugin doesn't have to
  // regenerate signing keys for every sign-up.
  await dbModule.pool.query(
    'TRUNCATE TABLE users, session, account, verification RESTART IDENTITY CASCADE',
  );
});

/* ------------------------------------------------------------------- *
 * Pre-flight: Docker reachable?
 *
 * If Docker isn't running locally, vitest would fail with a cryptic
 * "ECONNREFUSED 127.0.0.1:2375"-style message buried in
 * testcontainers' internals. Emit a clear skip up front so
 * ``pnpm vitest run`` Just Works on a laptop where Docker isn't on.
 * ------------------------------------------------------------------- */
const DOCKER_REACHABLE = (() => {
  const probe = spawnSync('docker', ['info'], {
    encoding: 'utf-8',
    timeout: 5_000,
  });
  return probe.status === 0;
})();

const runOrSkip = DOCKER_REACHABLE ? describe : describe.skip;

/* ------------------------------------------------------------------- *
 * The tests.
 * ------------------------------------------------------------------- */

runOrSkip('Better Auth ↔ Postgres integration', () => {
  // -------------------------------------------------------------------
  // 1. Email sign-up → users row written with the right shape.
  // -------------------------------------------------------------------
  it('sign-up writes a users row with all BA + additionalFields columns', async () => {
    const { auth } = authModule;
    const { users } = schemaModule;
    const { db } = dbModule;
    const { eq } = await import('drizzle-orm');

    const email = `signup-${Date.now()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: 'correct-horse-battery-staple',
        name: 'Sign Up Tester',
      },
    });

    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe('Sign Up Tester');
    expect(result.user.emailVerified).toBe(false);
    // BA-generated id is a UUID per our advanced.database.generateId
    // override — caught the BA→native-string default that conflicts
    // with our ``uuid`` columns.
    expect(result.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Required BA columns.
    expect(row.id).toBe(result.user.id);
    expect(row.email).toBe(email);
    expect(row.name).toBe('Sign Up Tester');
    expect(row.emailVerified).toBe(false);

    // additionalFields — server-default semantics, not user input.
    expect(row.isAdmin).toBe(false);
    expect(row.orcidId).toBeNull();
    expect(row.avatarUrl).toBeNull();
    expect(row.lastOrcidSyncAt).toBeNull();

    // Timestamps populated by the DB defaults.
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------
  // 2. Email sign-in → session row exists; getToken mints a JWT.
  // -------------------------------------------------------------------
  it('sign-in writes a session row and getToken mints a valid Ed25519 JWT', async () => {
    const { auth } = authModule;
    const { session } = schemaModule;
    const { db } = dbModule;
    const { eq } = await import('drizzle-orm');

    const email = `signin-${Date.now()}@example.com`;
    const password = 'correct-horse-battery-staple';

    await auth.api.signUpEmail({
      body: { email, password, name: 'Sign In Tester' },
    });

    // returnHeaders gives us the set-cookie that the getToken endpoint
    // needs to authenticate the session.
    const signInResp = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    // BA returns the headers Headers object on the outer envelope.
    const setCookie =
      'headers' in signInResp ? signInResp.headers?.get('set-cookie') : null;
    expect(setCookie, 'sign-in must emit a session cookie').toBeTruthy();
    expect(setCookie).toMatch(/myetal_session=/);

    const signInBody = 'response' in signInResp ? signInResp.response : signInResp;
    const sessionToken = (signInBody as { token?: string }).token;
    expect(sessionToken).toBeTruthy();

    const sessionRows = await db
      .select()
      .from(session)
      .where(eq(session.token, sessionToken!))
      .limit(1);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]!.expiresAt).toBeInstanceOf(Date);
    expect(sessionRows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // ---- JWT mint via auth.api.getToken ----
    // Reconstruct the cookie header the way a real browser would for
    // the next request.
    const cookieHeader = (setCookie as string)
      .split(/,\s*(?=[a-zA-Z0-9_-]+=)/)
      .map((c) => c.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
    const headers = new Headers({ cookie: cookieHeader });
    const jwtResult = await auth.api.getToken({ headers });
    const jwt =
      typeof jwtResult === 'string'
        ? jwtResult
        : (jwtResult as { token?: string }).token;
    expect(jwt, 'getToken must return a JWT string').toBeTruthy();

    // Valid Ed25519 JWT shape: 3 segments, header alg=EdDSA, payload
    // has sub/email/is_admin matching the sign-in.
    const [headerB64, payloadB64, sigB64] = (jwt as string).split('.');
    expect(headerB64).toBeTruthy();
    expect(payloadB64).toBeTruthy();
    expect(sigB64).toBeTruthy();

    const headerJson = JSON.parse(
      Buffer.from(headerB64!.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf-8'),
    );
    const payloadJson = JSON.parse(
      Buffer.from(payloadB64!.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf-8'),
    );

    expect(headerJson.alg).toBe('EdDSA');
    // Our definePayload claim names — caught the case-convention drift
    // (is_admin in the JWT wire format, isAdmin in the JS access).
    expect(payloadJson.sub).toBeTruthy();
    expect(payloadJson.email).toBe(email);
    expect(payloadJson.is_admin).toBe(false);
  });

  // -------------------------------------------------------------------
  // 3. Verification row creation — the id/expires_at bug we hit.
  //
  // BA's emailVerification flow signs the verify-email token into a
  // JWT in the URL (no DB write), so the right trigger to exercise the
  // ``verification`` table is the password-reset flow: it writes a row
  // with identifier ``reset-password:<token>`` whose ``expires_at`` is
  // notNull and whose ``id`` must be a real UUID for the column type.
  // The Phase 5 cutover bugs all bit on this exact write path.
  // -------------------------------------------------------------------
  it('password-reset writes a verification row with a UUID id and notNull expires_at', async () => {
    const { auth } = authModule;
    const { verification } = schemaModule;
    const { db } = dbModule;
    const { like } = await import('drizzle-orm');

    const email = `reset-${Date.now()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: 'correct-horse-battery-staple', name: 'Reset Tester' },
    });

    // Trigger the reset-password flow. BA's response is deliberately
    // opaque (``"If this email exists in our system, check..."``) to
    // avoid leaking which emails are registered — but server-side the
    // row IS written.
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://localhost:3000/reset-password' },
    });

    const rows = await db
      .select()
      .from(verification)
      .where(like(verification.identifier, 'reset-password:%'))
      .limit(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // The reset-password verification row stores the user id (not the
    // token itself) in ``value`` — see BA's password.mjs.
    expect(row.value).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // 4. OAuth account write path — fresh OAuth user via
  // ``internalAdapter.createOAuthUser`` (the helper BA's own
  // ``handleOAuthUserInfo`` calls in the create-new-user branch).
  // Asserts both ``users`` and ``account`` rows land with the right
  // fields including the ``additionalFields`` defaults from
  // ``auth.ts``.
  //
  // Why this and not handleOAuthUserInfo directly: that function
  // requires a ``GenericEndpointContext`` (request, cookies, redirect
  // helper, ...), which can only be built by sending a real HTTP
  // request through BA's router. The internalAdapter call below is
  // the exact write path it takes when the OAuth profile points at a
  // brand-new user — same defaults, same hooks, same column mapping.
  // -------------------------------------------------------------------
  it('OAuth create path writes paired users + account rows with right shape', async () => {
    const { auth } = authModule;
    const { users, account } = schemaModule;
    const { db } = dbModule;
    const { and, eq } = await import('drizzle-orm');

    // Synthetic OIDC userinfo (the shape Google would return after a
    // happy-path token exchange). ``id`` is the provider's subject —
    // BA's link-account.ts strips it before calling createOAuthUser
    // (``const { id: _, ...restUserInfo } = userInfo``) because it's
    // not the user-row id; it goes into ``account.account_id``.
    const oauthEmail = `oauth-${Date.now()}@example.com`;
    const oauthProviderAccountId = `google-sub-${Date.now()}`;
    const userInfoForCreate = {
      email: oauthEmail,
      emailVerified: true,
      name: 'OAuth Tester',
      image: 'https://example.com/avatar.png',
    };
    const accountData = {
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      idToken: 'fake-id-token',
      scope: 'openid email profile',
      providerId: 'google',
      accountId: oauthProviderAccountId,
    };

    const ctx = await auth.$context;
    const { user: createdUser, account: createdAccount } =
      await ctx.internalAdapter.createOAuthUser(userInfoForCreate, accountData);

    expect(createdUser.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(createdAccount.userId).toBe(createdUser.id);

    // users row — assert every column we care about is populated
    // exactly as BA + our additionalFields config would set it.
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, oauthEmail))
      .limit(1);
    expect(userRows).toHaveLength(1);
    const userRow = userRows[0]!;
    expect(userRow.id).toBe(createdUser.id);
    expect(userRow.email).toBe(oauthEmail);
    expect(userRow.name).toBe('OAuth Tester');
    expect(userRow.emailVerified).toBe(true);
    expect(userRow.image).toBe('https://example.com/avatar.png');
    // additionalFields defaults — input:false in auth.ts means
    // userInfo can't override these; they should land at the column
    // server_default.
    expect(userRow.isAdmin).toBe(false);
    expect(userRow.orcidId).toBeNull();
    expect(userRow.avatarUrl).toBeNull();
    expect(userRow.lastOrcidSyncAt).toBeNull();

    // account row — assert the (providerId, accountId) compound unique
    // index is what we wrote, plus the tokens (encrypted by BA via
    // setTokenUtil if a secret is configured — we don't decrypt here,
    // just assert presence).
    const accountRows = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.providerId, 'google'),
          eq(account.accountId, oauthProviderAccountId),
        ),
      )
      .limit(1);
    expect(accountRows).toHaveLength(1);
    const accountRow = accountRows[0]!;
    expect(accountRow.userId).toBe(createdUser.id);
    expect(accountRow.scope).toBe('openid email profile');
    expect(accountRow.accessToken).toBeTruthy();
    expect(accountRow.refreshToken).toBeTruthy();
    expect(accountRow.idToken).toBe('fake-id-token');
  });

  // -------------------------------------------------------------------
  // 5a. mapOrcidProfileToUser shaping — happy path with populated
  // email + name.
  // -------------------------------------------------------------------
  it('mapOrcidProfileToUser passes through populated name + email', async () => {
    const { mapOrcidProfileToUser } = authModule;
    const result = await mapOrcidProfileToUser({
      sub: '0000-0001-2345-6789',
      email: 'orcid-user@example.com',
      name: 'Dr Real Name',
    });
    expect(result).toEqual({
      name: 'Dr Real Name',
      email: 'orcid-user@example.com',
      orcidId: '0000-0001-2345-6789',
    });
  });

  // -------------------------------------------------------------------
  // 5b. mapOrcidProfileToUser shaping — empty email synthesises the
  // ``${orcidId}@orcid.invalid`` placeholder.
  // -------------------------------------------------------------------
  it('mapOrcidProfileToUser synthesises @orcid.invalid email when missing', async () => {
    const { mapOrcidProfileToUser } = authModule;
    const result = await mapOrcidProfileToUser({
      sub: '0000-0001-2345-6790',
      given_name: 'Anon',
      family_name: 'Researcher',
      // email intentionally omitted (private on ORCID side)
    });
    expect(result.email).toBe('0000-0001-2345-6790@orcid.invalid');
    expect(result.name).toBe('Anon Researcher');
    expect(result.orcidId).toBe('0000-0001-2345-6790');
  });

  // -------------------------------------------------------------------
  // 5c. mapOrcidProfileToUser shaping — empty name falls back to the
  // ORCID iD itself (users.name is NOT NULL on the DB side).
  // -------------------------------------------------------------------
  it('mapOrcidProfileToUser falls back to the ORCID iD when name is empty', async () => {
    const { mapOrcidProfileToUser } = authModule;
    const result = await mapOrcidProfileToUser({
      sub: '0000-0001-2345-6791',
      email: 'private-name@example.com',
      // name / given_name / family_name all absent
    });
    expect(result.name).toBe('0000-0001-2345-6791');
    expect(result.email).toBe('private-name@example.com');
    expect(result.orcidId).toBe('0000-0001-2345-6791');
  });

  // -------------------------------------------------------------------
  // 5d. mapOrcidProfileToUser hijack guard — iD already linked to
  // another user throws ``OrcidIdAlreadyLinkedError`` (wrapped as a BA
  // APIError redirect).
  // -------------------------------------------------------------------
  it('mapOrcidProfileToUser throws when the iD is already linked to another user', async () => {
    const { mapOrcidProfileToUser } = authModule;
    const { users } = schemaModule;
    const { db } = dbModule;
    const { randomUUID } = await import('node:crypto');

    const claimedOrcidId = '0000-0001-2345-9999';

    // Seed a user that already owns the iD (manual-entry shape: no
    // matching ``account`` row). Explicit id because our drizzle
    // schema does not declare a DB-side default (see db-schema.ts).
    await db.insert(users).values({
      id: randomUUID(),
      name: 'Original Claimant',
      email: 'original@example.com',
      emailVerified: false,
      orcidId: claimedOrcidId,
    });

    // A different user signs in via ORCID and returns the same iD.
    // assertOrcidIdNotClaimedElsewhere should throw — the throw is a
    // ``BA APIError`` (FOUND/302 with Location). We just need to
    // assert that *something* threw, with the right code attached.
    await expect(
      mapOrcidProfileToUser({ sub: claimedOrcidId, email: 'attacker@example.com' }),
    ).rejects.toMatchObject({
      // BA's APIError carries the body we passed in:
      // { message: 'orcid_already_linked', code: 'orcid_already_linked' }
      body: { code: 'orcid_already_linked' },
    });
  });

  // -------------------------------------------------------------------
  // 5e. Re-login carve-out: same user, same iD, with a matching
  // ``account`` row — the guard MUST allow the OAuth flow to proceed.
  // -------------------------------------------------------------------
  it('mapOrcidProfileToUser allows re-login when account row already exists', async () => {
    const { mapOrcidProfileToUser } = authModule;
    const { users, account } = schemaModule;
    const { db } = dbModule;
    const { randomUUID } = await import('node:crypto');

    const orcidIdReLogin = '0000-0001-2345-8888';
    const userId = randomUUID();

    await db.insert(users).values({
      id: userId,
      name: 'Returning User',
      email: 'returning@example.com',
      emailVerified: true,
      orcidId: orcidIdReLogin,
    });

    await db.insert(account).values({
      id: randomUUID(),
      accountId: orcidIdReLogin,
      providerId: 'orcid',
      userId,
    });

    // No throw — second ORCID sign-in is a no-op for the guard.
    const result = await mapOrcidProfileToUser({
      sub: orcidIdReLogin,
      email: 'returning@example.com',
      name: 'Returning User',
    });
    expect(result.orcidId).toBe(orcidIdReLogin);
  });

  // -------------------------------------------------------------------
  // 6. OrcidIdAlreadyLinkedError class — error class export sanity.
  //
  // Cheap insurance against a future "let's rename the error class"
  // refactor that would break the catch sites in app/sign-in.
  // -------------------------------------------------------------------
  it('OrcidIdAlreadyLinkedError exports the expected code', () => {
    const { OrcidIdAlreadyLinkedError } = claimModule;
    const err = new OrcidIdAlreadyLinkedError('0000-0001-2345-6789');
    expect(err.code).toBe('orcid_already_linked');
    expect(err.name).toBe('OrcidIdAlreadyLinkedError');
    expect(err.message).toContain('0000-0001-2345-6789');
  });
});
