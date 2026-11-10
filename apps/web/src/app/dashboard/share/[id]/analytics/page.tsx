import { notFound, redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { BackLink, PageHeader, SectionHeading } from '@/components/ui/page-header';
import { formatDayMonth } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { ShareResponse } from '@/types/share';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Share analytics' };
export const dynamic = 'force-dynamic';

interface DailyView {
  date: string;
  count: number;
}

interface ShareAnalytics {
  total_views: number;
  views_last_7d: number;
  views_last_30d: number;
  daily_views: DailyView[];
}

type PageProps = { params: Promise<{ id: string }> };

export default async function ShareAnalyticsPage({ params }: PageProps) {
  const { id } = await params;

  let analytics: ShareAnalytics;
  let share: ShareResponse;
  try {
    [analytics, share] = await Promise.all([
      serverFetch<ShareAnalytics>(`/shares/${id}/analytics`, {
        cache: 'no-store',
      }),
      serverFetch<ShareResponse>(`/shares/${id}`, {
        cache: 'no-store',
      }),
    ]);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.isNotFound) notFound();
      if (err.isUnauthorized || err.isForbidden) {
        redirect(`/sign-in?return_to=/dashboard/share/${id}/analytics`);
      }
    }
    throw err;
  }

  const maxCount = Math.max(1, ...analytics.daily_views.map((d) => d.count));

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        back={<BackLink href={`/dashboard/share/${id}`}>Edit share</BackLink>}
        eyebrow={`/c/${share.short_code}`}
        title="Analytics"
        description={share.name}
      />

      {/* Stat cards — stack on phones, 3-up on sm+ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total views" value={analytics.total_views} />
        <StatCard label="Last 7 days" value={analytics.views_last_7d} />
        <StatCard label="Last 30 days" value={analytics.views_last_30d} />
      </div>

      {/* Daily views bar chart */}
      <section className="mt-10">
        <SectionHeading>Daily views, last 30 days</SectionHeading>

        {!analytics.daily_views.some((d) => d.count > 0) ? (
          <EmptyState
            className="mt-4"
            headingLevel="h3"
            title="No views yet"
            description="Views appear here when people open your share's link or scan its QR code."
          />
        ) : (
          <>
            <div
              role="img"
              aria-label={chartSummary(analytics.daily_views)}
              className="mt-4 flex items-end gap-[3px]"
              style={{ height: 160 }}
            >
              {analytics.daily_views.map((d) => {
                const heightPct = (d.count / maxCount) * 100;
                return (
                  <div
                    key={d.date}
                    className="group relative flex-1"
                    style={{ height: '100%' }}
                  >
                    <div
                      className={`absolute bottom-0 w-full rounded-sm transition-colors group-hover:bg-accent ${
                        d.count > 0 ? 'bg-ink/80' : 'bg-rule'
                      }`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-rule bg-paper px-2 py-1 text-xs text-ink shadow group-hover:block">
                      {formatDayMonth(d.date)}: {d.count} view{d.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-muted">
              <span>{formatDayMonth(analytics.daily_views[0].date)}</span>
              <span>Today</span>
            </div>
          </>
        )}
      </section>

    </div>
  );
}

function chartSummary(days: { date: string; count: number }[]): string {
  const busiest = days.reduce((a, b) => (b.count > a.count ? b : a));
  return `Daily views for the last ${days.length} days. Busiest day: ${formatDayMonth(busiest.date)}, ${busiest.count} view${busiest.count === 1 ? '' : 's'}.`;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 font-serif text-3xl tracking-tight text-ink">
        {value.toLocaleString()}
      </p>
    </Card>
  );
}
