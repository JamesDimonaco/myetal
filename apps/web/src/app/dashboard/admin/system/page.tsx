import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type {
  AdminSystemAuthProvider,
  AdminSystemMetricsResponse,
  AdminSystemR2Prefix,
  AdminSystemRouteMetric,
  AdminSystemScriptRun,
} from '@/types/admin';

export const metadata = { title: 'Admin — System' };
export const dynamic = 'force-dynamic';

/**
 * Stage 4 — operational/observability surface.
 *
 * One server fetch retrieves every section (routes 24h, scripts, db
 * pool, R2 storage, auth health) — backend caches for 30 s so refreshes
 * are cheap. The page is read-only and intentionally lean: this is
 * "is the patient breathing", not a real observability stack.
 */
export default async function AdminSystemPage() {
  let metrics: AdminSystemMetricsResponse;
  try {
    metrics = await serverFetch<AdminSystemMetricsResponse>(
      '/admin/system/metrics',
      { cache: 'no-store' },
    );
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin/system');
    }
    throw err;
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            System health
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Request rate, cron status, DB pool, R2 storage, auth health.
            Refresh the page to recompute (30s cache).
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          Generated {formatRelativeTime(metrics.generated_at)}
        </p>
      </header>

      {/* Request rate */}
      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink">
          Request rate (last 24h)
        </h2>
        <p className="mt-1 text-xs text-ink-faint">
          Grouped by route prefix. Errors are 5xx only — 4xx is excluded
          because client error noise drowns the signal.
        </p>
        <RoutesTable routes={metrics.routes_24h} />
      </section>

      {/* Background jobs */}
      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink">Background jobs</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Last-run summary for each cron. Schedules live in the deploy
          crontab; this is observation, not configuration.
        </p>
        <ScriptsTable scripts={metrics.scripts} />
      </section>

      {/* DB pool + R2 */}
      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-serif text-xl text-ink">DB connection pool</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SnapshotCard
              label="In use"
              value={metrics.db_pool.in_use.toString()}
            />
            <SnapshotCard
              label="Pool size"
              value={metrics.db_pool.size.toString()}
            />
            <SnapshotCard
              label="Overflow"
              value={metrics.db_pool.overflow.toString()}
            />
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Slow-query count (&gt;1s, last hour):{' '}
            {metrics.db_pool.slow_query_count_1h === null
              ? 'not yet instrumented'
              : metrics.db_pool.slow_query_count_1h.toLocaleString()}
          </p>
        </div>

        <div>
          <h2 className="font-serif text-xl text-ink">R2 storage</h2>
          <p className="mt-1 text-xs text-ink-faint">
            LIST cached for 5 minutes (cost-sensitive). Last fetch{' '}
            {formatRelativeTime(metrics.r2.fetched_at)}.
            {metrics.r2.cached ? ' (cached)' : ' (fresh)'}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SnapshotCard
              label="Total objects"
              value={metrics.r2.total_objects.toLocaleString()}
            />
            <SnapshotCard
              label="Total bytes"
              value={formatBytes(metrics.r2.total_bytes)}
            />
          </div>
          <R2PrefixTable prefixes={metrics.r2.by_prefix} />
        </div>
      </section>

      {/* Auth health */}
      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink">Auth health</h2>
        {metrics.auth.placeholder ? (
          <div
            className="mt-3 rounded-md border border-rule bg-paper-soft p-4 text-sm text-ink-muted"
            role="status"
          >
            <p className="font-medium text-ink">
              Approximated — wire BA event hook before this surface lights
              up.
            </p>
            {metrics.auth.note ? (
              <p className="mt-1 text-xs">{metrics.auth.note}</p>
            ) : null}
          </div>
        ) : null}
        <AuthHealthTable providers={metrics.auth.providers} />
      </section>
    </div>
  );
}

// ---- Sub-components --------------------------------------------------------

function SnapshotCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{value}</p>
    </div>
  );
}

