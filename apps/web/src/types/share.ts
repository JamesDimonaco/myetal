/**
 * Shapes that mirror the backend's Pydantic responses for shares. Hand-written
 * for now to match apps/mobile/types/share.ts; once the OpenAPI codegen
 * pipeline lands these will be generated and live in packages/types.
 */

export type ShareType =
  | 'paper'
  | 'collection'
  | 'poster'
  | 'grant'
  | 'project';

export type ShareItemKind = 'paper' | 'repo' | 'link';

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
}

/** Authed owner view (`GET /shares` and `GET /shares/{id}`). */
export interface ShareResponse {
  id: string;
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  items: ShareItem[];
}

/** Item input shape — matches ShareItemCreate on the backend. `kind` defaults
 *  to `'paper'` server-side for back-compat, so existing single-paper / paper
 *  collection clients keep working unchanged. */
export interface ShareItemInput {
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
}

export interface ShareCreateInput {
  name: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  items?: ShareItemInput[];
}

export interface ShareUpdateInput {
  name?: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  /** null/undefined = leave items alone, [] = clear them. */
  items?: ShareItemInput[];
}
