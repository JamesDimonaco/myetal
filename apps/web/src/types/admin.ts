/**
 * Admin dashboard API shapes.
 *
 * Mirrors `apps/api/src/myetal_api/schemas/admin.py` field-for-field.
 * snake_case on the wire because FastAPI serialises Python attrs as-is
 * — see `apps/web/AGENTS.md`.
 */

// ---- Stage 1: overview -----------------------------------------------------

export interface AdminOverviewCounters {
  total_users: number;
  new_users_7d: number;
  new_users_30d: number;
  total_published_shares: number;
  total_draft_shares: number;
  total_items: number;
  views_7d: number;
  views_30d: number;
}

export interface AdminDailyBucket {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface AdminOverviewGrowth {
  daily_signups_30d: AdminDailyBucket[];
  daily_share_creates_30d: AdminDailyBucket[];
}

export interface AdminTopOwner {
  user_id: string;
  email: string | null;
  name: string | null;
  share_count: number;
}

export interface AdminTopShare {
  share_id: string;
  short_code: string;
  name: string;
  view_count_30d: number;
}

export interface AdminTopTag {
  slug: string;
  label: string;
  usage_count: number;
}

export interface AdminTopLists {
  owners_by_shares: AdminTopOwner[];
  shares_by_views_30d: AdminTopShare[];
  tags_by_usage: AdminTopTag[];
}

export interface AdminRecentSignup {
  user_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface AdminRecentFeedback {
  id: string;
  user_id: string | null;
  type: string;
  title: string;
  description_preview: string;
  created_at: string;
}

export interface AdminRecentReport {
  report_id: string;
  share_id: string;
  share_short_code: string;
  share_name: string;
  reason: string;
  status: string;
  created_at: string;
}

export interface AdminOverviewRecent {
  signups: AdminRecentSignup[];
  feedback: AdminRecentFeedback[];
  reports: AdminRecentReport[];
}

export interface AdminTableSize {
  table: string;
  bytes: number | null;
}

export interface AdminOverviewStorage {
  r2_pdf_count: number;
  r2_pdf_bytes: number;
  table_sizes: AdminTableSize[];
  trending_last_run_at: string | null;
  similar_last_run_at: string | null;
  orcid_sync_last_run_at: string | null;
}

export interface AdminOverviewResponse {
  counters: AdminOverviewCounters;
  growth: AdminOverviewGrowth;
  top_lists: AdminTopLists;
  recent: AdminOverviewRecent;
  storage: AdminOverviewStorage;
  generated_at: string;
}

// ---- Stage 2: users --------------------------------------------------------

export type AdminUserFilter =
  | 'all'
  | 'has_orcid'
  | 'has_shares'
  | 'admin'
  | 'email_verified'
  | 'deleted';

export type AdminUserSort = 'created_desc' | 'created_asc' | 'last_seen_desc';

export interface AdminUserListItem {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  orcid_id: string | null;
  is_admin: boolean;
  email_verified: boolean;
  created_at: string;
  deleted_at: string | null;
  share_count: number;
  last_seen_at: string | null;
  providers: string[];
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  next_cursor: string | null;
  total: number;
}

export interface AdminActivityEvent {
  kind:
    | 'signup'
    | 'sign_in'
    | 'share_create'
    | 'share_publish'
    | 'feedback_submit'
    | 'report_submit'
    | 'item_add'
    | string;
  at: string;
  detail: string | null;
  link: string | null;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  admin_user_id: string;
  admin_email: string | null;
  target_user_id: string | null;
  target_share_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminUserShareRow {
  id: string;
  short_code: string;
  name: string;
  is_public: boolean;
  published_at: string | null;
  deleted_at: string | null;
  created_at: string;
  item_count: number;
}

export interface AdminUserDetail {
  id: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  avatar_url: string | null;
  orcid_id: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  last_seen_at: string | null;
  last_sign_in_ip: string | null;
  session_count: number;
  providers: string[];
  library_paper_count: number;
  last_orcid_sync_at: string | null;
  shares: AdminUserShareRow[];
  activity: AdminActivityEvent[];
  audit: AdminAuditEntry[];
}

export interface AdminActionResponse {
  ok: boolean;
  audit_id: string;
  message: string;
}
