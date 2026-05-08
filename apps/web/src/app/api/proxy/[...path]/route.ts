/**
 * Authenticated pass-through to the FastAPI backend.
 *
 * Why this exists: the BA session cookie is httpOnly, so client
 * components cannot send it on a cross-origin fetch to FastAPI. The
 * browser hits this same-origin route (cookie attached automatically),
 * the route reads the BA session server-side, mints a short-lived JWT
 * via ``auth.api.getToken``, and forwards the request to FastAPI with
 * ``Authorization: Bearer <jwt>``.
 *
 * The cookie is NOT forwarded to FastAPI — BA's session cookie is a
 * signed ``<token>.<hmac>`` pair, not a JWT. FastAPI's
 * ``get_current_user`` is Bearer-only post-fix.
 *
 * Server components MUST NOT use this — they should call ``serverFetch``
 * directly, which is one network hop instead of two.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';
import { auth } from '@/lib/auth';

type RouteContext = { params: Promise<{ path: string[] }> };

const FORWARDED_HEADERS = new Set(['content-type', 'accept']);

async function mintBearerToken(request: NextRequest): Promise<string | null> {
  try {
    // ``auth.api.getToken`` is the server-side equivalent of BA's
    // public ``/api/auth/token`` endpoint; it reads the session cookie
    // off the incoming request headers and mints a 15-min JWT bound to
    // that session. Same shape used by ``serverFetch`` and the
    // mobile-bounce page.
    const result = (await auth.api.getToken({ headers: request.headers })) as
      | { token?: string }
      | string
      | null;
    if (!result) return null;
    if (typeof result === 'string') return result || null;
    return result.token ?? null;
  } catch (err) {
    console.info('[proxy] auth.api.getToken returned no token', err);
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

  const token = await mintBearerToken(request);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  // If there's no token we still forward the request — FastAPI will
  // 401 cleanly and the client surfaces the same shape it would for a
  // session expiry mid-request. Don't pre-emptively short-circuit; some
  // routes (public share view tracking, take-down reports) accept anon.

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
