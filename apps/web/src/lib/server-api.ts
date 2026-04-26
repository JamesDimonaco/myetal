/**
 * Server-side wrapper around `api()` that pulls the bearer token from the
 * httpOnly `ceteris_access` cookie set by /api/auth/login (or the OAuth finish
 * route). Use this from server components, server actions, and route handlers
 * — never from client components (cookies() is a server-only API).
 */

import { cookies } from 'next/headers';
import { api, type RequestOptions } from './api';

export const ACCESS_COOKIE = 'ceteris_access';
export const REFRESH_COOKIE = 'ceteris_refresh';

export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

/** Fetch as the currently signed-in user. Caller chooses whether missing
 *  cookie means "throw" or "treat as anonymous"; this just passes through. */
export async function serverFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const auth = await getAccessToken();
  return api<T>(path, { ...options, auth: auth ?? options.auth });
}
