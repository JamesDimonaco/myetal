/**
 * Centralised cookie config for the session pair. Both cookies are httpOnly
 * (so JS in the client can't see them — XSS won't leak the access token),
 * SameSite=Lax (so a top-level navigation from another origin still carries
 * the cookie, which we need for the OAuth callback redirect chain), and
 * Secure in production.
 *
 * Lifetimes mirror the backend defaults (~15min access, ~30d refresh) so the
 * browser stops sending stale tokens once the backend would reject them.
 */

import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

export const ACCESS_COOKIE = 'myetal_access';
export const REFRESH_COOKIE = 'myetal_refresh';

const isProd = process.env.NODE_ENV === 'production';

const baseOptions: Partial<ResponseCookie> = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,
  path: '/',
};

export const accessCookieOptions: Partial<ResponseCookie> = {
  ...baseOptions,
  // Backend access tokens are ~15min; we set 1h so a long server-render or
  // tab idle doesn't sign the user out mid-action. Backend will 401 if the
  // JWT itself has expired and the client should refresh.
  maxAge: 60 * 60,
};

export const refreshCookieOptions: Partial<ResponseCookie> = {
  ...baseOptions,
  maxAge: 60 * 60 * 24 * 30, // 30 days
};

export const clearCookieOptions: Partial<ResponseCookie> = {
  ...baseOptions,
  maxAge: 0,
};
