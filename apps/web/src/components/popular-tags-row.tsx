import Link from 'next/link';

import type { Tag } from '@/types/share';

interface Props {
  tags: Tag[];
  /** When set, the chip whose `slug` matches gets the "active" treatment. */
  activeSlug?: string;
  /**
   * Base path to link each chip to. Existing query params (e.g. sort) are
   * preserved by the caller via `extraParams`.
   */
  basePath?: string;
  /**
   * Additional query params to preserve on each chip link (e.g. `sort`).
   * `tags` is always overridden with the chip's slug.
   */
  extraParams?: Record<string, string | undefined>;
  className?: string;
}

const baseChip =
  'inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider transition';

const inactiveChip =
  `${baseChip} border-rule bg-paper-soft text-ink-muted hover:border-ink/40 hover:text-ink`;

const activeChip =
  `${baseChip} border-ink bg-ink text-paper hover:opacity-90`;

/**
 * Horizontal row of popular tags, used by `/browse` (W-FIX-1) and
 * `<HomeBrowseSection />`. The active chip (i.e. the tag currently filtered
 * on `/browse?tags=`) gets the filled-ink treatment to mirror the type-pill
 * "selected" state in the search UI.
 */
export function PopularTagsRow({
  tags,
  activeSlug,
  basePath = '/browse',
  extraParams,
  className,
}: Props) {
  if (tags.length === 0) return null;

  const buildHref = (slug: string) => {
    const qs = new URLSearchParams();
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v) qs.set(k, v);
      }
    }
    qs.set('tags', slug);
    return `${basePath}?${qs.toString()}`;
  };

  const wrapClass = ['flex flex-wrap gap-2', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapClass}>
      {tags.map((tag) => {
        const isActive = activeSlug === tag.slug;
        return (
          <Link
            key={tag.id}
            href={buildHref(tag.slug)}
            className={isActive ? activeChip : inactiveChip}
            aria-current={isActive ? 'true' : undefined}
          >
            {tag.label}
          </Link>
        );
      })}
    </div>
  );
}
