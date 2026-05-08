/**
 * Shapes that mirror the backend's Pydantic responses. Kept hand-written for
 * now; once the OpenAPI codegen pipeline (planned for the web app) is in
 * place, these will be generated and live in packages/types.
 */

export type ShareType = 'paper' | 'collection' | 'bundle' | 'grant' | 'project';

/**
 * v1 item kinds. Server defaults to 'paper' for legacy rows so this stays
 * backward-compatible with existing shares. `pdf` (PR-C) covers user-uploaded
 * PDF files; the file lives in R2 and surfaces via `file_url` + `thumbnail_url`.
 */
export type ShareItemKind = 'paper' | 'repo' | 'link' | 'pdf';

/**
 * Topical tag. Mirrors the backend `TagOut` schema. `slug` is the canonical
 * lowercased + hyphenated form used for filtering / autocomplete; `label` is
 * the title-cased display form. `usage_count` only present on listing
 * endpoints (autocomplete + popular).
 */
export interface Tag {
  id: string;
  slug: string;
  label: string;
  usage_count?: number;
}

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
  // PDF item fields (PR-C). Populated only when `kind === 'pdf'`. The R2
  // public URL of the uploaded PDF; the first-page thumbnail JPEG (also on
  // R2); the actual byte size after server-side recheck; the sniffed MIME
  // (always `application/pdf` for kind=pdf, kept for parity with web).
  file_url?: string | null;
  thumbnail_url?: string | null;
  file_size_bytes?: number | null;
  file_mime?: string | null;
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
  tags?: Tag[];
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
  /** Topical tags (PR-A). Slugs lowercased + hyphenated, max 5. */
  tags?: Tag[];
}

export interface ShareItemInput {
  /**
   * Server-assigned id for an existing item. Present on round-trip updates so
   * the backend's merge logic can identify the row by id and preserve
   * server-owned fields (e.g. PDF file_url / thumbnail_url) without the client
   * having to re-send them. Absent on new items — server creates fresh rows.
   */
  id?: string;
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
  // PDF item fields. The mobile editor never sets these directly — PDFs come
  // back from `record-pdf-upload` already populated. They live on the input
  // type so a round-trip through the editor (which serialises every item)
  // doesn't drop the values. See `apps/mobile/app/(authed)/share/[id].tsx`
  // `apiItems` where every server field is forwarded back verbatim.
  file_url?: string | null;
  thumbnail_url?: string | null;
  file_size_bytes?: number | null;
  file_mime?: string | null;
}

export interface ShareCreateInput {
  name: string;
  description?: string | null;
  type: ShareType;
  is_public?: boolean;
  items: ShareItemInput[];
  /** Tag slugs. Max 5; server canonicalises further. */
  tags?: string[];
}

export interface ShareUpdateInput {
  name?: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  items?: ShareItemInput[];
  /** Tag slugs (replace semantics). Max 5; omit to leave unchanged. */
  tags?: string[];
}

/** A single result from the public share search endpoint. */
export interface ShareSearchResult {
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  owner_name: string | null;
  item_count: number;
  published_at: string;
  updated_at: string;
  preview_items: string[];
  tags?: Tag[];
}

/** Paginated response from `GET /public/search`. */
export interface ShareSearchResponse {
  results: ShareSearchResult[];
  has_more: boolean;
  /** Top-N users (≥1 published share) matching `q`. Added in PR-B. */
  users?: UserPublicOut[];
}

// ---------------------------------------------------------------------------
// Public browse (discovery page)
// ---------------------------------------------------------------------------

export interface BrowseShareResult {
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  owner_name: string | null;
  item_count: number;
  published_at: string;
  updated_at: string;
  preview_items: string[];
  view_count: number | null;
  tags?: Tag[];
}

export interface BrowseResponse {
  trending: BrowseShareResult[];
  recent: BrowseShareResult[];
  total_published: number;
  /** Populated only when `?owner_id=` is set on the request (PR-B §5). */
  owner?: UserPublicOut | null;
}

// ---------------------------------------------------------------------------
// Public users (PR-B §5 — discovery)
// ---------------------------------------------------------------------------

/**
 * The slim, public-safe representation of a user. Surfaced by
 * `/public/search` (top users matching `q`) and `/public/browse?owner_id=`
 * (the owner header on a per-user browse page). Privacy default: only users
 * with at least one published share are returned.
 */
export interface UserPublicOut {
  id: string;
  name: string | null;
  avatar_url: string | null;
  share_count: number;
}
