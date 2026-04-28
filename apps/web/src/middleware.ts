/**
 * Gatekeeper for /dashboard/*. Anything under /dashboard requires a valid
 * access token cookie. When the access token has expired but a refresh token
 * is still present, the middleware refreshes the pair *here* (before the
 * request reaches server components) so every downstream `serverFetch` call
 * sees a valid token.
 *
 * Why here and not in serverFetch?
 * `cookies().set()` is silently ignored during Server Component rendering —
 * only Route Handlers, Server Actions, and middleware can write cookies.
 * Refreshing in middleware guarantees the new tokens are delivered to the
 * browser via Set-Cookie headers on the response.
 *
 * NOTE on Next.js 16: `middleware` is deprecated in favour of `proxy`. Both
 * still work in 16.x; we use `middleware` per the build spec. When we
 * upgrade to a release that drops middleware, run
 * `npx @next/codemod@canary middleware-to-proxy .` to rename.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from '@/lib/auth-cookies';

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:8000'
).replace(/\/$/, '');

/**
 * Decode the JWT *without* verifying the signature (we only need the `exp`
 * claim to decide whether to refresh). The backend will reject truly
 * invalid tokens — this is just an optimistic check.
 */
function jwtExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** True when the token is expired or will expire within 60 seconds. */
function isExpiredOrStale(token: string): boolean {
  const exp = jwtExpiresAt(token);
  if (exp === null) return true; // can't parse → treat as expired
  return exp - 60 < Date.now() / 1000;
}

export async function middleware(request: NextRequest) {
  const accessValue = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshValue = request.cookies.get(REFRESH_COOKIE)?.value;

  // ---- Happy path: access token present and still valid ----
  if (accessValue && !isExpiredOrStale(accessValue)) {
    return NextResponse.next();
  }

  // ---- No refresh token → can't recover → sign-in ----
  if (!refreshValue) {
    return redirectToSignIn(request);
  }

  // ---- Try to refresh the token pair ----
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshValue }),
      cache: 'no-store',
    });

    if (!res.ok) {
      // Refresh token is invalid / revoked / expired → sign-in
      return redirectToSignIn(request);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };

    // Let the request proceed AND set the new tokens on the response
    const response = NextResponse.next();
    response.cookies.set(ACCESS_COOKIE, data.access_token, accessCookieOptions);
    response.cookies.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions);

    // Also set on the *request* so downstream server components see the
    // refreshed access token in the same render pass.
    request.cookies.set(ACCESS_COOKIE, data.access_token);
    request.cookies.set(REFRESH_COOKIE, data.refresh_token);

    return response;
  } catch {
    // Network error talking to the API — don't lock the user out, let
    // the downstream code try with whatever token is left.
    if (accessValue) return NextResponse.next();
    return redirectToSignIn(request);
  }
}

function redirectToSignIn(request: NextRequest): NextResponse {
  const signIn = new URL('/sign-in', request.url);
  const returnTo = request.nextUrl.pathname + request.nextUrl.search;
  signIn.searchParams.set('return_to', returnTo);
  const response = NextResponse.redirect(signIn);
  // Clear stale cookies so the sign-in page doesn't think the user is logged in
  response.cookies.set(ACCESS_COOKIE, '', { ...accessCookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...refreshCookieOptions, maxAge: 0 });
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
