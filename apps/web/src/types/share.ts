/**
 * Shapes that mirror the backend's Pydantic responses for shares. Hand-written
 * for now to match apps/mobile/types/share.ts; once the OpenAPI codegen
 * pipeline lands these will be generated and live in packages/types.
 */

export type ShareType =
  | 'paper'
  | 'collection'
  | 'bundle'
  | 'grant'
  | 'project';

export type ShareItemKind = 'paper' | 'repo' | 'link' | 'pdf';

/**
 * A topical tag attached to a share. `slug` is the canonical lowercased,
 * trimmed, hyphenated form (mirrors backend canonicalisation per Q8). `label`
 * is the title-cased display string. `usage_count` powers autocomplete sort.
 */
export interface Tag {
  id: string;
  slug: string;
  label: string;
  usage_count: number;
}

export interface ShareItem {
  id: string;
  position: number;
  kind: ShareItemKind;
  title: string;
  scholar_url: string | null;
  doi: string | null;
  authors: string | null;
  year: number | null;
  notes: string | null;
  url: string | null;
  subtitle: string | null;
  image_url: string | null;
  /** PDF-only fields (PR-C). Null on non-PDF items. */
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

/** What the public viewer (`GET /public/c/{code}`) returns. No auth required. */
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
  tags: Tag[];
}

/** Authed owner view (`GET /shares` and `GET /shares/{id}`). */
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
  tags: Tag[];
}

/** Item input shape — matches ShareItemCreate on the backend. `kind` defaults
 *  to `'paper'` server-side for back-compat, so existing single-paper / paper
 *  collection clients keep working unchanged. */
export interface ShareItemInput {
  /** Server-assigned UUID for items that already exist on a share. Sent on
   *  PATCH so the backend's update_share merge logic can identify existing
   *  rows (notably PDFs, whose file fields are server-managed and must not
   *  be re-sent from the bulk path). New items omit this. */
  id?: string;
  kind?: ShareItemKind;
  title: string;
  scholar_url?: string | null;
  doi?: string | null;
  authors?: string | null;
  year?: number | null;
  notes?: string | null;
  url?: string | null;
  subtitle?: string | null;
  image_url?: string | null;
  /** PDF-only fields (PR-C). Echoed back from a successful record-pdf-upload. */
  file_url?: string | null;
  thumbnail_url?: string | null;
  file_size_bytes?: number | null;
  file_mime?: string | null;
}

export interface ShareCreateInput {
  name: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  items?: ShareItemInput[];
  /** Slugs only, max 5. */
  tags?: string[];
}

export interface ShareUpdateInput {
  name?: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  /** null/undefined = leave items alone, [] = clear them. */
  items?: ShareItemInput[];
  /** Replaces the share's tag set atomically (slugs only, max 5). */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// PDF upload (PR-C §1)
// ---------------------------------------------------------------------------

/**
 * Returned by `POST /shares/{share_id}/items/upload-url`. The client sends
 * an HTTP PUT to `upload_url` with the raw file bytes as the body and
 * `Content-Type: <required_content_type>` as a header. R2 responds 200 on
 * success. The client then calls `record-pdf-upload` with `file_key` to
 * materialise the ShareItem.
 *
 * Switched from presigned POST to PUT after R2 returned 501 in prod.
 * `fields` is retained as an empty Record for transitional callers.
 */
export interface PresignResponse {
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
  required_content_type: string;
  expires_at: string;
}

/**
 * Returned by `POST /shares/{share_id}/items/record-pdf-upload`. Mirrors
 * `ShareItem` plus the four PDF-specific fields, all populated.
 */
export interface ShareItemOut extends ShareItem {
  kind: ShareItemKind;
  file_url: string | null;
  thumbnail_url: string | null;
  file_size_bytes: number | null;
  file_mime: string | null;
}

// ---------------------------------------------------------------------------
// Public search
// ---------------------------------------------------------------------------

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
