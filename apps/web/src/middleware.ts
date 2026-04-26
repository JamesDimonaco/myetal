/**
 * Gatekeeper for /dashboard/*. Anything under /dashboard requires the
 * `ceteris_access` cookie; missing → bounce to /sign-in?return_to=<original>.
 *
 * NOTE on Next.js 16: `middleware` is deprecated in favour of `proxy`. Both
 * still work in 16.x; we use `middleware` per the build spec. When we
 * upgrade to a release that drops middleware, run
 * `npx @next/codemod@canary middleware-to-proxy .` to rename.
 *
 * Defence in depth: server components that call `serverFetch` will also get
 * a 401 from the backend if the cookie is somehow stale, and we re-check
 * inside server actions. This middleware is only a UX shortcut so authed
 * pages don't briefly render an empty state for signed-out users.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE } from '@/lib/auth-cookies';

export function middleware(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE);

  if (!access?.value) {
    const signIn = new URL('/sign-in', request.url);
    // pathname + search so we land back on, e.g., /dashboard/share/abc?tab=2
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    signIn.searchParams.set('return_to', returnTo);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
