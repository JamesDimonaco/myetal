import type { Metadata } from 'next';
import Link from 'next/link';

import { AnonymousHeader } from '@/components/anonymous-header';
import { BrowseSortDropdown } from '@/components/browse-sort-dropdown';
import { DashboardHeader } from '@/components/dashboard-header';
import { PopularTagsRow } from '@/components/popular-tags-row';
import { ShareCard } from '@/components/share-card';
import { SiteFooter } from '@/components/site-footer';
import { UserAvatar } from '@/components/user-avatar';
import { ApiError, api } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type {
  BrowseResponse,
  BrowseShareResult,
  ShareSearchResponse,
  ShareSearchResult,
  Tag,
  UserPublicOut,
} from '@/types/share';
import type { UserResponse } from '@/types/auth';

/**
 * Public discovery page (PR-B §4 + §5). Anonymous-readable — no /sign-in
 * redirect on 401.
 *
 * Four modes (resolved at request time from URL query params):
 *
 *  1. Default (no params): trending + recent split, mirroring what authed
 *     users see at `/dashboard/search` before they type. Cacheable at the
 *     edge; that's why this is a server component, not a client one.
 *  2. Filtered (`?tags=`, `?sort=`): single result list. We render the
 *     `recent` block from the response — the backend re-uses that slot for
 *     filtered results, with `trending` empty.
 *  3. Per-owner (`?owner_id=`): slim filter bar above the result list.
 *     Backend populates a `UserPublicOut` payload alongside the shares.
 *     404 from the backend → friendly "User not found" rather than the
 *     framework 404 page.
 *  4. Search (`?q=`): swap `/public/browse` for `/public/search`,
 *     render a results list + (top-N) matched users. Sort / tags /
 *     owner filters do NOT apply to search — the search box clears
 *     them implicitly. Cacheable at the edge per `q` value.
 *
 * `searchParams` is a Promise (modern Next contract — see
 * sign-in/page.tsx and sign-up/page.tsx for precedent).
 */

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<SearchParams> };

export const metadata: Metadata = {
  title: 'Browse public collections',
  description:
    'Discover published reading lists, paper bundles, and project pages on MyEtAl.',
};

const FETCH_OPTIONS = { next: { revalidate: 300 } };

// Backend currently supports `recent` and `popular` only (see
// apps/api/src/myetal_api/api/routes/search.py:_VALID_BROWSE_SORTS). The
// dropdown therefore exposes Trending (popular) + Newest (recent). A
// `most_items` option is omitted until the backend grows that sort key.
type SortOption = { value: string; label: string };
const SORT_OPTIONS: SortOption[] = [
  // Empty value = backend default (recent w/ trending block); rendered as
  // "Trending" because the homepage surfaces a trending block by default.
  { value: 'popular', label: 'Trending' },
  { value: 'recent', label: 'Newest' },
];

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function fetchBrowse(
  query: string,
): Promise<{ data: BrowseResponse | null; ownerNotFound: boolean }> {
  try {
    const data = await api<BrowseResponse>(
      `/public/browse${query ? `?${query}` : ''}`,
      FETCH_OPTIONS,
    );
    return { data, ownerNotFound: false };
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) {
      return { data: null, ownerNotFound: true };
    }
    throw err;
  }
}

/** Free-text trigram search over published shares + users. The endpoint
 * is rate-limited and timeout-bounded on the API side; we render a
 * tame empty-state when nothing matches, and let other failure modes
 * fall through to the framework error boundary (Vercel logs catch it).
 */
async function fetchSearch(q: string): Promise<ShareSearchResponse | null> {
  try {
    return await api<ShareSearchResponse>(
      `/public/search?q=${encodeURIComponent(q)}&limit=20&offset=0`,
      FETCH_OPTIONS,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      // 422 (too short / empty after trim), 429 (rate limit). Treat as
      // "no results" rather than crashing the page — the search box
      // stays usable.
      return { results: [], has_more: false, users: [] };
    }
    throw err;
  }
}

async function fetchPopularTags(): Promise<Tag[]> {
  try {
    return await api<Tag[]>('/public/tags/popular?limit=8', FETCH_OPTIONS);
  } catch (err) {
    if (err instanceof ApiError) return [];
    throw err;
  }
}

async function getCurrentUser(): Promise<UserResponse | null> {
  try {
    return await serverFetch<UserResponse>('/me', { cache: 'no-store' });
  } catch {
    // 401/403 = anonymous viewer. /browse is public.
    return null;
  }
}

