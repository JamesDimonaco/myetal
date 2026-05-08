/**
 * Better Auth catch-all route handler.
 *
 * Mounted at the canonical ``/api/auth/[...all]``. All sign-in /
 * sign-up / sign-out / OAuth / password-reset / email-verification
 * traffic comes through here. JWKS lives at ``/api/auth/jwks``.
 *
 * Phase 3 collapsed the Phase 0 safety mount and deleted the legacy
 * hand-rolled handlers under
 * ``/api/auth/{login,logout,register,cookie-set,github,google,orcid}`` —
 * Better Auth now owns the ``/api/auth/*`` namespace exclusively.
 */

import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth.handler);
