'use client';

import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import type { ReportSubmitResponse, ShareReportReason } from '@/types/reports';

const REASONS: { value: ShareReportReason; label: string }[] = [
  { value: 'copyright', label: 'Copyright violation' },
  { value: 'spam', label: 'Spam' },
  { value: 'abuse', label: 'Abusive content' },
  { value: 'pii', label: 'Exposes personal info' },
  { value: 'other', label: 'Other' },
];

export function ReportButton({ shortCode }: { shortCode: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ShareReportReason>('other');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await clientApi<ReportSubmitResponse>(
        `/shares/${encodeURIComponent(shortCode)}/report`,
        { method: 'POST', json: { reason, details: details.trim() || null } },
      );
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-xs text-ink-muted">
        Report submitted. Thank you for helping keep MyEtAl safe.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
      >
        Report this share
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium text-ink">Report this share</p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as ShareReportReason)}
        className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
      >
        {REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Optional details (max 2000 chars)"
        maxLength={2000}
        rows={3}
        className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Sending...' : 'Submit report'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
