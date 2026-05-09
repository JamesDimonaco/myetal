/**
 * Better Auth React client — used by client components for sign-in,
 * sign-up, sign-out, password reset, and OAuth flows.
 *
 * Mirrors the server config in ``./auth.ts`` re: which plugins emit
 * client-side helpers. ``genericOAuthClient`` exposes
 * ``authClient.signIn.oauth2({ providerId, callbackURL })`` for ORCID;
 * built-in social providers come from ``authClient.signIn.social({...})``.
 *
 * The client uses cookie-based sessions in the browser by default —
 * no token wiring needed. ``baseURL`` defaults to the same origin.
 */

import { genericOAuthClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Same origin in the browser; explicit override only needed for
  // cross-origin RSC calls, which we don't do.
  plugins: [genericOAuthClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