function RoutesTable({ routes }: { routes: AdminSystemRouteMetric[] }) {
  if (routes.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-rule bg-paper p-4 text-sm text-ink-faint">
        No request_metrics rows yet. Once the middleware has been running
        for a minute, traffic will start appearing here.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-rule">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Request and error rate over the last 24 hours, grouped by route
          prefix.
        </caption>
        <thead>
          <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="px-4 py-2 font-medium">Route prefix</th>
            <th className="px-4 py-2 text-right font-medium">Requests</th>
            <th className="px-4 py-2 text-right font-medium">5xx errors</th>
            <th className="px-4 py-2 text-right font-medium">Error rate</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr
              key={r.route_prefix}
              className="border-b border-rule last:border-b-0"
            >
              <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                {r.route_prefix}
              </td>
              <td className="px-4 py-2 text-right text-ink">
                {r.request_count.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right text-ink">
                {r.error_count.toLocaleString()}
              </td>
              <td
                className={`px-4 py-2 text-right ${
                  r.p_error > 0.05 ? 'text-danger' : 'text-ink-muted'
                }`}
              >
                {(r.p_error * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScriptsTable({ scripts }: { scripts: AdminSystemScriptRun[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-rule">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Background-job status: last run timestamp, duration, row count,
          schedule.
        </caption>
        <thead>
          <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="px-4 py-2 font-medium">Script</th>
            <th className="px-4 py-2 font-medium">Last run</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Duration</th>
            <th className="px-4 py-2 text-right font-medium">Rows</th>
            <th className="px-4 py-2 font-medium">Next</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map((s) => (
            <tr key={s.name} className="border-b border-rule last:border-b-0">
              <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                {s.name}
              </td>
              <td className="px-4 py-2 text-xs text-ink-muted">
                {s.last_run_at ? formatRelativeTime(s.last_run_at) : 'never'}
              </td>
              <td className="px-4 py-2">
                <StatusPill status={s.last_status} />
              </td>
              <td className="px-4 py-2 text-right text-xs text-ink-muted">
                {s.duration_ms === null
                  ? '—'
                  : `${s.duration_ms.toLocaleString()} ms`}
              </td>
              <td className="px-4 py-2 text-right text-xs text-ink-muted">
                {s.row_count === null ? '—' : s.row_count.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-xs text-ink-muted">
                {s.next_run_schedule}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (status === null) {
    return (
      <span className="rounded-sm bg-paper-soft px-2 py-0.5 text-xs font-medium text-ink-muted">
        no runs
      </span>
    );
  }
  const map: Record<string, string> = {
    ok: 'bg-accent-soft text-accent',
    failed: 'bg-danger/10 text-danger',
    running: 'bg-paper-soft text-ink-muted',
  };
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
        map[status] || 'bg-paper-soft text-ink-muted'
      }`}
    >
      {status}
    </span>
  );
}

function R2PrefixTable({ prefixes }: { prefixes: AdminSystemR2Prefix[] }) {
  if (prefixes.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-rule">
      <table className="w-full text-sm">
        <caption className="sr-only">R2 storage breakdown by prefix.</caption>
        <thead>
          <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="px-4 py-2 font-medium">Prefix</th>
            <th className="px-4 py-2 text-right font-medium">Objects</th>
            <th className="px-4 py-2 text-right font-medium">Bytes</th>
          </tr>
        </thead>
        <tbody>
          {prefixes.map((p) => (
            <tr
              key={p.prefix}
              className="border-b border-rule last:border-b-0"
            >
              <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                {p.prefix}
              </td>
              <td className="px-4 py-2 text-right text-ink">
                {p.object_count.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right text-ink">
                {formatBytes(p.bytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthHealthTable({
  providers,
}: {
  providers: AdminSystemAuthProvider[];
}) {
  if (providers.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-rule bg-paper p-4 text-sm text-ink-faint">
        No sign-in activity in the last 24h.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-rule">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Sign-in attempts versus completions per provider over the last 24
          hours.
        </caption>
        <thead>
          <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
            <th className="px-4 py-2 font-medium">Provider</th>
            <th className="px-4 py-2 text-right font-medium">Attempts</th>
            <th className="px-4 py-2 text-right font-medium">Completions</th>
            <th className="px-4 py-2 text-right font-medium">Success</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const rate =
              p.attempts_24h > 0
                ? (p.completions_24h / p.attempts_24h) * 100
                : 0;
            return (
              <tr
                key={p.provider}
                className="border-b border-rule last:border-b-0"
              >
                <td className="px-4 py-2 text-ink">{p.provider}</td>
                <td className="px-4 py-2 text-right text-ink">
                  {p.attempts_24h.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right text-ink">
                  {p.completions_24h.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right text-ink-muted">
                  {rate.toFixed(0)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    value >= 100
      ? value.toFixed(0)
      : value >= 10
        ? value.toFixed(1)
        : value.toFixed(2);
  return `${formatted} ${units[exp]}`;
}
