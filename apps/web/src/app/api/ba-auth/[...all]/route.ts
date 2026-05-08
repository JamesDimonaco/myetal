/**
 * Better Auth catch-all route handler — Phase 0 spike.
 *
 * Mounted at /api/ba-auth/[...all] (NOT /api/auth) so it cannot collide
 * with the legacy hand-rolled auth routes under /api/auth/{login,logout,
 * register,cookie-set,github,google,orcid}. Phase 1 will move this to
 * /api/auth/[...all] when the legacy handlers are deleted.
 *
 * The default Better Auth client base path is /api/auth — for the spike
 * we point the API consumers at /api/ba-auth explicitly. JWKS lives at
 * /api/ba-auth/jwks; sign-up at /api/ba-auth/sign-up/email; etc.
 */

import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth.handler);
