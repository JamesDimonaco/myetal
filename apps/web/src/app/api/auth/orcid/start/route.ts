/**
 * Bounce the browser into the backend's ORCID OAuth flow. Mirrors the
 * Google start handler — see ../google/start/route.ts for the rationale.
 */

import { NextResponse } from 'next/server';

import { API_BASE_URL } from '@/lib/api';

const ALLOWED_RETURN_PREFIXES = ['/dashboard', '/'];

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (!ALLOWED_RETURN_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/dashboard';
  }
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('return_to'));

  const target = new URL(`${API_BASE_URL}/auth/orcid/start`);
  target.searchParams.set('platform', 'web');
  target.searchParams.set('return_to', returnTo);

  return NextResponse.redirect(target.toString(), 302);
}
