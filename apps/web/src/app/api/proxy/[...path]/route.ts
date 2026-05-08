/**
 * Authenticated pass-through to the FastAPI backend.
 *
 * Why this exists: the BA session cookie is httpOnly, so client
 * components cannot send it on a cross-origin fetch to FastAPI. The
 * browser hits this same-origin route (cookie attached automatically),
 * the route reads the cookie server-side, and forwards the request to
 * the API with the same ``myetal_session=...`` Cookie header.
 *
 * Phase 3 rewrite:
 *   * No more Bearer extraction — FastAPI's ``get_current_user`` accepts
 *     the cookie directly.
 *   * No refresh-on-401 — Better Auth's middleware refreshes the session
 *     cookie before requests reach this route.
 *
 * Server components MUST NOT use this — they should call ``serverFetch``
 * directly, which is one network hop instead of two.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';
import { SESSION_COOKIE, getSessionCookie } from '@/lib/server-api';

type RouteContext = { params: Promise<{ path: string[] }> };

const FORWARDED_HEADERS = new Set(['content-type', 'accept']);

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

  const sessionValue = await getSessionCookie();
  if (sessionValue) {
    headers.Cookie = `${SESSION_COOKIE}=${sessionValue}`;
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    body = buf.byteLength ? buf : undefined;
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
  });

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
