/**
 * Server-side wrapper around `api()` that pulls the bearer token from the
 * httpOnly `myetal_access` cookie set by /api/auth/login (or the OAuth finish
 * route). Use this from server components, server actions, and route handlers
 * — never from client components (cookies() is a server-only API).
 *
 * Includes silent token refresh: if the first request 401s, we try to refresh
 * using the `myetal_refresh` cookie, write the new tokens back, and retry.
 */

import { cookies } from 'next/headers';
import { api, API_BASE_URL, ApiError, type RequestOptions } from './api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from './auth-cookies';

export { ACCESS_COOKIE, REFRESH_COOKIE };

export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

async function tryRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };

    const store = await cookies();
    store.set(ACCESS_COOKIE, data.access_token, accessCookieOptions);
    store.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions);

    return data.access_token;
  } catch {
    return null;
  }
}

/** Fetch as the currently signed-in user. Silently refreshes expired
 *  access tokens using the refresh cookie. */
export async function serverFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const auth = await getAccessToken();
  try {
    return await api<T>(path, { ...options, auth: auth ?? options.auth });
  } catch (err) {
    // If 401 and we had a token, try refreshing once
    if (err instanceof ApiError && err.isUnauthorized && auth) {
      const newToken = await tryRefresh();
      if (newToken) {
        return api<T>(path, { ...options, auth: newToken });
      }
    }
    throw err;
  }
}
