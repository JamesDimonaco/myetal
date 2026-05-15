import { clearSession, getAccessToken } from './auth-storage';

/**
 * Resolve the FastAPI base URL.
 *  1. Explicit override via EXPO_PUBLIC_API_URL (best for testing against
 *     staging, a tunneled backend, or localhost)
 *  2. Always use production API — local dev server is not needed
 */
function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://api.myetal.app';
}

/**
 * Resolve the Better Auth (Next.js web app) base URL — the host that owns
 * /api/auth/*. Mobile hits this directly for sign-in/sign-up/social-OAuth.
 *  1. Explicit override via EXPO_PUBLIC_WEB_URL.
 *  2. Default to the canonical production web app.
 */
function resolveWebBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WEB_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://myetal.app';
}

export const API_BASE_URL = resolveApiBaseUrl();
export const WEB_BASE_URL = resolveWebBaseUrl();

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
   * pulls the latest access token from secure storage on every request.
   *
   * Pass `auth: null` to opt OUT of attaching any token (useful for genuinely
   * public endpoints like /public/c/{code}).
   */
  auth?: string | null;
  headers?: Record<string, string>;
}

/**
 * Hook the rest of the app uses to react to a forced sign-out — the auth hook
 * registers a callback here so the api client can yank the user back to
 * /sign-in when the JWT comes back rejected.
 *
 * Phase 4: there is no client-side refresh. The Better Auth session lives
 * server-side and the cookie that refreshes it isn't accessible from native.
 * On 401 with a token attached we wipe local state and bounce to sign-in.
 */
type SignOutHandler = () => void;
let onForcedSignOut: SignOutHandler | null = null;

export function setForcedSignOutHandler(handler: SignOutHandler | null): void {
  onForcedSignOut = handler;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, auth, headers: extraHeaders, ...rest } = options;

  // Resolve which token to attach. `auth: null` opts out entirely; an explicit
  // string overrides storage; otherwise we read from secure storage.
  let token: string | null;
  if (auth === null) token = null;
  else if (typeof auth === 'string') token = auth;
  else token = await getAccessToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders,
  };
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, { ...rest, headers, body });

  // 401 with a token attached means our JWT is dead (expired, revoked, or
  // signed by a key BA has rotated past). Wipe local state and surface the
  // forced-sign-out signal so the (authed) layout bounces to /sign-in. We
  // do NOT attempt a refresh — Phase 4 locked decision: mobile doesn't hold
  // a refresh secret, and BA's session cookie is not accessible from native.
  if (response.status === 401 && token && auth !== null) {
    await clearSession();
    onForcedSignOut?.();
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
