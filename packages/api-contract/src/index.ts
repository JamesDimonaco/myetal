/**
 * @myetal/api-contract — the single typed source of truth for the MyEtAl API.
 *
 * Types are generated from the FastAPI OpenAPI spec (Pydantic schemas). Do not
 * hand-edit `src/generated`. Regenerate with:
 *   pnpm --filter @myetal/api-contract generate
 */
// `paths` / `components` are re-exported transitively via ./schemas.
export * from './schemas';
export {
  ApiError,
  type RequestOptions,
  type PathsFor,
  type ApiResponse,
  type ApiRequestBody,
} from './transport';
