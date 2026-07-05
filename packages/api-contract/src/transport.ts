/**
 * Shared transport core. The one copy of `ApiError` + `RequestOptions` + the
 * path-typed request/response helpers, so web and mobile stop maintaining two
 * drifting copies (see `apps/web/src/lib/api.ts` and `apps/mobile/lib/api.ts`).
 *
 * This module deliberately does NOT own auth or the base URL — those are the
 * three legitimately-different call contexts (RSC JWT mint, client proxy,
 * native secure-storage) that each app keeps as a thin adapter around a fetch.
 * We only centralise the parts that are genuinely identical.
 *
 * Phase 4 of the api-contract-codegen ticket rewires the existing wrappers onto
 * this. Until then it is the typed foundation, exercised by the package's own
 * typecheck.
 */
import type { paths } from './generated/schema';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
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
  /** Sent as a JSON body with the appropriate Content-Type. */
  json?: unknown;
  /** Bearer token. `null`/omitted opts out; each app sources it its own way. */
  auth?: string | null;
  headers?: Record<string, string>;
}

// --- Path-typed helpers ---------------------------------------------------
// These derive the exact request body / response shape for a given path +
// method straight from the generated `paths`, so a typed client (or a call
// site) can be checked against what FastAPI actually serves — the `T` in
// `api<T>()` stops being a hand-asserted guess.

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Paths that support a given method. */
export type PathsFor<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never;
}[keyof paths];

type Op<P extends keyof paths, M extends HttpMethod> = paths[P] extends Record<
  M,
  infer O
>
  ? O
  : never;

/** The 2xx JSON response body for `PATH` + `METHOD`. */
export type ApiResponse<
  P extends keyof paths,
  M extends HttpMethod,
> = Op<P, M> extends {
  responses: { 200: { content: { 'application/json': infer R } } };
}
  ? R
  : Op<P, M> extends {
        responses: { 201: { content: { 'application/json': infer R } } };
      }
    ? R
    : unknown;

/**
 * The JSON request body for `PATH` + `METHOD`, if it takes one.
 *
 * Handles both required (`requestBody:`) and optional (`requestBody?:`) bodies —
 * FastAPI emits the latter for any route whose body model is fully defaultable,
 * which is the majority. A tuple-wrap defeats distributive conditional
 * inference so `Op` with an absent `requestBody` cleanly falls through.
 */
export type ApiRequestBody<
  P extends keyof paths,
  M extends HttpMethod,
> = [Op<P, M>] extends [
  { requestBody?: { content: { 'application/json'?: infer B } } },
]
  ? B
  : never;
