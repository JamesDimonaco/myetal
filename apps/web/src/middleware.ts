/**
 * Gatekeeper for /dashboard/*. Requires a valid Better Auth session.
 *
 * Phase 3 rewrite: drops the JWT-decode-and-refresh dance. Better Auth
 * owns refresh — the session cookie either resolves to a valid session
 * (let the request through) or it doesn't (bounce to /sign-in). We do
 * not call ``auth.api.getSession()`` here because it requires the
 * Node runtime, while Next 16 middleware runs on the Edge runtime by
 * default. Instead we look for the session cookie's presence; the
 * downstream layout's ``serverFetch`` to ``/me`` is the authoritative
 * check (it 401s on invalid sessions and the layout redirects).
 *
 * Cookie presence is sufficient at the middleware boundary: cookies
 * are unforgeable to anyone without ``BETTER_AUTH_SECRET``, and the
 * server-side ``/me`` round-trip catches expired sessions.
 *
 * NOTE on Next.js 16: ``middleware`` is deprecated in favour of
 * ``proxy``. Both still work in 16.x; we use ``middleware`` per the
 * existing build spec. Codemod when we upgrade past the deprecation.
 */

import { NextResponse, type NextRequest } from 'next/server';

// Better Auth adds the `__Secure-` prefix automatically when the cookie is
// set with the Secure flag on HTTPS (any production-like host). On HTTP
// (local dev with `expo start` against a non-https origin) the prefix is
// absent. Check both so middleware works in both modes.
const SESSION_COOKIE = 'myetal_session';
const SESSION_COOKIE_SECURE = `__Secure-${SESSION_COOKIE}`;

export function middleware(request: NextRequest) {
  const sessionValue =
    request.cookies.get(SESSION_COOKIE_SECURE)?.value ??
    request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionValue) {
    return NextResponse.next();
  }
  return redirectToSignIn(request);
}

function redirectToSignIn(request: NextRequest): NextResponse {
  const signIn = new URL('/sign-in', request.url);
  const returnTo = request.nextUrl.pathname + request.nextUrl.search;
  signIn.searchParams.set('return_to', returnTo);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Don't gate /api/auth/* — Better Auth owns its own routing and our
  // middleware must not interfere with the OAuth redirect chain or the
  // sign-out cookie clear.
  matcher: ['/dashboard/:path*'],
};
