/**
 * Client-side fetch wrapper that talks to the same FastAPI backend the server
 * code does, but routes via our /api/proxy/* same-origin handler so the
 * httpOnly access-token cookie can be attached server-side. Mirrors the
 * `api()` shape from `lib/api.ts` so component code looks identical.
 *
 * Use from "use client" components only. Server components / actions should
 * call `serverFetch` directly — one hop instead of two.
 */

import { ApiError, type RequestOptions } from './api';

export async function clientApi<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { json, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders,
  };

  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  const url = `/api/proxy${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, { ...rest, headers, body });

  if (!response.ok) {
    let detail = response.statusText || 'request failed';
    try {
      const errorBody = await response.json();
      if (typeof errorBody?.detail === 'string') detail = errorBody.detail;
    } catch {
      // body may not be JSON
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
