'use client';

import Link from 'next/link';

import { useSavedShares } from '@/hooks/useSavedShares';

export function SavedSharesSection() {
  const { saved } = useSavedShares();

  if (saved.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
        Saved collections
      </h2>
      <div className="mt-4 space-y-2">
        {saved.map((s) => (
          <Link
            key={s.short_code}
            href={`/c/${s.short_code}`}
            className="group flex items-center justify-between rounded-md border border-ink/10 px-4 py-3 transition-colors hover:border-ink/20 hover:bg-surface-sunken"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink group-hover:underline">
                {s.name}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {s.owner_name ? `${s.owner_name} \u00b7 ` : ''}
                {s.item_count} {s.item_count === 1 ? 'item' : 'items'}
                {' \u00b7 '}
                <span className="uppercase tracking-wide">{s.type}</span>
              </p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-ink-faint">
              <path d="M5 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14l-5-3.5L5 18V4Z" />
            </svg>
          </Link>
        ))}
      </div>
    </section>
  );
}
