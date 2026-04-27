import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';

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

interface ShareResponse {
  id: string;
  short_code: string;
  name: string;
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
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          /c/{share.short_code}
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          Analytics
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{share.name}</p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total views" value={analytics.total_views} />
        <StatCard label="Last 7 days" value={analytics.views_last_7d} />
        <StatCard label="Last 30 days" value={analytics.views_last_30d} />
      </div>

      {/* Daily views bar chart */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
          Daily views (last 30 days)
        </h2>

        {analytics.daily_views.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No views recorded yet.</p>
        ) : (
          <div className="mt-4 flex items-end gap-[3px]" style={{ height: 160 }}>
            {analytics.daily_views.map((d) => {
              const heightPct = (d.count / maxCount) * 100;
              return (
                <div
                  key={d.date}
                  className="group relative flex-1"
                  style={{ height: '100%' }}
                >
                  <div
                    className="absolute bottom-0 w-full rounded-sm bg-ink/80 transition-colors group-hover:bg-accent"
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-rule bg-paper px-2 py-1 text-xs text-ink shadow group-hover:block">
                    {d.date}: {d.count} view{d.count !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Navigation */}
      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-rule pt-6">
        <Link
          href={`/dashboard/share/${id}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Edit share
        </Link>
        <Link
          href="/dashboard"
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-rule bg-paper-soft p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
        {label}
      </p>
      <p className="mt-1 font-serif text-3xl tracking-tight text-ink">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
