/**
 * Mirrors the backend's `PaperMetadata` / `PaperSearchResult` Pydantic shapes.
 * Hand-written for now — will be replaced when the OpenAPI codegen pipeline
 * lands and pushes generated types into packages/types.
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
