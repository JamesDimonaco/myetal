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
          // a concrete boolean.
          is_admin: (user as { is_admin?: boolean }).is_admin ?? false,
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
          scopes: ['openid', '/read-limited'],
          // Hijack-hardening: refuse to sign in if the returned ORCID iD
          // is already linked to another user. Throwing here aborts the
          // OAuth chain before BA writes a row.
          mapProfileToUser: async (profile: Record<string, unknown>) => {
            const orcidId =
              typeof profile.sub === 'string'
                ? profile.sub
                : typeof profile.orcid === 'string'
                  ? profile.orcid
                  : '';
            if (orcidId) {
              await assertOrcidIdNotClaimedElsewhere(orcidId);
            }
            return {
              name: typeof profile.name === 'string' ? profile.name : undefined,
              email: typeof profile.email === 'string' ? profile.email : undefined,
              orcid_id: orcidId || undefined,
            };
          },
        },
      ],
    }),
  ],
});
