/**
 * Sign-up route handler. Same shape as /api/auth/login: take email/password
 * (+ optional name), call the backend's /auth/register, then drop the JWT
 * pair into httpOnly cookies.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { ApiError, api } from '@/lib/api';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from '@/lib/auth-cookies';
import type { TokenPair } from '@/types/auth';

export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  let tokens: TokenPair;
  try {
    tokens = await api<TokenPair>('/auth/register', {
      method: 'POST',
      json: {
        email: body.email,
        password: body.password,
        name: body.name ?? null,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.detail }, { status: err.status });
    }
    return NextResponse.json({ error: 'sign-up failed' }, { status: 500 });
  }

  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.access_token, accessCookieOptions);
  store.set(REFRESH_COOKIE, tokens.refresh_token, refreshCookieOptions);

  return NextResponse.json({ ok: true });
}
