/**
 * Server-side wrapper around `api()` that pulls the bearer token from the
 * httpOnly `myetal_access` cookie set by /api/auth/login (or the OAuth finish
 * route). Use this from server components, server actions, and route handlers
 * — never from client components (cookies() is a server-only API).
 *
 * Token refresh is handled by the middleware (for page navigations) and the
 * proxy route handler (for client-side fetches). We do NOT attempt to refresh
 * here because `cookies().set()` is silently ignored during Server Component
 * rendering — the new tokens would never reach the browser, and the consumed
 * refresh token would lock the user out.
 */

import { cookies } from 'next/headers';
import { api, type RequestOptions } from './api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from './auth-cookies';

export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

/** Fetch as the currently signed-in user.
 *
 *  The middleware ensures a fresh access token for page requests, so 401s
 *  here indicate a genuinely revoked session — we let them propagate.  */
export async function serverFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const auth = await getAccessToken();
  return api<T>(path, { ...options, auth: auth ?? options.auth });
}
