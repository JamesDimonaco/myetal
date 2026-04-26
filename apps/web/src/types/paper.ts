/**
 * Mirrors the backend's `PaperMetadata` / `PaperSearchResult` Pydantic shapes.
 * Hand-written — will be replaced when OpenAPI codegen lands. Mirrors
 * apps/mobile/types/paper.ts so the contract is identical across platforms.
 */

export interface Paper {
  doi: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  container: string | null;
  scholar_url: string | null;
  source: 'crossref' | 'openalex';
}

export interface PaperSearchResult extends Paper {
  /** OpenAlex relevance score; higher is better. Unitless. */
  score: number;
}

export interface PaperSearchResponse {
  results: PaperSearchResult[];
}
