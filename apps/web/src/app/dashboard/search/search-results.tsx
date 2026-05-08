'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShareCard } from '@/components/share-card';
import { UserCard } from '@/components/user-card';
import { clientApi } from '@/lib/client-api';
import type {
  BrowseResponse,
  ShareSearchResponse,
  ShareSearchResult,
  ShareType,
  UserPublicOut,
} from '@/types/share';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const PAGE_SIZE = 20;

const SORT_OPTIONS = ['relevance', 'newest', 'most_items'] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  newest: 'Newest',
  most_items: 'Most items',
};

const TYPE_FILTERS: ShareType[] = [
  'paper',
  'collection',
  'bundle',
  'grant',
  'project',
];

// ---------------------------------------------------------------------------
// Hook: debounced value
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchResults() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('relevance');
  const [activeTypes, setActiveTypes] = useState<Set<ShareType>>(new Set());
  const [allResults, setAllResults] = useState<ShareSearchResult[]>([]);
  // Snapshot of the People block from the FIRST page response. Subsequent
  // pages don't re-shape the user block (W-FIX-4) — backend re-sends `users`
  // on every page but it's the same set; using the latest page would briefly
  // re-render the block on each "Show more".
  const [usersSnapshot, setUsersSnapshot] = useState<UserPublicOut[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const enabled = debouncedQuery.length >= MIN_QUERY_LENGTH;

  // Fetch browse data (trending + recent) when the search query is empty —
  // E11 surface (PR-B): with `/browse` shipped, we keep the trending/recent
  // cards here as the "what's available" preview, but point users at the
  // dedicated browse page for filtering.
  const { data: browseData } = useQuery({
    queryKey: ['browse'],
    queryFn: () => clientApi<BrowseResponse>('/public/browse'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Reset pagination when query changes
  const prevQueryRef = useRef(debouncedQuery);
  useEffect(() => {
    if (prevQueryRef.current !== debouncedQuery) {
      prevQueryRef.current = debouncedQuery;
      setAllResults([]);
      setUsersSnapshot([]);
      setOffset(0);
      setHasMore(false);
    }
  }, [debouncedQuery]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['share-search', debouncedQuery, offset],
    queryFn: () =>
      clientApi<ShareSearchResponse>(
        `/public/search?q=${encodeURIComponent(debouncedQuery)}&limit=${PAGE_SIZE}&offset=${offset}`,
      ),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Append new results when data arrives
  useEffect(() => {
    if (!data) return;
    setAllResults((prev) => {
      if (offset === 0) return data.results;
      // Dedupe by short_code in case of overlapping fetches
      const existing = new Set(prev.map((r) => r.short_code));
      const fresh = data.results.filter((r) => !existing.has(r.short_code));
      return [...prev, ...fresh];
    });
    // W-FIX-4 — snapshot the users block on the first page only. Backend
    // sends the same `users` payload back on every page; pinning to page-0
    // prevents a flash/clobber as the user paginates shares.
    if (offset === 0) {
      setUsersSnapshot(data.users ?? []);
    }
    setHasMore(data.has_more);
  }, [data, offset]);

  const handleLoadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  const toggleType = useCallback((type: ShareType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Client-side filter + sort
  const displayResults = useMemo(() => {
    let filtered = allResults;
    if (activeTypes.size > 0) {
      filtered = filtered.filter((r) => activeTypes.has(r.type));
    }
    if (sort === 'newest') {
      filtered = [...filtered].sort(
        (a, b) =>
          new Date(b.published_at).getTime() -
          new Date(a.published_at).getTime(),
      );
    } else if (sort === 'most_items') {
      filtered = [...filtered].sort((a, b) => b.item_count - a.item_count);
    }
    return filtered;
  }, [allResults, activeTypes, sort]);

  // Read users from the page-0 snapshot, not the latest fetched page.
  const users = usersSnapshot;
  const showControls = allResults.length > 0;
  const settled = enabled && !isLoading && !isFetching;
  const hasSharesResults = allResults.length > 0;
  const hasUsersResults = users.length > 0;
  const showNoSharesLine = settled && !hasSharesResults;
  const showNoUsersLine = settled && !hasUsersResults;
  const showCombinedFallback =
    settled && !hasSharesResults && !hasUsersResults;

  return (
    <div>
      {/* Search input */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search published collections"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, author, or topic..."
          autoFocus
          className="w-full rounded-md border border-rule bg-paper py-3 pl-10 pr-4 text-lg text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>

      {/* Browse sections — shown when query is empty (E11) */}
      {!enabled && browseData ? <BrowseSections data={browseData} /> : null}

      {/* Loading spinner */}
      {(isLoading || isFetching) && enabled ? (
        <div className="mt-6 flex justify-center" aria-live="polite">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-ink-faint border-t-ink"
            role="status"
          >
            <span className="sr-only">Loading...</span>
          </div>
        </div>
      ) : null}

      {/* "No collections matched" line — sits ABOVE the user block when
          users matched but shares didn't (E5 spec, W-FIX-8). Single line,
          no link — the People block below carries the result; users can
          still navigate via the dashboard nav. */}
      {showNoSharesLine && hasUsersResults ? (
        <p className="mt-6 text-sm text-ink-muted">
          No collections matched{' '}
          <span className="font-medium text-ink">
            &lsquo;{debouncedQuery}&rsquo;
          </span>
          .
        </p>
      ) : null}

      {/* User-search block (PR-B §5 W4) — sits above the shares results.
          When shares matched, the "no people matched" line goes underneath
          (separate empty state per result type, per E5). */}
      {enabled && hasUsersResults ? (
        <section className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            People matching &lsquo;{debouncedQuery}&rsquo;
          </h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {users.map((user) => (
              <UserCard key={user.id} user={user} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Filter pills + sort */}
      {showControls ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition ${
                activeTypes.has(type)
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-paper-soft text-ink-muted hover:border-ink/40'
              }`}
            >
              {type}
            </button>
          ))}

          <div className="ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="rounded-md border border-rule bg-paper px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted focus:border-accent focus:outline-none"
              aria-label="Sort results"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {SORT_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {/* Results list */}
      {hasSharesResults ? (
        <div role="list" aria-live="polite" className="mt-4">
          {displayResults.map((result) => (
            <ShareCard key={result.short_code} result={result} />
          ))}
        </div>
      ) : null}

      {/* No-results — two-line empty state with a Browse-all button.
          Matches the mobile pattern (apps/mobile/app/search.tsx) so the two
          surfaces feel of-a-piece. (E5 / W-FIX-8.) */}
      {showCombinedFallback ? (
        <div className="mt-10 text-center">
          <h2 className="font-serif text-xl tracking-tight text-ink">
            No matches
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            No collections or people matched{' '}
            <span className="font-medium text-ink">
              &lsquo;{debouncedQuery}&rsquo;
            </span>
            .
          </p>
          <Link
            href="/browse"
            className="mt-5 inline-flex items-center justify-center rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
          >
            Browse all
          </Link>
          {debouncedQuery.length <= 3 ? (
            <p className="mt-3 text-xs text-ink-faint">
              Try a longer search term for better results.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* users-empty branch when shares matched (E5, W-FIX-8) */}
      {showNoUsersLine && hasSharesResults ? (
        <p className="mt-3 text-xs text-ink-faint">
          No people matched &lsquo;{debouncedQuery}&rsquo;.
        </p>
      ) : null}

      {/* Load more */}
      {hasMore && displayResults.length > 0 && !isFetching ? (
        <div className="mt-8 text-center">
          <button
            onClick={handleLoadMore}
            className="text-sm font-medium text-accent transition hover:opacity-80"
          >
            Show more results
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse sections (shown before user types — E11)
// ---------------------------------------------------------------------------

function BrowseSections({ data }: { data: BrowseResponse }) {
  const { trending, recent, total_published } = data;

  // Edge case: nothing published at all (E7 — but the home page is the
  // primary surface for that copy; here we keep it terse).
  if (trending.length === 0 && recent.length === 0) {
    return (
      <div className="mt-10 text-center">
        <p className="text-sm text-ink-muted">
          Be the first to publish a collection on MyEtAl.
        </p>
      </div>
    );
  }

  const showTrending = trending.length >= 3;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Public collections — search above or
        </h2>
        <Link
          href="/browse"
          className="text-xs font-medium text-accent transition hover:opacity-80"
        >
          browse all &rarr;
        </Link>
      </div>

      {showTrending ? (
        <div className="mt-4">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
            Trending this week
          </h3>
          <div role="list" className="mt-2">
            {trending.map((item) => (
              <ShareCard key={item.short_code} result={item} showViews />
            ))}
          </div>
        </div>
      ) : null}

      <div className={showTrending ? 'mt-8' : 'mt-4'}>
        <h3 className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
          Recently published
        </h3>
        <div role="list" className="mt-2">
          {recent.map((item) => (
            <ShareCard key={item.short_code} result={item} />
          ))}
        </div>
      </div>

      {total_published >= 5 ? (
        <p className="mt-8 text-center text-sm text-ink-faint">
          Browse {total_published} collections
        </p>
      ) : null}
    </div>
  );
}
