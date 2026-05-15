/**
 * Better Auth — Phase 3 cutover configuration.
 *
 * The catch-all is mounted at the canonical ``/api/auth/[...all]``;
 * the legacy hand-rolled handlers under ``/api/auth/{login,logout,
 * register,cookie-set,...}`` were deleted in this phase. Better Auth
 * defaults its base path to ``/api/auth``, so no ``basePath`` override.
 *
 * Phase 3 wires:
 * * ``socialProviders`` — Google + GitHub.
 * * ``genericOAuth`` plugin — ORCID (sandbox toggle via
 *   ``ORCID_USE_SANDBOX``). Hijack-hardening from the legacy
 *   ``services/oauth.py`` lives in ``./auth-orcid-claim.ts``.
 * * ``emailAndPassword.sendResetPassword`` — Resend transactional mail.
 * * ``emailVerification`` — soft v1 (sent, not gated).
 * * ``trustedOrigins`` — localhost in dev, ``BETTER_AUTH_URL`` in prod.
 *
 * Pinned to ``better-auth ~1.6.9``.
 */

import { randomUUID } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, jwt } from 'better-auth/plugins';
import { Resend } from 'resend';

import { assertOrcidIdNotClaimedElsewhere } from './auth-orcid-claim';
import { db } from './db';
import { account, jwks, session, users, verification } from './db-schema';

// Argon2 is a native module. Importing at the top of the file is fine for
// a Route Handler (server-only); the Next bundler keeps it server-side.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2: typeof import('argon2') = require('argon2');

const ARGON2_PARAMS = {
  type: argon2.argon2id,
  // OWASP-recommended argon2id params; only the web side hashes post-cutover.
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

const BA_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BA_SECRET || BA_SECRET.length < 32) {
  // Don't throw at import time during `next build` (which runs in environments
  // that may not have the secret yet) — Better Auth itself validates the
  // secret at first request.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[better-auth] BETTER_AUTH_SECRET is missing or shorter than 32 chars',
    );
  }
}

const BA_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

// ---- Resend (transactional email) -----------------------------------------
// In dev we tolerate a missing RESEND_API_KEY: the auth flows still succeed,
// the email send is logged-and-skipped. Production deploys must set it.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'MyEtAl <noreply@myetal.app>';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendMail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!resend) {
    console.warn(
      `[better-auth/email] RESEND_API_KEY not set — skipping mail to=${args.to} subject=${JSON.stringify(args.subject)}`,
    );
    return;
  }
  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
  } catch (err) {
    console.error('[better-auth/email] resend.emails.send failed', err);
    // Re-throw so BA surfaces the failure on the calling endpoint;
    // otherwise users see a green "check your email" with no email.
    throw err;
  }
}

// ---- Trusted origins ------------------------------------------------------
// BA blocks cross-origin auth requests by default. In prod, only the
// canonical ``BETTER_AUTH_URL`` (and any hand-listed extras) are trusted;
// in dev we add localhost ports for the Next dev server.
//
// Phase 4 (mobile cutover): the mobile app calls BA REST endpoints
// directly from native (cross-origin from the host's perspective) and
// expects to receive deep-link callbacks at ``myetal://``. Both schemes
// are listed so BA accepts the ``Origin``/``callbackURL`` they appear in.
const NATIVE_DEEP_LINK_ORIGINS = ['myetal://', 'exp+myetal://', 'exp://'];
const trustedOrigins =
  process.env.NODE_ENV === 'production'
    ? [BA_URL, ...NATIVE_DEEP_LINK_ORIGINS]
    : [
        BA_URL,
        'http://localhost:3000',
        'http://localhost:3001',
        ...NATIVE_DEEP_LINK_ORIGINS,
      ];

// ---- ORCID provider config (sandbox toggle) -------------------------------
// Sandbox toggle for the dev environment. Production uses the live
// ORCID OIDC discovery URL; sandbox endpoints are explicit because
// ORCID's sandbox does NOT publish a discovery document.
const orcidUseSandbox = process.env.ORCID_USE_SANDBOX === 'true';
const orcidEndpoints = orcidUseSandbox
  ? {
      authorizationUrl: 'https://sandbox.orcid.org/oauth/authorize',
      tokenUrl: 'https://sandbox.orcid.org/oauth/token',
      userInfoUrl: 'https://sandbox.orcid.org/oauth/userinfo',
    }
  : {
      discoveryUrl: 'https://orcid.org/.well-known/openid-configuration',
    };

