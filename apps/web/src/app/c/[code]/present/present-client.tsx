'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PublicShareResponse, ShareItem } from '@/types/share';

interface Props {
  share: PublicShareResponse;
  qrUrl: string;
  siteHost: string;
}

/** Minimum horizontal travel (px) before a touch counts as a swipe. */
const SWIPE_THRESHOLD = 48;

/**
 * The slide engine. Slide 0 is the cover (title + giant QR + URL); slides
 * 1..n are one item each. Navigation: arrow keys / space, click-or-tap on
 * the right/left half, touch swipe. Escape exits back to the share page.
 */
export function PresentClient({ share, qrUrl, siteHost }: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const slideCount = 1 + share.items.length;
  const sharePath = `/c/${share.short_code}`;

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(slideCount - 1, Math.max(0, i + delta)));
    },
    [slideCount],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape') {
        router.push(sharePath);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, router, sharePath]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Links/buttons inside slides keep their own behaviour.
    if ((e.target as HTMLElement).closest('a, button')) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    step(e.clientX - left < width / 2 ? -1 : 1);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start == null || end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    step(delta < 0 ? 1 : -1);
  };

  const item = index > 0 ? share.items[index - 1] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex select-none flex-col overflow-hidden bg-paper"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-center justify-end px-4 py-3 sm:px-6">
        <Link
          href={sharePath}
          className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-ink-muted transition hover:text-ink"
        >
          Exit ✕
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-10 sm:px-12">
        {item ? (
          <ItemSlide item={item} />
        ) : (
          <CoverSlide
            share={share}
            qrUrl={qrUrl}
            siteHost={siteHost}
          />
        )}
      </div>

      <div className="flex items-center justify-center gap-4 pb-5 text-sm text-ink-faint">
        <span className="tabular-nums">
          {index + 1} / {slideCount}
        </span>
        <span className="hidden sm:inline">← → to navigate · Esc to exit</span>
      </div>
    </div>
  );
}

function CoverSlide({
  share,
  qrUrl,
  siteHost,
}: {
  share: PublicShareResponse;
  qrUrl: string;
  siteHost: string;
}) {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-6 text-center sm:gap-8">
      <h1 className="break-words font-serif text-[clamp(1.75rem,5vw,3.5rem)] leading-tight text-ink">
        {share.name}
      </h1>
      {share.owner_name ? (
        <p className="text-[clamp(1rem,2.5vw,1.5rem)] text-ink-muted">
          {share.owner_name}
        </p>
      ) : null}
      <div className="rounded-xl border border-rule bg-white p-4 sm:p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt={`QR code for "${share.name}"`}
          className="h-[min(55vw,38vh)] w-[min(55vw,38vh)] sm:h-[min(40vw,42vh)] sm:w-[min(40vw,42vh)]"
        />
      </div>
      <p className="break-all font-mono text-[clamp(1rem,3vw,1.75rem)] font-semibold text-ink">
        {siteHost}/c/{share.short_code}
      </p>
    </div>
  );
}

function ItemSlide({ item }: { item: ShareItem }) {
  const authors = (item.authors ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  const reference = item.doi ?? item.url ?? null;

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-5 text-center sm:gap-7">
      <p className="text-sm uppercase tracking-widest text-ink-faint">
        {item.kind}
      </p>
      <h2 className="break-words font-serif text-[clamp(1.5rem,4.5vw,3rem)] leading-tight text-ink">
        {item.title}
      </h2>
      {authors.length > 0 ? (
        <p className="max-w-3xl text-[clamp(1rem,2.5vw,1.5rem)] leading-snug text-ink-muted">
          {authors.join(', ')}
          {item.year ? ` · ${item.year}` : ''}
        </p>
      ) : item.year ? (
        <p className="text-[clamp(1rem,2.5vw,1.5rem)] text-ink-muted">{item.year}</p>
      ) : null}
      {item.subtitle ? (
        <p className="max-w-3xl text-[clamp(0.95rem,2vw,1.25rem)] text-ink-muted">
          {item.subtitle}
        </p>
      ) : null}
      {reference ? (
        <p className="break-all font-mono text-sm text-ink-faint sm:text-base">
          {reference}
        </p>
      ) : null}
    </div>
  );
}
