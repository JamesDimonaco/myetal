/**
 * Sign out: tell the backend to revoke the refresh token (so reuse detection
 * trips if anyone replays it), then clear both cookies.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { api } from '@/lib/api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearCookieOptions,
} from '@/lib/auth-cookies';

export async function POST() {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;

  if (refresh) {
    try {
      await api('/auth/logout', {
        method: 'POST',
        json: { refresh_token: refresh },
      });
    } catch {
      // Backend revoke failed — log it but still clear cookies locally,
      // because the user clicked sign-out and we shouldn't pretend they're
      // still signed in.
    }
  }

  store.set(ACCESS_COOKIE, '', clearCookieOptions);
  store.set(REFRESH_COOKIE, '', clearCookieOptions);

  return NextResponse.json({ ok: true });
}
