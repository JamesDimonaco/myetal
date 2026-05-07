/**
 * Shapes for /me/works endpoints — the personal works library.
 * Mirrors the backend WorkResponse / PaperOut / AddWorkRequest schemas.
 */

export type PaperSource = 'orcid' | 'crossref' | 'openalex' | 'manual';
export type UserPaperAddedVia = 'orcid' | 'manual' | 'share';

export interface PaperOut {
  id: string;
  doi: string | null;
  openalex_id: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  year: number | null;
  venue: string | null;
  abstract: string | null;
  url: string | null;
  pdf_url: string | null;
  image_url: string | null;
  source: PaperSource;
}

export interface WorkResponse {
  paper: PaperOut;
  added_via: UserPaperAddedVia;
  added_at: string;
  hidden_at: string | null;
}

export interface AddWorkRequest {
  identifier: string;
}

/** POST /me/works/sync-orcid response shape. */
export interface OrcidSyncResponse {
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
}
