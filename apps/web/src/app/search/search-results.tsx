'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { formatRelativeTime } from '@/lib/format';
import type {
  ShareSearchResponse,
  ShareSearchResult,
  ShareType,
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
  'poster',
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
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const enabled = debouncedQuery.length >= MIN_QUERY_LENGTH;

  // Reset pagination when query changes
  const prevQueryRef = useRef(debouncedQuery);
  useEffect(() => {
    if (prevQueryRef.current !== debouncedQuery) {
      prevQueryRef.current = debouncedQuery;
      setAllResults([]);
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

  const showControls = allResults.length > 0;
  const showNoResults =
    enabled && !isLoading && !isFetching && allResults.length === 0;

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
      <div role="list" aria-live="polite" className="mt-4">
        {displayResults.map((result) => (
          <ResultCard key={result.short_code} result={result} />
        ))}
      </div>

      {/* No results */}
      {showNoResults ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-ink-muted">
            No collections matched{' '}
            <span className="font-medium text-ink">
              &lsquo;{debouncedQuery}&rsquo;
            </span>
            . Try different keywords or check the spelling.
          </p>
          {debouncedQuery.length <= 3 ? (
            <p className="mt-2 text-xs text-ink-faint">
              Try a longer search term for better results.
            </p>
          ) : null}
        </div>
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
// Result card
// ---------------------------------------------------------------------------

function ResultCard({ result }: { result: ShareSearchResult }) {
  const previewText = useMemo(() => {
    if (!result.preview_items || result.preview_items.length === 0) return null;
    const shown = result.preview_items.slice(0, 3);
    const remaining = result.item_count - shown.length;
    const titles = shown.join(', ');
    if (remaining > 0) {
      return `Contains: ${titles}, and ${remaining} more`;
    }
    return `Contains: ${titles}`;
  }, [result.preview_items, result.item_count]);

  return (
    <article role="listitem" className="border-b border-rule py-4">
      <Link
        href={`/c/${result.short_code}`}
        className="font-serif text-base text-ink underline decoration-transparent decoration-1 underline-offset-4 transition hover:decoration-ink"
      >
        {result.name}
      </Link>

      {result.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
          {result.description}
        </p>
      ) : null}

      {/* Metadata row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
        {result.owner_name ? <span>{result.owner_name}</span> : null}
        <span className="rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
          {result.type}
        </span>
        <span>
          {result.item_count} {result.item_count === 1 ? 'paper' : 'papers'}
        </span>
        <span>{formatRelativeTime(result.published_at)}</span>
      </div>

      {/* Preview items */}
      {previewText ? (
        <p className="mt-1.5 text-xs italic text-ink-faint">{previewText}</p>
      ) : null}
    </article>
  );
}
