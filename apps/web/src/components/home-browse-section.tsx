/**
 * Home-page "Browse public collections" section (PR-B §4 W3).
 *
 * Server-rendered. Pulls the popular-tags row + a snapshot of trending +
 * recent shares. Cached for 5 minutes to match the s-maxage=300 header on
 * `/c/:code*` (precedent in next.config.ts:21-37).
 *
 * Empty-state E7: when `total_published === 0`, drop the trending/recent
 * grids and render a single marketing card so the user doesn't see two
 * empties stacked.
 */

import Link from 'next/link';

import { PopularTagsRow } from '@/components/popular-tags-row';
import { ShareCard } from '@/components/share-card';
import { ApiError, api } from '@/lib/api';
import type { BrowseResponse, Tag } from '@/types/share';

const FETCH_OPTIONS = { next: { revalidate: 300 } };

async function fetchPopularTags(): Promise<Tag[]> {
  try {
    return await api<Tag[]>('/public/tags/popular?limit=8', FETCH_OPTIONS);
  } catch (err) {
    // Fail soft: if the tags endpoint hiccups, just hide the chip row rather
    // than blanking the entire home page.
    if (err instanceof ApiError) return [];
    throw err;
  }
}

async function fetchBrowseSnapshot(): Promise<BrowseResponse | null> {
  try {
    return await api<BrowseResponse>('/public/browse', FETCH_OPTIONS);
  } catch (err) {
    // Fail soft on backend hiccups so the home page still renders. Anything
    // that isn't a recognised ApiError is a genuine bug — let it bubble.
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export async function HomeBrowseSection() {
  const [tags, browse] = await Promise.all([
    fetchPopularTags(),
    fetchBrowseSnapshot(),
  ]);

  // E7 — brand-new app with zero published shares anywhere. Hide the
  // trending/recent grids and show a single CTA card. This also catches
  // the case where the browse fetch failed entirely.
  if (!browse || browse.total_published === 0) {
    return (
      <section className="mt-24 sm:mt-32">
        <h2 className="font-serif text-2xl tracking-tight text-ink">
          Browse public collections
        </h2>
        <div className="mt-6 rounded-lg border border-rule bg-paper-soft p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
            No public collections to browse yet — be one of the first. Share
            a paper, a reading list, or a poster, and it shows up here.
          </p>
          <Link
            href="/sign-up"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Sign up
          </Link>
        </div>
      </section>
    );
  }

  const trending = browse.trending.slice(0, 8);
  const recent = browse.recent.slice(0, 8);
  const showTrending = trending.length >= 3;

  return (
    <section className="mt-24 sm:mt-32">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-serif text-2xl tracking-tight text-ink">
          Browse public collections
        </h2>
        <Link
          href="/browse"
          className="text-sm font-medium text-accent transition hover:opacity-80"
        >
          Browse all &rarr;
        </Link>
      </div>

      <PopularTagsRow tags={tags} className="mt-4" />


      {showTrending ? (
        <div className="mt-8">
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            Trending now
          </h3>
          <div role="list" className="mt-2">
            {trending.map((item) => (
              <ShareCard key={item.short_code} result={item} showViews />
            ))}
          </div>
        </div>
      ) : null}

      <div className={showTrending ? 'mt-10' : 'mt-8'}>
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Recently published
        </h3>
        <div role="list" className="mt-2">
          {recent.map((item) => (
            <ShareCard key={item.short_code} result={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
