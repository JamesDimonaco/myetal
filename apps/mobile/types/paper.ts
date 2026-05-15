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

export interface OpenAccessInfo {
  is_oa: boolean;
  oa_status: string | null;
  oa_url: string | null;
}

/**
 * A topic associated with a paper, with the OpenAlex relevance score in
 * [0, 1]. Mirrors `schemas/papers.py::TopicInfo` — the wire shape really
 * is just `{name, score}`. This interface used to accidentally include
 * fields cloned from `PaperSearchResult` (cited_by_count, is_retracted,
 * etc.) which the runtime payload never populates; any consumer that
 * trusted those fields would have read `undefined`.
 */
export interface TopicInfo {
  name: string;
  score: number;
}

export interface PaperSearchResult extends Paper {
  score: number;
  cited_by_count: number;
  type: string | null;
  publication_date: string | null;
  is_retracted: boolean;
  open_access: OpenAccessInfo;
  pdf_url: string | null;
  topics: TopicInfo[];
  keywords: string[];
  language: string | null;
}

export interface PaperSearchResponse {
  results: PaperSearchResult[];
}
