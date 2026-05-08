/**
 * Server-side wrapper around `api()` that forwards the Better Auth
 * session cookie (``myetal_session``) to FastAPI. Use from server
 * components, server actions, and route handlers — never from client
 * components (cookies() is a server-only API).
 *
 * Phase 3 rewrite: BA's cookie carries identity end-to-end. The API's
 * ``get_current_user`` accepts EITHER ``Authorization: Bearer <jwt>``
 * OR the ``myetal_session`` cookie (see Phase 2 schema). We forward
 * the cookie directly — no extraction, no refresh dance.
 *
 * Refresh: BA's session row owns refresh; the middleware checks
 * ``auth.api.getSession()`` per request and lets BA mint a fresh
 * cookie. Server-fetch never refreshes — if the cookie is invalid the
 * 401 propagates and the layout redirects to /sign-in.
 */

import { cookies } from 'next/headers';
import { api, type RequestOptions } from './api';

export const SESSION_COOKIE = 'myetal_session';

export async function getSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** Fetch as the currently signed-in user via the BA session cookie.
 *
 *  401s here indicate a genuinely revoked / expired session — let them
 *  propagate so the calling page can redirect to /sign-in.
 */
export async function serverFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const sessionValue = await getSessionCookie();
  const cookieHeader = sessionValue
    ? `${SESSION_COOKIE}=${sessionValue}`
    : undefined;

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  return api<T>(path, { ...options, headers });
}
