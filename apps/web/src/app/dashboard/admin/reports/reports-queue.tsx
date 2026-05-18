'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { clientApi } from '@/lib/client-api';
import { formatRelativeTime } from '@/lib/format';
import type { ReportAction, ReportOut } from '@/types/reports';

const REASON_LABELS: Record<string, string> = {
  copyright: 'Copyright',
  spam: 'Spam',
  abuse: 'Abuse',
  pii: 'Personal info',
  other: 'Other',
};

export function ReportsQueue({
  initialReports,
}: {
  initialReports: ReportOut[];
}) {
  const queryClient = useQueryClient();

  const { data: reports } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => clientApi<ReportOut[]>('/admin/reports'),
    initialData: initialReports,
  });

  const actionReport = useMutation({
    mutationFn: ({
      reportId,
      body,
    }: {
      reportId: string;
      body: ReportAction;
    }) =>
      clientApi<ReportOut>(`/admin/reports/${reportId}/action`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
    },
  });

  if (reports.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-muted">
        No open reports. All clear.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {reports.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          onAction={(body) =>
            actionReport.mutate({ reportId: report.id, body })
          }
          isPending={actionReport.isPending}
        />
      ))}
    </div>
  );
}

function ReportCard({
  report,
  onAction,
  isPending,
}: {
  report: ReportOut;
  onAction: (body: ReportAction) => void;
  isPending: boolean;
}) {
  const isClosed = report.status !== 'open';

  return (
    <article className="border-t border-rule py-5 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {REASON_LABELS[report.reason] ?? report.reason}
            </span>
            <span
              className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${
                report.status === 'open'
                  ? 'bg-danger/10 text-danger'
                  : 'bg-paper-soft text-ink-muted'
              }`}
            >
              {report.status}
            </span>
          </div>
          <p className="mt-2 font-serif text-lg leading-snug text-ink">
            <a
              href={`/dashboard/admin/shares/${report.share_id}`}
              className="underline decoration-rule decoration-1 underline-offset-4 transition hover:decoration-ink"
            >
              {report.share_name}
            </a>
          </p>
          {report.details ? (
            <p className="mt-1 text-sm text-ink-muted">{report.details}</p>
          ) : null}
          <p className="mt-1 text-xs text-ink-faint">
            Reported {formatRelativeTime(report.created_at)}
            {report.share_deleted_at ? ' · share already tombstoned' : ''} ·{' '}
            <a
              href={`/c/${report.share_short_code}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink-muted hover:underline"
            >
              public viewer
            </a>
          </p>
        </div>

        {!isClosed ? (
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={() => onAction({ decision: 'dismissed' })}
              disabled={isPending}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              onClick={() =>
                onAction({ decision: 'actioned', tombstone_share: true })
              }
              disabled={isPending}
              className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
            >
              Tombstone
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