export const auth = betterAuth({
  secret: BA_SECRET,
  baseURL: BA_URL,
  // basePath defaults to ``/api/auth`` — match the route handler mount.

  trustedOrigins,

  database: drizzleAdapter(db, {
    provider: 'pg',
    // Schema map keys must match BA's internal model name for each
    // resource. We override `user` resource's modelName to `'users'`
    // (plural — matches the API-side users table), so the schema map
    // key has to be `users` too. Other resources (session/account/
    // verification/jwks) keep BA's default singular model names.
    schema: {
      users,
      session,
      account,
      verification,
      jwks,
    },
  }),

  // The MyEtAl `users` table is plural (kept that way to preserve every
  // existing FK on the API side — see better_auth.py docstring).
  //
  // No `fields:` mapping needed: BA's drizzle adapter expects the
  // mapping value to be the JS field name in the drizzle schema (which
  // is already camelCase like BA's defaults). Drizzle itself handles
  // the JS-name→snake_case-DB-column translation via the string passed
  // to `timestamp(...)`/`varchar(...)`/etc. Mapping camelCase→snake_case
  // here would tell BA to look up a JS property that doesn't exist.
  user: {
    modelName: 'users',
    // additionalFields keys are JS field names from db-schema.ts (camelCase).
    // Drizzle handles the DB-column-name (snake_case) translation via the
    // string passed to `boolean('is_admin')` etc. — BA never sees the
    // snake_case DB names directly. Convention: camelCase everywhere in
    // the JS/TS layer; snake_case stays in the SQL/Postgres layer.
    additionalFields: {
      isAdmin: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
      avatarUrl: {
        type: 'string',
        required: false,
        input: false,
      },
      orcidId: {
        type: 'string',
        required: false,
        input: false,
        unique: true,
      },
      lastOrcidSyncAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  // Sessions, accounts, verifications, jwks: no `fields:` mapping needed
  // for the same reason as the `user` resource above (BA defaults match
  // our drizzle JS field names; drizzle handles the snake_case DB columns).
  session: {},
  account: {
    // Security posture (Phase 5 — locked decision in the migration
    // ticket): we do NOT auto-link OAuth providers to existing user
    // rows by email. Today's behaviour (legacy ``services/oauth.py``)
    // also refused implicit linking; preserve that contract.
    //
    // Without this, BA's default ``handleOAuthUserInfo`` will silently
    // attach an ORCID/Google/GitHub account to any existing user with
    // the same email when the provider returns ``email_verified=true``.
    // That is a UX-friendly default for many apps but for MyEtAl it
    // breaks the "ORCID iD is the only trusted identifier" property —
    // an ORCID account whose email happens to match a MyEtAl user
    // could otherwise grab their account by signing in via ORCID.
    //
    // Effect on UX: a fresh ORCID/Google/GitHub sign-in attempt for an
    // email that already exists under a different sign-in method
    // returns the BA error code ``account_not_linked`` and lands on
    // ``/sign-in?error=account_not_linked``. The user must sign in
    // with their existing method first, then add the second method
    // from a profile screen (a future ticket — see Phase 6 prereqs in
    // ``done/better-auth-orcid-flow.md``).
    accountLinking: {
      enabled: true,
      // Allow EXPLICIT linking via authenticated /oauth2/link calls
      // (a profile-screen feature we may build later) but disable
      // IMPLICIT linking on plain sign-in. ``handleOAuthUserInfo``
      // checks both flags; this one shuts the auto-link path.
      disableImplicitLinking: true,
    },
  },
  verification: {},

  // ---- Cookie name -------------------------------------------------------
  // Locked decision: ``myetal_session`` (replaces the legacy
  // myetal-access/refresh pair). Server-fetch and the API's
  // ``get_current_user`` both accept this
  // cookie name (see Phase 2 schema).
  advanced: {
    cookiePrefix: 'myetal',
    // Better Auth then names the session cookie ``myetal.session_token``
    // by default; we want a flat ``myetal_session`` to match the API
    // contract documented in the migration ticket and DEPLOY.md.
    cookies: {
      session_token: {
        name: 'myetal_session',
      },
    },
    // BA's default ID generator produces a 32-char URL-safe random string
    // (e.g. "GSieSJUYSXuHe8vffpuJjEOSER4fKruz"). Our Postgres schema
    // declares all `id` columns as native `uuid` type (the Pi alembic
    // migration creates them that way), which only accepts the canonical
    // 8-4-4-4-12 hex format. Override BA to mint UUID v4s so its random
    // string format stops conflicting with the column type.
    database: {
      generateId: () => randomUUID(),
    },
  },

  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password) => argon2.hash(password, ARGON2_PARAMS),
      verify: ({ password, hash }) => argon2.verify(hash, password),
    },
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'Reset your MyEtAl password',
        html: `
          <p>Hi${user.name ? ` ${user.name}` : ''},</p>
          <p>You requested a password reset. Click the link below to set a new password — it expires in 1 hour.</p>
          <p><a href="${url}">${url}</a></p>
          <p>If you didn't request this, you can ignore this email.</p>
        `,
      });
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'Verify your MyEtAl email',
        html: `
          <p>Hi${user.name ? ` ${user.name}` : ''},</p>
          <p>Welcome to MyEtAl. Click the link below to confirm your email address:</p>
          <p><a href="${url}">${url}</a></p>
        `,
      });
    },
    sendOnSignUp: true,
    // Soft v1: send the verification email but don't gate sign-in on it.
    // Flip ``requireEmailVerification: true`` in ``emailAndPassword`` later
    // if we move to hard verification.
    autoSignInAfterVerification: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
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
          // a concrete boolean. Claim name stays snake_case (`is_admin`) for
          // the JWT wire format because the API side reads JWT claims via
          // pyjwt and Python convention is snake_case there.
          is_admin: (user as { isAdmin?: boolean }).isAdmin ?? false,
        }),
      },
    }),

    genericOAuth({
      config: [
        {
          providerId: 'orcid',
          clientId: process.env.ORCID_CLIENT_ID ?? '',
          clientSecret: process.env.ORCID_CLIENT_SECRET ?? '',
          ...orcidEndpoints,
          // `/authenticate` works for both ORCID Public API and Member API
          // clients. The previous `/read-limited` scope is Member-only —
          // requesting it from a Public API client returns
          // "invalid_request: one of the provided scopes is not allowed".
          // We only need the ORCID iD itself (BA writes it to users.orcid_id);
          // works are fetched separately via services/orcid_client.py against
          // the public ORCID API.
          scopes: ['openid', '/authenticate'],
          // Hijack-hardening: refuse to sign in if the returned ORCID iD
          // is already linked to another user. Throwing here aborts the
          // OAuth chain before BA writes a row.
          mapProfileToUser: mapOrcidProfileToUser,
        },
      ],
    }),
  ],
});

