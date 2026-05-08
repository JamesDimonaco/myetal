/**
 * Renders a single public share as a card row. Used by `/dashboard/search`,
 * `/browse`, and the home-page browse section. Consolidates what were two
 * near-identical local card components in `search-results.tsx` (BrowseCard
 * + ResultCard) so the trending/recent + filtered surfaces stay in lock-step.
 *
 * Server-component-safe (no hooks, no client APIs). Tag chips link to the
 * /browse route (PR-B is the route that makes those clickable).
 */

import Link from 'next/link';

import { TagChips } from '@/components/tag-chips';
import { formatRelativeTime } from '@/lib/format';
import type { BrowseShareResult, ShareSearchResult } from '@/types/share';

type CardShare = BrowseShareResult | ShareSearchResult;

interface Props {
  result: CardShare;
  /**
   * When true, prefer the `view_count` line over the relative-time line. Use
   * this on the trending block where view counts are the headline signal.
   */
  showViews?: boolean;
}

function previewTextFor(result: CardShare): string | null {
  if (!result.preview_items || result.preview_items.length === 0) return null;
  const shown = result.preview_items.slice(0, 3);
  const remaining = result.item_count - shown.length;
  const titles = shown.join(', ');
  if (remaining > 0) {
    return `Contains: ${titles}, and ${remaining} more`;
  }
  return `Contains: ${titles}`;
}

function hasViews(r: CardShare): r is BrowseShareResult {
  return 'view_count' in r;
}

export function ShareCard({ result, showViews }: Props) {
  const previewText = previewTextFor(result);

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

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
        {result.owner_name ? <span>{result.owner_name}</span> : null}
        <span className="rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
          {result.type}
        </span>
        <span>
          {result.item_count} {result.item_count === 1 ? 'paper' : 'papers'}
        </span>
        {showViews && hasViews(result) && result.view_count != null ? (
          <span>
            {result.view_count} {result.view_count === 1 ? 'view' : 'views'}
          </span>
        ) : (
          <span>{formatRelativeTime(result.published_at)}</span>
        )}
      </div>

      {previewText ? (
        <p className="mt-1.5 text-xs italic text-ink-faint">{previewText}</p>
      ) : null}

      {result.tags && result.tags.length > 0 ? (
        <div className="mt-2">
          <TagChips tags={result.tags} max={2} linkPattern="browse" />
        </div>
      ) : null}
    </article>
  );
}
