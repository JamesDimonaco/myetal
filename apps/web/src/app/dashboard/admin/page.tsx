import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { AdminOverviewResponse } from '@/types/admin';

import { GrowthCharts } from './overview-charts';

export const metadata = { title: 'Admin — Overview' };
export const dynamic = 'force-dynamic';

/**
 * Stage 1 of the admin dashboard.
 *
 * Server-fetches the full overview payload in one shot (see
 * `GET /admin/overview` — backend caches for 60s, so refreshes are
 * cheap). The page is intentionally read-only; mutations live on the
 * users + shares detail pages in Stage 2 / 3.
 */
export default async function AdminOverviewPage() {
  let overview: AdminOverviewResponse;
  try {
    overview = await serverFetch<AdminOverviewResponse>('/admin/overview', {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin');
    }
    throw err;
  }

  const { counters, growth, top_lists, recent, storage, generated_at } =
    overview;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Platform overview
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            How is MyEtAl doing right now. Refresh the page to recompute.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          Generated {formatRelativeTime(generated_at)}
        </p>
      </header>

      {/* ---- Headline counters --------------------------------------------- */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Counter
          label="Users"
          value={counters.total_users}
          hint={`+${counters.new_users_7d} this week · +${counters.new_users_30d} this month`}
        />
        <Counter
          label="Published shares"
          value={counters.total_published_shares}
          hint={`${counters.total_draft_shares} draft${
            counters.total_draft_shares === 1 ? '' : 's'
          }`}
        />
        <Counter
          label="Items across shares"
          value={counters.total_items}
        />
        <Counter
          label="Views"
          value={counters.views_7d}
          hint={`${counters.views_30d.toLocaleString()} over 30d`}
        />
      </section>

      {/* ---- Growth charts ------------------------------------------------- */}
      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Daily signups (30d)">
          <GrowthCharts
            data={growth.daily_signups_30d}
            fill="var(--color-accent)"
            label="Daily signups over the last 30 days"
          />
        </ChartCard>
        <ChartCard title="Daily share creates (30d)">
          <GrowthCharts
            data={growth.daily_share_creates_30d}
            fill="var(--color-ink-muted)"
            label="Daily share creates over the last 30 days"
          />
        </ChartCard>
      </section>

      {/* ---- Top lists ----------------------------------------------------- */}
      <section className="mt-12 grid gap-6 lg:grid-cols-3">
        <TopList
          title="Most active owners"
          subtitle="By published-share count"
          empty="No owners yet"
          items={top_lists.owners_by_shares.map((o) => ({
            id: o.user_id,
            primary: o.name || o.email || 'unknown',
            secondary: o.email,
            value: o.share_count,
            href: `/dashboard/admin/users/${o.user_id}`,
          }))}
        />
        <TopList
          title="Most-viewed shares"
          subtitle="Last 30 days"
          empty="No views yet"
          items={top_lists.shares_by_views_30d.map((s) => ({
            id: s.share_id,
            primary: s.name,
            secondary: s.short_code,
            value: s.view_count_30d,
            // Stage 3 adds a real admin share-detail page; route there
            // instead of /c/ so the click lands on a moderation surface
            // rather than the public viewer.
            href: `/dashboard/admin/shares/${s.share_id}`,
          }))}
        />
        <TopList
          title="Most-used tags"
          empty="No tags yet"
          items={top_lists.tags_by_usage.map((t) => ({
            id: t.slug,
            primary: t.label,
            secondary: t.slug,
            value: t.usage_count,
            href: `/browse?tag=${encodeURIComponent(t.slug)}`,
            external: true,
          }))}
        />
      </section>

      {/* ---- Recent activity ---------------------------------------------- */}
      <section className="mt-12 grid gap-6 lg:grid-cols-3">
        <RecentList title="Recent signups">
          {recent.signups.length === 0 ? (
            <p className="text-sm text-ink-faint">No signups yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.signups.map((s) => (
                <li
                  key={s.user_id}
                  className="flex items-center justify-between gap-2"
                >
                  <Link
                    href={`/dashboard/admin/users/${s.user_id}`}
                    className="min-w-0 flex-1 truncate text-ink hover:underline"
                  >
                    {s.name || s.email || 'unknown'}
                  </Link>
                  <span className="text-xs text-ink-faint">
                    {formatRelativeTime(s.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RecentList>

        <RecentList title="Recent feedback">
          {recent.feedback.length === 0 ? (
            <p className="text-sm text-ink-faint">No feedback yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {recent.feedback.map((f) => (
                <li key={f.id} className="border-l-2 border-rule pl-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{f.title}</span>
                    <span className="text-xs text-ink-faint">
                      {formatRelativeTime(f.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-muted">
                    {f.description_preview}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </RecentList>

        <RecentList title="Recent reports">
          {recent.reports.length === 0 ? (
            <p className="text-sm text-ink-faint">No reports yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.reports.map((r) => (
                <li
                  key={r.report_id}
                  className="flex items-center justify-between gap-2"
                >
                  <Link
                    href="/dashboard/admin/reports"
                    className="min-w-0 flex-1 truncate text-ink hover:underline"
                  >
                    <span className="font-medium">{r.share_name}</span>
                    <span className="ml-2 text-xs text-ink-faint">
                      ({r.reason})
                    </span>
                  </Link>
                  <span className="text-xs text-ink-faint">
                    {formatRelativeTime(r.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RecentList>
      </section>

      {/* ---- Storage + health snapshot ------------------------------------ */}
      <section className="mt-12">
        <h2 className="font-serif text-xl text-ink">Storage and health</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Counter
            label="PDFs on R2"
            value={storage.r2_pdf_count}
            hint={formatBytes(storage.r2_pdf_bytes)}
          />
          <SnapshotLine
            label="Trending refresh"
            value={
              storage.trending_last_run_at
                ? formatRelativeTime(storage.trending_last_run_at)
                : 'never'
            }
          />
          <SnapshotLine
            label="Similar refresh"
            value={
              storage.similar_last_run_at
                ? formatRelativeTime(storage.similar_last_run_at)
                : 'never'
            }
          />
          <SnapshotLine
            label="ORCID sync last run"
            value={
              storage.orcid_sync_last_run_at
                ? formatRelativeTime(storage.orcid_sync_last_run_at)
                : 'never'
            }
          />
        </div>
        <div className="mt-6 rounded-md border border-rule">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Top Postgres tables by on-disk size.
            </caption>
            <thead>
              <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-4 py-2 font-medium">Top Postgres tables</th>
                <th className="px-4 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {storage.table_sizes.map((t) => (
                <tr
                  key={t.table}
                  className="border-b border-rule last:border-b-0"
                >
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                    {t.table}
                  </td>
                  <td className="px-4 py-2 text-right text-ink">
                    {t.bytes === null ? '—' : formatBytes(t.bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---- Sub-components --------------------------------------------------------

function Counter({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-3xl text-ink">
        {value.toLocaleString()}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function SnapshotLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3 h-48">{children}</div>
    </div>
  );
}

type TopItem = {
  id: string;
  primary: string;
  secondary: string | null;
  value: number;
  href?: string;
  external?: boolean;
};

function TopList({
  title,
  subtitle,
  empty,
  items,
}: {
  title: string;
  subtitle?: string;
  empty: string;
  items: TopItem[];
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {subtitle ? (
        <p className="text-xs text-ink-faint">{subtitle}</p>
      ) : null}
      <div className="mt-3">
        {items.length === 0 ? (
          <p className="text-sm text-ink-faint">{empty}</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {items.map((item, idx) => {
              const content = (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="w-5 shrink-0 text-xs text-ink-faint">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-ink">{item.primary}</div>
                      {item.secondary ? (
                        <div className="truncate text-xs text-ink-faint">
                          {item.secondary}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {item.value.toLocaleString()}
                  </span>
                </div>
              );
              if (!item.href) {
                return <li key={item.id}>{content}</li>;
              }
              if (item.external) {
                return (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block rounded-sm hover:bg-paper-soft"
                    >
                      {content}
                    </a>
                  </li>
                );
              }
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="block rounded-sm hover:bg-paper-soft"
                  >
                    {content}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function RecentList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3 max-h-72 overflow-y-auto">{children}</div>
    </div>
  );
}

// ---- Formatting ------------------------------------------------------------

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const value = n / 1024 ** exp;
  const formatted =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${formatted} ${units[exp]}`;
}
