/**
 * Sign-in route handler. The browser POSTs the form here; we exchange
 * credentials with the FastAPI backend and turn the resulting JWT pair into
 * httpOnly cookies. The access token NEVER touches client-readable storage,
 * which is the whole point of doing this in a route handler instead of
 * letting the React form fetch the backend directly.
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
  let body: { email?: string; password?: string };
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
    tokens = await api<TokenPair>('/auth/login', {
      method: 'POST',
      json: { email: body.email, password: body.password },
    });
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.detail }, { status: err.status });
    }
    return NextResponse.json({ error: 'sign-in failed' }, { status: 500 });
  }

  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.access_token, accessCookieOptions);
  store.set(REFRESH_COOKIE, tokens.refresh_token, refreshCookieOptions);

  return NextResponse.json({ ok: true });
}
