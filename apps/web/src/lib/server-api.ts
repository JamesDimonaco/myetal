/**
 * Server-side wrapper around `api()` for talking to FastAPI as the
 * currently signed-in user. Use from server components, server
 * actions, and route handlers — never from client components
 * (cookies()/headers()/auth.api.getToken are server-only).
 *
 * Identity contract: FastAPI is **Bearer-only**. The BA session
 * cookie (``myetal_session``) is a signed ``<token>.<hmac>`` pair —
 * it is NOT a JWT and the API rejects it. So we mint a real
 * short-lived JWT here via Better Auth's JWT plugin
 * (``auth.api.getToken``) and forward it as
 * ``Authorization: Bearer <jwt>``.
 *
 * The mint happens server-side and never reaches the browser; the
 * httpOnly BA cookie stays in place for BA's own session management.
 *
 * 401s here indicate a genuinely revoked / expired session — let
 * them propagate so the calling page can redirect to /sign-in.
 *
 * (Same pattern as ``app/auth/mobile-bounce/page.tsx``, which uses
 * the same ``auth.api.getToken`` to hand a JWT to the native app.)
 */

import { cookies, headers } from 'next/headers';

import { api, ApiError, type RequestOptions } from './api';
import { auth } from './auth';

export const SESSION_COOKIE = 'myetal_session';

/** Read the raw BA session cookie. Surface for callers that genuinely
 *  need to know whether a session cookie is present at all (e.g. the
 *  layout's "is signed in?" probe). Most code should call
 *  ``serverFetch`` instead.
 */
export async function getSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/**
 * Mint a short-lived BA JWT for the calling user, server-side.
 *
 * Returns ``null`` when there's no session (no cookie, expired
 * session, BA refused to mint). Callers map ``null`` to "anonymous"
 * — for ``serverFetch`` that means we synthesise a 401 rather than
 * letting the FastAPI request go without identity, so the caller
 * sees the same shape (an ``ApiError(401)``) it would see from a
 * server-side rejection.
 *
 * BA versions vary on the return shape — older builds return the JWT
 * as a bare string, newer ones wrap it in ``{ token }``. Handle both
 * defensively, same as ``mobile-bounce/page.tsx`` does.
 */
async function mintBearerToken(): Promise<string | null> {
  try {
    const requestHeaders = await headers();
    const result = (await auth.api.getToken({ headers: requestHeaders })) as
      | { token?: string }
      | string
      | null;
    if (!result) return null;
    if (typeof result === 'string') return result || null;
    return result.token ?? null;
  } catch (err) {
    // No session, expired session, or transient BA error. Treat as anon.
    // Logged at info — a 401 already tells the caller something's up.
    console.info('[server-api] auth.api.getToken returned no token', err);
    return null;
  }
}

/** Fetch as the currently signed-in user. Forwards a fresh BA JWT as
 *  ``Authorization: Bearer <jwt>``.
 *
 *  Returns the parsed JSON body on 2xx. Throws ``ApiError(401)`` when
 *  there is no session OR when FastAPI rejects the JWT (revoked,
 *  expired beyond the 15-min window, key rotated past). Callers should
 *  let 401s propagate so the layout/page can redirect to /sign-in.
 */
export async function serverFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = await mintBearerToken();
  if (!token) {
    // No session — synthesise a 401 with the same shape FastAPI would
    // return, so calling code's ``isUnauthorized`` branch fires. Saves
    // a pointless cross-network round-trip just to be told the same.
    throw new ApiError(401, 'Invalid or expired session');
  }
  return api<T>(path, { ...options, auth: token });
}
