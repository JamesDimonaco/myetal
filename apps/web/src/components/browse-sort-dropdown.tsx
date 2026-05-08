'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface SortOption {
  value: string;
  label: string;
}

interface Props {
  /** Currently-selected sort value (e.g. `popular`, `recent`). */
  current: string;
  /** Forwarded as `?tags=` so changing sort doesn't drop the tag filter. */
  tags?: string;
  /** Forwarded as `?owner_id=` for the per-owner browse view. */
  ownerId?: string;
  options: SortOption[];
}

/**
 * Server-friendly sort selector for `/browse`. Tiny client component (it has
 * to be — `onChange` only fires on the client). Submitting via `router.push`
 * preserves Next's data cache for the popular-tags fetch and the public
 * `/public/browse` response, both of which are revalidated at 300s.
 */
export function BrowseSortDropdown({ current, tags, ownerId, options }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const qs = new URLSearchParams();
    if (tags) qs.set('tags', tags);
    if (ownerId) qs.set('owner_id', ownerId);
    qs.set('sort', next);
    startTransition(() => {
      router.push(`/browse?${qs.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor="browse-sort" className="text-ink-faint">
        Sort
      </label>
      <select
        id="browse-sort"
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
        aria-busy={pending}
        className="rounded-md border border-rule bg-paper px-2 py-1 text-xs font-medium text-ink focus:border-accent focus:outline-none disabled:opacity-60"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
