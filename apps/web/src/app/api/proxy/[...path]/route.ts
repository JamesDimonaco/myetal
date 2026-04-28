/**
 * Authenticated pass-through to the FastAPI backend.
 *
 * Why this exists: the access token lives in an httpOnly cookie, so client
 * components (TanStack Query mutations, debounced search-as-you-type, etc.)
 * cannot attach the Bearer header themselves — JS in the page can't read the
 * cookie at all. The browser hits this route on the same origin (the cookie
 * goes along for free), the route reads the cookie server-side, and forwards
 * the request to the API with `Authorization: Bearer ...` on the wire.
 *
 * Token refresh: if the upstream returns 401, we try to refresh the access
 * token using the refresh cookie and retry the request once. On success the
 * new tokens are written back to the cookies so subsequent requests use them.
 *
 * Server components MUST NOT use this — they should call `serverFetch`
 * directly, which is one network hop instead of two.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

import { API_BASE_URL } from '@/lib/api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from '@/lib/auth-cookies';
import { getAccessToken, getRefreshToken } from '@/lib/server-api';

type RouteContext = { params: Promise<{ path: string[] }> };

const FORWARDED_HEADERS = new Set(['content-type', 'accept']);

async function sendUpstream(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: ArrayBuffer | undefined,
) {
  const upstream = await fetch(url, {
    method,
    headers,
    body,
    cache: 'no-store',
  });
  return upstream;
}

async function tryRefreshTokens(): Promise<string | null> {
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

    // Write new tokens to cookies
    const store = await cookies();
    store.set(ACCESS_COOKIE, data.access_token, accessCookieOptions);
    store.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions);

    return data.access_token;
  } catch {
    return null;
  }
}

async function handle(request: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  const segments = (path ?? []).map((seg) => encodeURIComponent(seg)).join('/');
  const search = request.nextUrl.search;
  const url = `${API_BASE_URL}/${segments}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (FORWARDED_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Buffer body for non-GET requests (needed for retry)
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    body = buf.byteLength ? buf : undefined;
  }

  let upstream = await sendUpstream(url, request.method, headers, body);

  // On 401, try refreshing the access token and retry once
  if (upstream.status === 401 && token) {
    const newToken = await tryRefreshTokens();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      upstream = await sendUpstream(url, request.method, headers, body);
    }
  }

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const responseBody = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
