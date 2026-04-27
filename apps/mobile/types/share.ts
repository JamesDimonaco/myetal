/**
 * Shapes that mirror the backend's Pydantic responses. Kept hand-written for
 * now; once the OpenAPI codegen pipeline (planned for the web app) is in
 * place, these will be generated and live in packages/types.
 */

export type ShareType = 'paper' | 'collection' | 'poster' | 'grant';

/**
 * v1 item kinds. Server defaults to 'paper' for legacy rows so this stays
 * backward-compatible with existing shares.
 */
export type ShareItemKind = 'paper' | 'repo' | 'link';

export interface ShareItem {
  id: string;
  position: number;
  kind: ShareItemKind;
  title: string;
  url: string | null;
  subtitle: string | null;
  image_url: string | null;
  scholar_url: string | null;
  doi: string | null;
  authors: string | null;
  year: number | null;
  notes: string | null;
}

/** A share that has at least one paper in common with the viewed share (D8). */
export interface RelatedShare {
  short_code: string;
  name: string;
  papers_in_common: number;
}

/** A precomputed similar share from the nightly cron (D9). */
export interface SimilarShare {
  short_code: string;
  name: string;
  papers_in_common: number;
}

export interface PublicShareResponse {
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  items: ShareItem[];
  owner_name: string | null;
  updated_at: string;
  related_shares: RelatedShare[];
  similar_shares: SimilarShare[];
}

/** Owner-facing share — returned by /shares CRUD (authed). */
export interface ShareResponse {
  id: string;
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  is_public: boolean;
  /** Discovery opt-in (D1). null = not published; ISO timestamp = published. */
  published_at: string | null;
  /** Tombstone marker (D14). null = live; ISO timestamp = soft-deleted. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  items: ShareItem[];
}

export interface ShareItemInput {
  title: string;
  kind?: ShareItemKind;
  url?: string | null;
  subtitle?: string | null;
  image_url?: string | null;
  scholar_url?: string | null;
  doi?: string | null;
  authors?: string | null;
  year?: number | null;
  notes?: string | null;
}

export interface ShareCreateInput {
  name: string;
  description?: string | null;
  type: ShareType;
  is_public?: boolean;
  items: ShareItemInput[];
}

export interface ShareUpdateInput {
  name?: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  items?: ShareItemInput[];
}
