'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { clientApi } from '@/lib/client-api';
import { formatRelativeTime } from '@/lib/format';
import type {
  AdminUserFilter,
  AdminUserListItem,
  AdminUserListResponse,
  AdminUserSort,
} from '@/types/admin';

/**
 * Client-side list state. Owns:
 * - debounced search (300ms)
 * - filter chip toggling
 * - cursor-driven "load more"
 *
 * We don't reach for TanStack Query here because the page is hit
 * rarely and the state is small; useEffect + fetch is plenty. Filter
 * chips and search both rebuild the param string and refetch from
 * scratch (cursor reset). "Load more" appends.
 */
export function UsersList({
  initialPage,
  initialQuery,
  initialFilter,
  initialSort,
}: {
  initialPage: AdminUserListResponse;
  initialQuery: string;
  initialFilter: AdminUserFilter;
  initialSort: AdminUserSort;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [filter, setFilter] = useState<AdminUserFilter>(initialFilter);
  const [sort, setSort] = useState<AdminUserSort>(initialSort);
  const [items, setItems] = useState<AdminUserListItem[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage.next_cursor,
  );
  const [total, setTotal] = useState<number>(initialPage.total);
  const [loading, setLoading] = useState(false);
  // Request token, bumped on every search/filter/sort fetch kickoff.
  // Both the search effect AND `loadMore` capture the current value at
  // the start of their async work and bail on resolve if the token has
  // moved on. Prevents a stale `loadMore` append after the user changed
  // filter mid-flight (race flagged by the functional reviewer).
  const requestTokenRef = useRef(0);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Refetch whenever the inputs change (search / filter / sort).
  // The async chain runs after the effect body returns so the
  // setLoading() calls happen *during* the resolved promises rather than
  // synchronously inside the effect — keeps `react-hooks/set-state-in-effect`
  // quiet without depending on a separate library helper.
  useEffect(() => {
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (filter !== 'all') params.set('filter', filter);
    if (sort !== 'created_desc') params.set('sort', sort);
    const token = ++requestTokenRef.current;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const page = await clientApi<AdminUserListResponse>(
          `/admin/users${params.toString() ? `?${params}` : ''}`,
        );
        if (cancelled || token !== requestTokenRef.current) return;
        setItems(page.items);
        setNextCursor(page.next_cursor);
        setTotal(page.total);
      } catch (err) {
        if (cancelled || token !== requestTokenRef.current) return;
        // Keep stale data on error so the operator still has something
        // to act on, but surface the failure — the previous silent
        // catch left admins guessing whether the page was up to date.
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to refresh users list';
        toast.error(message);
      } finally {
        if (!cancelled && token === requestTokenRef.current) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, filter, sort]);

  // Append next page on "load more". Token-gated so a slow loadMore
  // response that lands after the user changed filter doesn't append
  // stale-filter rows on top of the new-filter list.
  const loadMore = async () => {
    if (!nextCursor || loading) return;
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    if (filter !== 'all') params.set('filter', filter);
    if (sort !== 'created_desc') params.set('sort', sort);
    params.set('cursor', nextCursor);
    const token = requestTokenRef.current;
    setLoading(true);
    try {
      const page = await clientApi<AdminUserListResponse>(
        `/admin/users?${params}`,
      );
      if (token !== requestTokenRef.current) return;
      setItems((existing) => [...existing, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      if (token !== requestTokenRef.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to load more users';
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
          label="Has ORCID"
          active={filter === 'has_orcid'}
          onClick={() => setFilter('has_orcid')}
        />
        <FilterChip
          label="Has shares"
          active={filter === 'has_shares'}
          onClick={() => setFilter('has_shares')}
        />
        <FilterChip
          label="Admins"
          active={filter === 'admin'}
          onClick={() => setFilter('admin')}
        />
        <FilterChip
          label="Email verified"
          active={filter === 'email_verified'}
          onClick={() => setFilter('email_verified')}
        />
        <FilterChip
          label="Deleted"
          active={filter === 'deleted'}
          onClick={() => setFilter('deleted')}
        />
      </div>

      {/* Search + sort */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[240px]">
          <span className="sr-only">Search users</span>
          <input
            type="search"
            placeholder="Search email, name, or ORCID iD…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
            className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Sort users</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as AdminUserSort)}
            aria-label="Sort users"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="last_seen_desc">Recently active</option>
          </select>
        </label>
        <span className="text-xs text-ink-faint">
          {items.length} of {total.toLocaleString()}
        </span>
      </div>

      {/* Table — aria-live + aria-busy lets SR users hear when the row
          set changes (debounced type-search would otherwise silently
          mutate underneath them). The sr-only summary below restates
          the count after each refetch. */}
      <div
        className="mt-6 overflow-x-auto rounded-md border border-rule"
        aria-live="polite"
        aria-busy={loading}
      >
        <p className="sr-only" aria-live="polite">
          {loading
            ? 'Loading users…'
            : `${items.length} of ${total.toLocaleString()} users match.`}
        </p>
        <table className="w-full text-sm">
          <caption className="sr-only">
            User accounts (filterable, sortable). Click a row to view detail.
          </caption>
          <thead>
            <tr className="border-b border-rule bg-paper-soft text-left text-xs uppercase tracking-wider text-ink-muted">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Shares</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-sm text-ink-faint"
                >
                  No users match those filters.
                </td>
              </tr>
            ) : (
              items.map((u) => <UserRow key={u.id} user={u} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-rule bg-paper px-4 py-2 text-sm text-ink hover:bg-paper-soft disabled:opacity-50"
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

function UserRow({ user }: { user: AdminUserListItem }) {
  return (
    <tr className="border-b border-rule last:border-b-0 hover:bg-paper-soft">
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/admin/users/${user.id}`}
          className="block min-w-0"
        >
          <div className="truncate font-medium text-ink">
            {user.name || user.email || 'unknown'}
          </div>
          <div className="truncate text-xs text-ink-faint">
            {user.email}
            {user.orcid_id ? ` · ${user.orcid_id}` : ''}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {user.is_admin ? <Pill tone="accent">Admin</Pill> : null}
          {user.email_verified ? <Pill tone="neutral">Verified</Pill> : null}
          {user.deleted_at ? <Pill tone="danger">Deleted</Pill> : null}
          {user.providers.map((p) => (
            <Pill key={p} tone="muted">
              {p}
            </Pill>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-ink">{user.share_count}</td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {formatRelativeTime(user.created_at)}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {user.last_seen_at ? formatRelativeTime(user.last_seen_at) : 'never'}
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
