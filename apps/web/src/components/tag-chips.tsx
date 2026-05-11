'use client';

import Link from 'next/link';

import type { Tag } from '@/types/share';

interface Props {
  tags: Tag[] | undefined | null;
  /** Show at most this many chips before collapsing to "+N more". */
  max?: number;
  /**
   * Linking behaviour for each chip.
   * - `'static'` (default): render as a non-interactive `<span>`.
   * - `'browse'`: render as a `<Link>` to `/browse?tags=<slug>`.
   *
   * TODO(PR-B): flip callers to `'browse'` once the `/browse` route ships.
   * Until then, defaulting to `'static'` avoids 404s on chip clicks.
   */
  linkPattern?: 'static' | 'browse';
  /** Override the default `/browse?tags=<slug>` href when linking. */
  hrefFor?: (tag: Tag) => string;
  className?: string;
}

const chipClass =
  'inline-flex items-center rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted transition hover:border-ink/40 hover:text-ink';

const staticChipClass =
  'inline-flex items-center rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted';

const moreClass =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint';

/**
 * Renders a share's topical tags as small pill chips. Same look-and-feel as
 * the type-filter pills in the search results UI. Defaults to non-interactive
 * `<span>`s (`linkPattern='static'`); pass `linkPattern='browse'` once the
 * `/browse` route ships in PR-B to make them clickable.
 */
export function TagChips({
  tags,
  max = 2,
  linkPattern = 'static',
  hrefFor,
  className,
}: Props) {
  if (!tags || tags.length === 0) return null;

  const shown = tags.slice(0, max);
  const overflow = tags.length - shown.length;

  const wrapClass = ['flex flex-wrap items-center gap-1.5', className]
    .filter(Boolean)
    .join(' ');

  const buildHref = (tag: Tag) =>
    hrefFor ? hrefFor(tag) : `/browse?tags=${encodeURIComponent(tag.slug)}`;

  return (
    <div className={wrapClass}>
      {shown.map((tag) =>
        linkPattern === 'browse' ? (
          <Link
            key={tag.id}
            href={buildHref(tag)}
            onClick={(e) => e.stopPropagation()}
            className={chipClass}
          >
            {tag.label}
          </Link>
        ) : (
          <span key={tag.id} className={staticChipClass}>
            {tag.label}
          </span>
        ),
      )}
      {overflow > 0 ? (
        <span className={moreClass} aria-label={`${overflow} more tags`}>
          +{overflow} more
        </span>
      ) : null}
    </div>
  );
}