export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = pickFirst(params.q)?.trim() || undefined;
  const tags = pickFirst(params.tags)?.trim() || undefined;
  const sort = pickFirst(params.sort)?.trim() || undefined;
  const ownerId = pickFirst(params.owner_id)?.trim() || undefined;

  // Search short-circuits the browse/filter modes. Tags/sort/owner are
  // ignored when `q` is set — the search endpoint doesn't honour them
  // and pretending otherwise would surprise users.
  const isSearch = Boolean(q);

  const qs = new URLSearchParams();
  if (tags) qs.set('tags', tags);
  if (sort) qs.set('sort', sort);
  if (ownerId) qs.set('owner_id', ownerId);
  const query = qs.toString();

  const [browseResult, searchResult, popularTags, user] = await Promise.all([
    isSearch
      ? Promise.resolve({ data: null, ownerNotFound: false })
      : fetchBrowse(query),
    isSearch ? fetchSearch(q!) : Promise.resolve(null),
    fetchPopularTags(),
    getCurrentUser(),
  ]);
  const { data, ownerNotFound } = browseResult;

  const signedIn = user !== null;
  const filtered = Boolean(tags || sort || ownerId);
  const activeTagSlug = tags ? tags.split(',')[0] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {signedIn ? (
        <DashboardHeader user={user!} />
      ) : (
        <AnonymousHeader />
      )}

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        {/* Search box is always visible. It's a plain GET form so it
            works without JS and any text-typed-into-the-URL combo (q=...)
            is server-renderable and edge-cacheable. */}
        <SearchBox initialQuery={q ?? ''} />

        {ownerNotFound ? <OwnerNotFound /> : null}

        {isSearch ? (
          <SearchResultsView query={q!} response={searchResult} />
        ) : data ? (
          <BrowseBody
            data={data}
            tags={tags}
            sort={sort}
            ownerId={ownerId}
            filtered={filtered}
            popularTags={popularTags}
            activeTagSlug={activeTagSlug}
          />
        ) : null}
      </main>

      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search box (RSC — plain GET form, no JS required)
// ---------------------------------------------------------------------------

