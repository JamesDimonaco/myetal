/**
 * Compile-time regression tests for the path-typed transport helpers.
 *
 * No test runner involved: these are pure type-level assertions, executed by
 * `pnpm --filter @myetal/api-contract typecheck` (tsc --noEmit, `include:
 * ["src"]`). If a regeneration of `generated/schema.d.ts` or an edit to
 * `transport.ts` changes what these helpers resolve to, the typecheck fails
 * with an error pointing at the exact broken case.
 *
 * The main regression under guard: `ApiRequestBody` once resolved to `never`
 * for 42 real operations because the conditional's `requestBody` pattern
 * didn't match body-less ops' `requestBody?: never`. The tuple-wrap in
 * transport.ts fixed it; the `Equal<..., ShareCreate>` cases below fail
 * loudly if that ever comes back.
 *
 * `Equal` is the standard invariance trick (conditional-type identity under
 * generic instantiation) — it distinguishes `ShareCreate` from `unknown`,
 * `any`, and `ShareCreate | undefined`, which a plain `extends` check
 * would conflate.
 */
import type {
  PublicShareResponse,
  ShareCreate,
  ShareResponse,
  ShareUpdate,
  UserResponse,
} from './schemas';
import type { ApiRequestBody, ApiResponse, PathsFor } from './transport';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _cases = [
  // --- ApiRequestBody: the tuple-wrap regression guard --------------------
  Expect<Equal<ApiRequestBody<'/shares', 'post'>, ShareCreate>>,
  Expect<Equal<ApiRequestBody<'/shares/{share_id}', 'patch'>, ShareUpdate>>,

  // --- ApiResponse: both success-status branches --------------------------
  // 201 branch (create)
  Expect<Equal<ApiResponse<'/shares', 'post'>, ShareResponse>>,
  // 200 branch (reads)
  Expect<Equal<ApiResponse<'/shares/{share_id}', 'patch'>, ShareResponse>>,
  Expect<
    Equal<ApiResponse<'/public/c/{short_code}', 'get'>, PublicShareResponse>
  >,
  Expect<Equal<ApiResponse<'/me', 'get'>, UserResponse>>,

  // --- PathsFor: method-supporting path filtering --------------------------
  Expect<Equal<'/shares' extends PathsFor<'post'> ? true : false, true>>,
  Expect<Equal<'/healthz' extends PathsFor<'post'> ? true : false, false>>,
  Expect<Equal<'/healthz' extends PathsFor<'get'> ? true : false, true>>,
];