/**
 * Pure shaping function for the ORCID OAuth profile.
 *
 * Extracted so the integration tests can exercise the email-fallback
 * (``${orcidId}@orcid.invalid``), name-fallback (ORCID iD as the
 * display name), and hijack-guard (``OrcidIdAlreadyLinkedError``)
 * paths directly without spinning a full OAuth round trip.
 *
 * Side effect: calls :func:`assertOrcidIdNotClaimedElsewhere`, which
 * reads from the ``users`` and ``account`` tables. The integration
 * tests stand the DB up first and then call this; production calls
 * it via the ``genericOAuth`` ``mapProfileToUser`` callback.
 */
export async function mapOrcidProfileToUser(
  profile: Record<string, unknown>,
): Promise<{ name: string; email: string | undefined; orcidId: string | undefined }> {
  const orcidId =
    typeof profile.sub === 'string'
      ? profile.sub
      : typeof profile.orcid === 'string'
        ? profile.orcid
        : '';
  if (orcidId) {
    await assertOrcidIdNotClaimedElsewhere(orcidId);
  }
  // ORCID lets users keep their email private — when they do, we get
  // no `email` claim back even with the `openid` scope. BA requires
  // email (it's NOT NULL + UNIQUE on the users row), so synthesize one
  // using the `.invalid` TLD (RFC 2606 reserves this — clearly
  // non-deliverable, never collides with a real address). Users can
  // update it later via PATCH /me/orcid's sister endpoint or a future
  // profile-edit UI.
  const emailFromProfile =
    typeof profile.email === 'string' && profile.email.length > 0
      ? profile.email
      : null;
  const email =
    emailFromProfile ?? (orcidId ? `${orcidId}@orcid.invalid` : undefined);
  // ORCID's `given_name` + `family_name` come back separately when
  // present; combine into a single display name. Fall back to the
  // ORCID iD itself if the user has both first + last name set to
  // private — BA's user.name column is NOT NULL.
  const nameFromProfile = (() => {
    if (typeof profile.name === 'string' && profile.name.length > 0) {
      return profile.name;
    }
    const given =
      typeof profile.given_name === 'string' ? profile.given_name : '';
    const family =
      typeof profile.family_name === 'string' ? profile.family_name : '';
    const combined = `${given} ${family}`.trim();
    return combined.length > 0 ? combined : null;
  })();
  const name = nameFromProfile ?? (orcidId || 'ORCID user');
  return {
    name,
    email,
    orcidId: orcidId || undefined,
  };
}
