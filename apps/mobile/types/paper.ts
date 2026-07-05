/**
 * Paper-search domain types — re-exported from `@myetal/api-contract`
 * (generated from the FastAPI OpenAPI spec). This shim maps the legacy local
 * name `Paper` onto the canonical `PaperMetadata`; the rest match the backend.
 *
 * Do not hand-edit. Change the Pydantic schema, then
 *   pnpm --filter @myetal/api-contract generate
 * See docs/tickets/to-do/api-contract-codegen.md.
 */
import type { PaperMetadata } from '@myetal/api-contract';

export type {
  OpenAccessInfo,
  TopicInfo,
  PaperSearchResult,
  PaperSearchResponse,
} from '@myetal/api-contract';

/** Legacy local name for the backend `PaperMetadata` shape. */
export type Paper = PaperMetadata;
