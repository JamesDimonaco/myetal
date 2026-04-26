/**
 * Bounce the browser into the backend's GitHub OAuth flow. The backend handles
 * the actual OAuth dance with GitHub (state cookie, code exchange, user
 * upsert) and then redirects to PUBLIC_BASE_URL/auth/finish#access_token=...
 * which our /auth/finish client component picks up.
 *
 * Why bounce through here instead of linking directly to the backend? Two
 * reasons: (1) it keeps the FastAPI URL out of the marketing HTML so we can
 * change backends without touching every "Sign in with GitHub" button, and
 * (2) it gives us a place to attach the `return_to` (where the user wanted
 * to land originally — e.g. /dashboard/share/abc).
 */

import { NextResponse } from 'next/server';

import { API_BASE_URL } from '@/lib/api';

const ALLOWED_RETURN_PREFIXES = ['/dashboard', '/'];

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  // Open-redirect guard: only allow same-site paths starting with /, and
  // never paths starting with // (protocol-relative).
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (!ALLOWED_RETURN_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/dashboard';
  }
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('return_to'));

  const target = new URL(`${API_BASE_URL}/auth/github/start`);
  target.searchParams.set('platform', 'web');
  target.searchParams.set('return_to', returnTo);

  return NextResponse.redirect(target.toString(), 302);
}
