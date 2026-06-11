import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { API_BASE_URL, ApiError, api } from '@/lib/api';
import type { PublicShareResponse } from '@/types/share';

import { PresentClient } from './present-client';

/**
 * Presenter mode — the last slide of every conference talk. A fullscreen,
 * chrome-free deck: cover slide with a giant QR + short URL readable from
 * the back of the room, then one big-text slide per item. Anonymous route
 * (middleware only gates /dashboard/*); noindex because /c/{code} is the
 * canonical page.
 */

type PageProps = { params: Promise<{ code: string }> };

const FETCH_OPTIONS = { next: { revalidate: 300 } };

async function fetchShare(code: string): Promise<PublicShareResponse | null> {
  try {
    return await api<PublicShareResponse>(
      `/public/c/${encodeURIComponent(code)}`,
      FETCH_OPTIONS,
    );
  } catch (err) {
    // 410-tombstoned collapses to the generic not-found here — the canonical
    // /c/{code} page owns the friendlier "gone" messaging.
    if (err instanceof ApiError && (err.isNotFound || err.status === 410)) {
      return null;
    }
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const share = await fetchShare(code);
  return {
    title: share ? `${share.name} — present` : 'MyEtAl',
    robots: { index: false },
  };
}

export default async function PresentPage({ params }: PageProps) {
  const { code } = await params;
  const share = await fetchShare(code);
  if (!share) notFound();

  const siteHost = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app')
    .replace(/\/$/, '')
    .replace(/^https?:\/\//, '');
  const qrUrl = `${API_BASE_URL}/public/c/${encodeURIComponent(code)}/qr.png`;

  return <PresentClient share={share} qrUrl={qrUrl} siteHost={siteHost} />;
}
