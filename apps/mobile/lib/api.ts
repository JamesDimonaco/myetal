import Constants from 'expo-constants';

import { clearTokens, getTokens, setTokens } from './auth-storage';

/**
 * Resolve the API base URL with a smart dev-vs-prod waterfall:
 *  1. Explicit override via EXPO_PUBLIC_API_URL (best for testing against staging
 *     or a tunneled backend)
 *  2. In Expo Go on a real device, point at the Metro host's IP on port 8000 —
 *     so `pnpm start` + a phone on the same Wi-Fi as your Mac just works
 *  3. Production fallback
 */
function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older Expo Go fallback
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } })
      .expoGoConfig?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8000`;
  }

  return 'https://api.ceteris.app';
}

export const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`HTTP ${status}: ${detail}`);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  json?: unknown;
  /**
   * Explicit bearer token override. When omitted (the common case), the client
   * pulls the latest access token from secure storage on every request and
   * transparently retries once on 401 after a refresh.
   *
   * Pass `auth: null` to opt OUT of attaching any token (used internally by the
   * refresh path itself to avoid recursion, and useful for genuinely public
   * endpoints like /public/c/{code}).
   */
  auth?: string | null;
  headers?: Record<string, string>;
}

/**
 * Single in-flight refresh promise. Multiple parallel requests that all see a
 * 401 should converge on ONE /auth/refresh call rather than each spending a
 * refresh token (and racing to revoke each other via reuse-detection).
 */
let pendingRefresh: Promise<string | null> | null = null;

/**
 * Hook the rest of the app uses to react to a forced sign-out — the auth hook
 * registers a callback here so the api client can yank the user back to
 * /sign-in when the refresh token has been revoked or expired.
 */
type SignOutHandler = () => void;
let onForcedSignOut: SignOutHandler | null = null;

export function setForcedSignOutHandler(handler: SignOutHandler | null): void {
  onForcedSignOut = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const tokens = await getTokens();
    if (!tokens) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: tokens.refresh }),
      });

      if (!response.ok) {
        // Backend revoked the family — can't recover without re-auth
        await clearTokens();
        onForcedSignOut?.();
        return null;
      }

      const data = (await response.json()) as { access_token: string; refresh_token: string };
      await setTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } catch {
      // Network blip; don't nuke tokens. Caller will surface the error.
      return null;
    }
  })();

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, auth, headers: extraHeaders, ...rest } = options;

  // Resolve which token to attach. `auth: null` opts out entirely; an explicit
  // string overrides storage; otherwise we read from secure storage.
  let token: string | null;
  if (auth === null) token = null;
  else if (typeof auth === 'string') token = auth;
  else {
    const stored = await getTokens();
    token = stored?.access ?? null;
  }

  const send = async (bearer: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extraHeaders,
    };
    let body: BodyInit | undefined;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (bearer) headers.Authorization = `Bearer ${bearer}`;

    const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(url, { ...rest, headers, body });
  };

  let response = await send(token);

  // ONE silent refresh attempt on 401 — but only when we had a token to begin
  // with (otherwise the 401 means "this endpoint requires auth", not "your
  // session expired") and the caller didn't explicitly opt out.
  if (response.status === 401 && token && auth !== null) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send(refreshed);
    }
  }

  if (!response.ok) {
    let detail = response.statusText || 'request failed';
    try {
      const errorBody = await response.json();
      if (typeof errorBody?.detail === 'string') detail = errorBody.detail;
    } catch {
      // body may not be JSON; keep statusText
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
