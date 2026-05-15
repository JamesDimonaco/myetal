'use client';

import Link from 'next/link';
import { toast } from 'sonner';

import { useSavedShares } from '@/hooks/useSavedShares';

export function SavedSharesSection() {
  const { saved, unsave } = useSavedShares();

  if (saved.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
        Saved collections
      </h2>
      <div className="mt-4 space-y-2">
        {saved.map((s) => (
          // Outer wrapper is a div (not a Link) so the per-item X button can
          // sit inside without the Link swallowing its click. The title row
          // remains a Link.
          <div
            key={s.short_code}
            className="group flex items-center justify-between gap-2 rounded-md border border-ink/10 pr-2 transition-colors hover:border-ink/20 hover:bg-surface-sunken"
          >
            <Link
              href={`/c/${s.short_code}`}
              className="flex flex-1 items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink group-hover:underline">
                  {s.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {s.owner_name ? `${s.owner_name} · ` : ''}
                  {s.item_count} {s.item_count === 1 ? 'item' : 'items'}
                  {' · '}
                  <span className="uppercase tracking-wide">{s.type}</span>
                </p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-ink-faint">
                <path d="M5 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14l-5-3.5L5 18V4Z" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={() => {
                unsave(s.short_code);
                toast.success(`Removed "${s.name}" from saved`);
              }}
              aria-label={`Remove ${s.name} from saved`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-faint transition hover:bg-paper-soft hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
