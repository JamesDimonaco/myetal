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

export interface OpenAccessInfo {
  is_oa: boolean;
  oa_status: string | null;
  oa_url: string | null;
}

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
