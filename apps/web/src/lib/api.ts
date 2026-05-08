/**
 * Tiny fetch wrapper for talking to the FastAPI backend.
 *
 * Mirrors the shape of apps/mobile/lib/api.ts so the patterns line up. Two
 * extra things vs. mobile:
 *
 *  1. Server components (RSC) never have access to localStorage; they read the
 *     httpOnly `myetal_session` cookie via Next's `cookies()` helper and
 *     forward it as a Cookie header. See `serverFetch` below.
 *  2. Public endpoints (the `/c/{code}` viewer) call `api()` directly without
 *     an `auth` token — the wrapper just hits the backend with no Authorization
 *     header. We pass `next: { revalidate: 300 }` from the call site to opt
 *     into Next's data cache for the public path.
 */

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:8000'
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`HTTP ${status}: ${detail}`);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** Sent as JSON body with appropriate Content-Type. */
  json?: unknown;
  /** Bearer token. Caller is responsible for sourcing it (cookie / ctx / etc). */
  auth?: string;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, auth, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders,
  };

  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, { ...rest, headers, body });

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