function SearchBox({ initialQuery }: { initialQuery: string }) {
  return (
    <form
      action="/browse"
      method="GET"
      role="search"
      className="mb-8 flex flex-wrap gap-2"
    >
      <label htmlFor="browse-q" className="sr-only">
        Search collections
      </label>
      <input
        id="browse-q"
        type="search"
        name="q"
        defaultValue={initialQuery}
        placeholder="Search collections and researchers"
        autoComplete="off"
        className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none transition focus:border-ink"
      />
      <button
        type="submit"
        className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
      >
        Search
      </button>
      {initialQuery ? (
        <Link
          href="/browse"
          className="inline-flex min-h-[44px] items-center rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Search results view
// ---------------------------------------------------------------------------

function SearchResultsView({
  query,
  response,
}: {
  query: string;
  response: ShareSearchResponse | null;
}) {
  const shares = response?.results ?? [];
  const users = response?.users ?? [];
  const hasShares = shares.length > 0;
  const hasUsers = users.length > 0;
  const anything = hasShares || hasUsers;

  return (
    <section>
      <header>
        <h1 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
          Results for &ldquo;{query}&rdquo;
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {anything
            ? `${shares.length} ${shares.length === 1 ? 'collection' : 'collections'}${
                hasUsers ? `, ${users.length} ${users.length === 1 ? 'researcher' : 'researchers'}` : ''
              }`
            : 'No matches yet — try a different word or a researcher name.'}
        </p>
      </header>

      {hasUsers ? (
        <div className="mt-8">
          <h2 className="font-serif text-lg text-ink">Researchers</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {users.map((u) => (
              <SearchUserCard key={u.id} user={u} />
            ))}
          </div>
        </div>
      ) : null}

      {hasShares ? (
        <div className="mt-8">
          <h2 className="font-serif text-lg text-ink">Collections</h2>
          <div className="mt-3 grid gap-4">
            {shares.map((s) => (
              <SearchShareCard key={s.short_code} result={s} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SearchUserCard({ user }: { user: UserPublicOut }) {
  const slug = user.handle ?? user.id;
  return (
    <Link
      href={`/u/${encodeURIComponent(slug)}`}
      className="flex items-center gap-3 rounded-md border border-rule bg-paper p-3 transition hover:bg-paper-soft"
    >
      <UserAvatar name={user.name} avatarUrl={user.avatar_url} size={36} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {user.name ?? 'Researcher'}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {user.share_count}{' '}
          {user.share_count === 1 ? 'collection' : 'collections'}
        </p>
      </div>
    </Link>
  );
}

function SearchShareCard({ result }: { result: ShareSearchResult }) {
  return (
    <Link
      href={`/c/${result.short_code}`}
      className="block rounded-lg border border-rule bg-paper p-4 transition hover:bg-paper-soft"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-base text-ink">{result.name}</h3>
        <span className="text-xs text-ink-muted">
          {result.item_count} {result.item_count === 1 ? 'item' : 'items'}
        </span>
      </div>
      {result.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
          {result.description}
        </p>
      ) : null}
      {result.owner_name ? (
        <p className="mt-2 text-xs text-ink-muted">by {result.owner_name}</p>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function BrowseBody({
  data,
  tags,
  sort,
  ownerId,
  filtered,
  popularTags,
  activeTagSlug,
}: {
  data: BrowseResponse;
  tags?: string;
  sort?: string;
  ownerId?: string;
  filtered: boolean;
  popularTags: Tag[];
  activeTagSlug?: string;
}) {
  const owner = data.owner ?? null;
  const isOwnerView = ownerId && owner;

  // Filtered surfaces use the `recent` slot (backend convention — `trending`
  // is empty when filters narrow the set). Default surface uses both slots.
  const filteredResults = filtered ? data.recent : [];
  const trending = filtered ? [] : data.trending;
  const recent = filtered ? [] : data.recent;

  // E7 — brand-new app, no public shares anywhere. Drop the trending/recent
  // grids entirely so we don't show two empties stacked.
  if (!filtered && data.total_published === 0) {
    return <EmptyAppState />;
  }

  // Active tag label — prefer the popular-tags lookup (W-FIX-9). Falls back
  // to slug-derived prettifying for tags outside the popular top-N.
  const activeTagLabel = activeTagSlug
    ? popularTags.find((t) => t.slug === activeTagSlug)?.label ??
      prettifySlug(activeTagSlug)
    : undefined;

  return (
    <>
      {isOwnerView ? <OwnerFilterBar owner={owner!} /> : null}
      {!isOwnerView ? (
        <BrowseHeader sort={sort} tags={tags} ownerId={ownerId} />
      ) : null}

      <PopularTagsRow
        tags={popularTags}
        activeSlug={activeTagSlug}
        extraParams={ownerId ? { owner_id: ownerId } : undefined}
        className="mt-6"
      />

      {filtered ? (
        <FilteredResults
          results={filteredResults}
          tags={tags}
          sort={sort}
          ownerName={owner?.name ?? null}
          isOwnerView={Boolean(isOwnerView)}
          activeTagLabel={activeTagLabel}
        />
      ) : (
        <DefaultBrowse
          trending={trending}
          recent={recent}
          totalPublished={data.total_published}
        />
      )}
    </>
  );
}

function BrowseHeader({
  sort,
  tags,
  ownerId,
}: {
  sort?: string;
  tags?: string;
  ownerId?: string;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Browse public collections
          </h1>
          <p className="mt-3 text-base text-ink-muted">
            Reading lists, paper bundles, and project pages published by
            researchers on MyEtAl.
          </p>
        </div>
        <BrowseSortDropdown
          current={sort ?? 'popular'}
          tags={tags}
          ownerId={ownerId}
          options={SORT_OPTIONS}
        />
      </div>
    </header>
  );
}

function OwnerFilterBar({
  owner,
}: {
  owner: NonNullable<BrowseResponse['owner']>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-rule bg-paper-soft px-4 py-2.5">
      <UserAvatar name={owner.name} avatarUrl={owner.avatar_url} size={28} />
      <span className="text-sm text-ink">
        Collections by{' '}
        <strong className="font-medium">{owner.name ?? 'Anonymous'}</strong>
        <span className="ml-2 text-ink-muted">
          {owner.share_count} published
        </span>
      </span>
      <Link
        href="/browse"
        className="ml-auto text-xs text-ink-muted transition hover:text-ink"
      >
        Show all
      </Link>
    </div>
  );
}

function DefaultBrowse({
  trending,
  recent,
  totalPublished,
}: {
  trending: BrowseShareResult[];
  recent: BrowseShareResult[];
  totalPublished: number;
}) {
  const showTrending = trending.length >= 3;

  return (
    <div className="mt-8">
      {showTrending ? (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            Trending this week
          </h2>
          <div role="list" className="mt-2">
            {trending.map((item) => (
              <ShareCard key={item.short_code} result={item} showViews />
            ))}
          </div>
        </section>
      ) : null}

      <section className={showTrending ? 'mt-12' : ''}>
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Recently published
        </h2>
        <div role="list" className="mt-2">
          {recent.map((item) => (
            <ShareCard key={item.short_code} result={item} />
          ))}
        </div>
      </section>

      {totalPublished >= 5 ? (
        <p className="mt-8 text-center text-sm text-ink-faint">
          {totalPublished}{' '}
          {totalPublished === 1 ? 'collection' : 'collections'} published
        </p>
      ) : null}
    </div>
  );
}

function FilteredResults({
  results,
  tags,
  sort,
  ownerName,
  isOwnerView,
  activeTagLabel,
}: {
  results: BrowseShareResult[];
  tags?: string;
  sort?: string;
  ownerName: string | null;
  isOwnerView: boolean;
  activeTagLabel?: string;
}) {
  return (
    <section className="mt-8">
      <FilterSummary tags={tags} sort={sort} activeTagLabel={activeTagLabel} />

      {results.length === 0 ? (
        <EmptyFiltered
          ownerName={ownerName}
          isOwnerView={isOwnerView}
          activeTagLabel={activeTagLabel}
          hasTagFilter={Boolean(tags)}
        />
      ) : (
        <div role="list" className="mt-2">
          {results.map((item) => (
            <ShareCard key={item.short_code} result={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterSummary({
  tags,
  sort,
  activeTagLabel,
}: {
  tags?: string;
  sort?: string;
  activeTagLabel?: string;
}) {
  const tagList = tags ? tags.split(',').filter(Boolean) : [];

  if (tagList.length === 0 && !sort) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      {tagList.length > 0 ? (
        <>
          <span className="text-ink-faint">Tags:</span>
          {tagList.map((slug, i) => (
            <span
              key={slug}
              className="rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink"
            >
              {/* Use the real label for the first chip when known. */}
              {i === 0 && activeTagLabel ? activeTagLabel : prettifySlug(slug)}
            </span>
          ))}
        </>
      ) : null}
      <Link
        href="/browse"
        className="ml-auto text-xs text-accent transition hover:opacity-80"
      >
        Clear filters
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function EmptyAppState() {
  return (
    <div className="rounded-lg border border-rule bg-paper-soft p-12 text-center">
      <h2 className="font-serif text-2xl tracking-tight text-ink">
        No public collections to browse yet
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        Be one of the first. Share a paper, a reading list, or a poster, and
        it shows up here.
      </p>
      <Link
        href="/sign-up"
        className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
      >
        Sign up
      </Link>
    </div>
  );
}

function EmptyFiltered({
  ownerName,
  isOwnerView,
  activeTagLabel,
  hasTagFilter,
}: {
  ownerName: string | null;
  isOwnerView: boolean;
  activeTagLabel?: string;
  hasTagFilter: boolean;
}) {
  // Owner has no shares (E5/E7-adjacent — quiet, not error-y, per spec).
  if (isOwnerView) {
    return (
      <p className="mt-10 text-center text-sm text-ink-muted">
        {ownerName ?? 'This user'} hasn&apos;t published any shares yet.
      </p>
    );
  }

  // Tag filter empty (E6 — render the human label, not the slug).
  if (hasTagFilter && activeTagLabel) {
    return (
      <p className="mt-10 text-center text-sm text-ink-muted">
        No shares tagged{' '}
        <span className="font-medium text-ink">
          &lsquo;{activeTagLabel}&rsquo;
        </span>{' '}
        yet. Be the first — open any of your bundles and add the tag.
      </p>
    );
  }

  return (
    <p className="mt-10 text-center text-sm text-ink-muted">
      No shares matched these filters.
    </p>
  );
}

function OwnerNotFound() {
  return (
    <div className="rounded-lg border border-rule bg-paper-soft p-12 text-center">
      <h2 className="font-serif text-2xl tracking-tight text-ink">
        User not found.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        That user either doesn&apos;t exist or hasn&apos;t published any
        shares yet.
      </p>
      <Link
        href="/browse"
        className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md border border-rule bg-paper px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
      >
        Browse all collections
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Last-resort fallback when a tag isn't in the popular-tags top-N: turn
 * `machine-learning` into `Machine Learning` so users don't see a slug.
 */
function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}
