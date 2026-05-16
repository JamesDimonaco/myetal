'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { clientApi } from '@/lib/client-api';
import { formatRelativeTime } from '@/lib/format';
import type {
  AdminShareFilter,
  AdminShareListItem,
  AdminShareListResponse,
  AdminShareSort,
} from '@/types/admin';

/**
 * Client-side state for the admin shares list.
 *
 * Mirrors the Stage 2 users-list shape: debounced search, filter chips,
 * cursor-driven "load more", token-gated refetches so a stale loadMore
 * response can't append after the user changed filter mid-flight.
 *
 * a11y: aria-live on the table wrapper + sr-only "X of Y" summary so a
 * screen-reader user hears row-set changes; filter chips use
 * aria-pressed; search input is type="search" with a real label.
 */
export function SharesList({
  initialPage,
  initialQuery,
  initialFilter,
  initialType,
  initialAge,
  initialSort,
}: {
  initialPage: AdminShareListResponse;
  initialQuery: string;
  initialFilter: AdminShareFilter;
  initialType: string;
  initialAge: string;
  initialSort: AdminShareSort;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [filter, setFilter] = useState<AdminShareFilter>(initialFilter);
  const [type, setType] = useState<string>(initialType);
  const [age, setAge] = useState<string>(initialAge);
  const [sort, setSort] = useState<AdminShareSort>(initialSort);
  const [items, setItems] = useState<AdminShareListItem[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage.next_cursor,
  );
  const [total, setTotal] = useState<number>(initialPage.total);
  const [loading, setLoading] = useState(false);
  const requestTokenRef = useRef(0);

  // Search debounce — 300ms is the established admin value (matches
  // Stage 2 users list).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const buildParams = (extra?: Record<string, string>): URLSearchParams => {
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (filter !== 'all') params.set('filter', filter);
    if (type) params.set('type', type);
    if (age !== 'all') params.set('age', age);
    if (sort !== 'created_desc') params.set('sort', sort);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    return params;
  };

  useEffect(() => {
    const params = buildParams();
    const token = ++requestTokenRef.current;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await clientApi<AdminShareListResponse>(
          `/admin/shares${params.toString() ? `?${params}` : ''}`,
        );
        if (cancelled || token !== requestTokenRef.current) return;
        setItems(page.items);
        setNextCursor(page.next_cursor);
        setTotal(page.total);
      } catch (err) {
        if (cancelled || token !== requestTokenRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to refresh shares list';
        toast.error(message);
      } finally {
        if (!cancelled && token === requestTokenRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, filter, type, age, sort]);

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    const params = buildParams({ cursor: nextCursor });
    const token = requestTokenRef.current;
    setLoading(true);
    try {
      const page = await clientApi<AdminShareListResponse>(
        `/admin/shares?${params}`,
      );
      if (token !== requestTokenRef.current) return;
      setItems((existing) => [...existing, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      if (token !== requestTokenRef.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to load more shares';
      toast.error(message);
    } finally {
      if (token === requestTokenRef.current) setLoading(false);
    }
  };

  return (
    <div className="mt-8">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="All"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          label="Published"
          active={filter === 'published'}
          onClick={() => setFilter('published')}
        />
        <FilterChip
          label="Draft"
          active={filter === 'draft'}
          onClick={() => setFilter('draft')}
        />
        <FilterChip
          label="Tombstoned"
          active={filter === 'tombstoned'}
          onClick={() => setFilter('tombstoned')}
        />
      </div>

      {/* Secondary filters: type + age + search + sort */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label>
          <span className="sr-only">Filter by type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by share type"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="">All types</option>
            <option value="paper">Paper</option>
            <option value="collection">Collection</option>
            <option value="bundle">Bundle</option>
            <option value="grant">Grant</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by age</span>
          <select
            value={age}
            onChange={(e) => setAge(e.target.value)}
            aria-label="Filter by age bucket"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="all">All ages</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="older">Older than 90 days</option>
          </select>
        </label>
        <label className="relative flex-1 min-w-[240px]">
          <span className="sr-only">Search shares</span>
          <input
            type="search"
            placeholder="Search name, short code, owner email, DOI, or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search shares"
            className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Sort shares</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as AdminShareSort)}
            aria-label="Sort shares"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="views_30d_desc">Most viewed (30d)</option>
          </select>
        </label>
        <span className="text-xs text-ink-faint">
          {items.length} of {total.toLocaleString()}
        </span>
      </div>

      {/* Table — aria-live so screen-reader users hear row updates. */}
      <div
        className="mt-6 overflow-x-auto rounded-md border border-rule"
        aria-live="polite"
        aria-busy={loading}
      >
        <p className="sr-only" aria-live="polite">
          {loading
            ? 'Loading shares…'
            : `${items.length} of ${total.toLocaleString()} shares match.`}
        </p>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Shares (filterable, sortable). Click a row to view detail.
          </caption>
          <thead>
            <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
              <th className="px-4 py-3 font-medium">Share</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Items</th>
              <th className="px-4 py-3 font-medium text-right">Views 30d</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-ink-faint"
                >
                  No shares match those filters.
                </td>
              </tr>
            ) : (
              items.map((s) => <ShareRow key={s.id} share={s} />)
            )}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-rule bg-paper px-4 py-2 text-sm text-ink hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? 'bg-ink text-paper'
          : 'border border-rule bg-paper text-ink-muted hover:border-ink/40 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

function ShareRow({ share }: { share: AdminShareListItem }) {
  return (
    <tr className="border-b border-rule last:border-b-0 hover:bg-paper-soft">
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/admin/shares/${share.id}`}
          className="block min-w-0"
        >
          <div className="truncate font-medium text-ink">{share.name}</div>
          <div className="truncate text-xs text-ink-faint">
            /c/{share.short_code} · {share.type}
            {share.tag_slugs.length > 0
              ? ' · ' +
                share.tag_slugs
                  .slice(0, 3)
                  .map((t) => `#${t}`)
                  .join(' ')
              : ''}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        {share.owner_user_id ? (
          <Link
            href={`/dashboard/admin/users/${share.owner_user_id}`}
            className="block min-w-0 text-ink hover:underline"
          >
            <div className="truncate text-sm">
              {share.owner_name || share.owner_email || 'unknown'}
            </div>
            <div className="truncate text-xs text-ink-faint">
              {share.owner_email}
            </div>
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {share.deleted_at ? (
            <Pill tone="danger">Tombstoned</Pill>
          ) : share.published_at ? (
            <Pill tone="accent">Published</Pill>
          ) : (
            <Pill tone="muted">Draft</Pill>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-ink">{share.item_count}</td>
      <td className="px-4 py-3 text-right text-ink">
        {share.view_count_30d.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {formatRelativeTime(share.created_at)}
      </td>
    </tr>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'accent' | 'neutral' | 'danger' | 'muted';
}) {
  const map: Record<typeof tone, string> = {
    accent: 'bg-accent-soft text-accent',
    neutral: 'bg-paper-soft text-ink',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-paper-soft text-ink-muted',
  };
  return (
    <span
      className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}
