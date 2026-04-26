/**
 * Receives the `{ access_token, refresh_token }` pair the OAuth finish page
 * scraped out of the URL fragment, drops them into httpOnly cookies, and
 * 200s. The fragment-bearing URL only existed for one redirect hop — by the
 * time this handler returns, the tokens are no longer reachable from JS in
 * the browser.
 *
 * This is the boundary between "the fragment exists in the URL" and "the
 * session lives in an httpOnly cookie". Don't make it longer than it has to
 * be: no third-party calls, no logging the tokens.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from '@/lib/auth-cookies';

export async function POST(request: Request) {
  let body: { access_token?: string; refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!body.access_token || !body.refresh_token) {
    return NextResponse.json(
      { error: 'access_token and refresh_token required' },
      { status: 400 },
    );
  }

  const store = await cookies();
  store.set(ACCESS_COOKIE, body.access_token, accessCookieOptions);
  store.set(REFRESH_COOKIE, body.refresh_token, refreshCookieOptions);

  return NextResponse.json({ ok: true });
}
