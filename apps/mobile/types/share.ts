/**
 * Share domain types.
 *
 * These are NO LONGER hand-written. They are re-exported from
 * `@myetal/api-contract`, generated from the FastAPI OpenAPI spec (the Pydantic
 * schemas are the source of truth) — the codegen pipeline this file's old
 * header was waiting for. This shim maps the legacy local names used across the
 * mobile app onto the canonical generated names so existing imports keep
 * working while call sites migrate to `@myetal/api-contract` directly.
 *
 * To change a shape: edit the Pydantic schema, then
 *   pnpm --filter @myetal/api-contract generate
 *
 * See docs/tickets/to-do/api-contract-codegen.md.
 */
import type {
  ItemKind,
  TagOut,
  ShareItemResponse,
  RelatedShareOut,
  SimilarShareOut,
  ShareItemCreate,
  ShareCreate,
  ShareUpdate,
} from '@myetal/api-contract';

// Names that already match the backend — straight re-export.
export type {
  ShareType,
  ShareResponse,
  PublicShareResponse,
  ShareSearchResult,
  ShareSearchResponse,
  BrowseShareResult,
  BrowseResponse,
  UserPublicOut,
} from '@myetal/api-contract';

// Legacy local aliases → canonical generated names.
export type ShareItemKind = ItemKind;
export type Tag = TagOut;
export type ShareItem = ShareItemResponse;
export type RelatedShare = RelatedShareOut;
export type SimilarShare = SimilarShareOut;
export type ShareItemInput = ShareItemCreate;
export type ShareCreateInput = ShareCreate;
export type ShareUpdateInput = ShareUpdate;
