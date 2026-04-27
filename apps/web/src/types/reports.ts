/**
 * Shapes for report endpoints.
 * POST /shares/{short_code}/report — user-submitted reports
 * GET /admin/reports — admin queue
 * POST /admin/reports/{id}/action — close a report
 */

export type ShareReportReason = 'copyright' | 'spam' | 'abuse' | 'pii' | 'other';
export type ShareReportStatus = 'open' | 'actioned' | 'dismissed';

export interface ReportSubmit {
  reason: ShareReportReason;
  details?: string | null;
}

export interface ReportSubmitResponse {
  id: string;
  status: string;
}

export interface ReportOut {
  id: string;
  share_id: string;
  share_short_code: string;
  share_name: string;
  share_deleted_at: string | null;
  reporter_user_id: string | null;
  reason: ShareReportReason;
  details: string | null;
  status: ShareReportStatus;
  created_at: string;
  actioned_at: string | null;
  actioned_by: string | null;
}

export interface ReportAction {
  decision: 'actioned' | 'dismissed';
  tombstone_share?: boolean;
}
