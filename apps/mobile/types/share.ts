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

export interface PublicShareResponse {
  short_code: string;
  name: string;
  description: string | null;
  type: ShareType;
  items: ShareItem[];
  owner_name: string | null;
  updated_at: string;
}

/** Owner-facing share — returned by /shares CRUD (authed). */
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
  is_public: boolean;
  items: ShareItemInput[];
}

export interface ShareUpdateInput {
  name?: string;
  description?: string | null;
  type?: ShareType;
  is_public?: boolean;
  items?: ShareItemInput[];
}
