import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { AdminShareDetail } from '@/types/admin';

import { ShareActions } from './share-actions';
import { ShareDetailTabs } from './share-detail-tabs';
import { ViewTimeline } from './view-timeline';

export const metadata = { title: 'Admin — Share' };
export const dynamic = 'force-dynamic';

/**
 * Stage 3 detail page. Server-fetches the full detail payload — items,
 * 90d view timeline, reports, similar-snapshot, audit log — and renders
 * the right-rail action surface from the result.
 */
export default async function AdminShareDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: AdminShareDetail;
  try {
    detail = await serverFetch<AdminShareDetail>(`/admin/shares/${id}`, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) {
      notFound();
    }
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect(`/sign-in?return_to=/dashboard/admin/shares/${id}`);
    }
    throw err;
  }

  const openReports = detail.reports.filter((r) => r.status === 'open');

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard/admin/shares"
          className="text-xs text-ink-muted hover:text-ink"
          aria-label="Back to all shares"
        >
          ← All shares
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-ink-muted">
              /c/{detail.short_code}
            </p>
            <StatusPill detail={detail} />
          </div>
          <h1 className="mt-2 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            {detail.name}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Owned by{' '}
            <Link
              href={`/dashboard/admin/users/${detail.owner_user_id}`}
              className="text-ink hover:underline"
            >
              {detail.owner_name || detail.owner_email || 'unknown'}
            </Link>
            {detail.description ? ` · ${detail.description}` : ''}
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <section
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Key share metrics"
          >
            <FactCard label="Items">{detail.item_count}</FactCard>
            <FactCard label="Views (30d)">
              {detail.view_count_30d.toLocaleString()}
            </FactCard>
            <FactCard label="Views (total)">
              {detail.view_count_total.toLocaleString()}
            </FactCard>
            <FactCard label="Created">
              {formatRelativeTime(detail.created_at)}
            </FactCard>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-medium text-ink">
              View timeline (90 days)
            </h2>
            <div className="mt-3 rounded-md border border-rule bg-paper p-4">
              <div className="h-40">
                <ViewTimeline
                  data={detail.daily_views_90d}
                  label={`Daily views for ${detail.name} over the last 90 days`}
                />
              </div>
            </div>
          </section>

          {openReports.length > 0 ? (
            <section
              className="mt-8 rounded-md border border-danger/40 bg-danger/5 p-4"
              aria-label="Open reports"
            >
              <h2 className="text-sm font-medium text-danger">
                {openReports.length} open report
                {openReports.length === 1 ? '' : 's'}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {openReports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-sm bg-paper p-2"
                  >
                    <span className="text-ink">
                      <span className="font-medium">{r.reason}</span>
                      {r.details ? (
                        <span className="ml-2 text-ink-muted">
                          {r.details}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {formatRelativeTime(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-muted">
                Resolve from the{' '}
                <Link
                  href="/dashboard/admin/reports"
                  className="text-ink hover:underline"
                >
                  reports queue
                </Link>
                .
              </p>
            </section>
          ) : null}

          <section className="mt-8">
            <ShareDetailTabs detail={detail} />
          </section>
        </div>

        {/* Right rail: actions */}
        <aside className="lg:sticky lg:top-6">
          <ShareActions detail={detail} />
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ detail }: { detail: AdminShareDetail }) {
  if (detail.deleted_at) {
    return (
      <span className="rounded-sm bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
        Tombstoned
      </span>
    );
  }
  if (detail.published_at) {
    return (
      <span className="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
        Published
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-paper-soft px-2 py-0.5 text-xs font-medium text-ink-muted">
      Draft
    </span>
  );
}

function FactCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{children}</p>
    </div>
  );
}
