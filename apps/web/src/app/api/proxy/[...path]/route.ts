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
 * Usage from the client: `/api/proxy/shares` → backend `/shares`. Method,
 * body, query string, and most headers are forwarded verbatim. Anything
 * sensitive (cookie, host) is stripped — only Authorization, Content-Type,
 * and Accept end up on the outgoing request.
 *
 * Server components MUST NOT use this — they should call `serverFetch`
 * directly, which is one network hop instead of two.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/server-api';

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

  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Body: anything that has a body, forward it. fetch() requires duplex:'half'
  // for streaming bodies on Node 18+; here we just buffer to ArrayBuffer to
  // keep things simple — paper search bodies are tiny.
  let body: BodyInit | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    body = buf.byteLength ? buf : undefined;
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    // Don't let Next cache an authed response; the same path may legitimately
    // return different bodies for different users.
    cache: 'no-store',
  });

  // 204 has no body — short-circuit.
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
