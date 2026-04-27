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
  /** Number of times this work has been cited. */
  cited_by_count: number;
  /** Work type — "article", "preprint", "book-chapter", "dataset", etc. */
  type: string | null;
  /** Full publication date (ISO 8601 date string, e.g. "2023-06-15"). */
  publication_date: string | null;
  /** True if the paper has been retracted. */
  is_retracted: boolean;
  /** Open-access metadata from OpenAlex. */
  open_access: {
    is_oa: boolean;
    oa_status: string | null;
    oa_url: string | null;
  };
  /** Direct PDF link when available. */
  pdf_url: string | null;
  /** Topics with relevance scores. */
  topics: { name: string; score: number }[];
  /** Author-assigned or inferred keywords. */
  keywords: string[];
  /** ISO 639-1 language code (e.g. "en"). */
  language: string | null;
}

export interface PaperSearchResponse {
  results: PaperSearchResult[];
}
