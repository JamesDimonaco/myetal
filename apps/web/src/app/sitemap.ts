import type { MetadataRoute } from 'next';

import { api } from '@/lib/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app';

interface SitemapShare {
  short_code: string;
  updated_at: string;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Dynamic share pages — fetched from the API's sitemap-shares endpoint.
  // On error we gracefully degrade: the sitemap still includes static pages.
  let shareEntries: MetadataRoute.Sitemap = [];
  try {
    const shares = await api<SitemapShare[]>('/public/sitemap-shares', {
      next: { revalidate: 3600 },
    });
    shareEntries = shares.map((share) => ({
      url: `${SITE_URL}/c/${share.short_code}`,
      lastModified: new Date(share.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  } catch (err) {
    // Graceful degradation: static pages are still returned so the
    // sitemap is never a hard 500. We DO log though — a silent catch
    // was hiding genuine API outages from observability. The error is
    // best-effort and the build / request continues.
    console.error('[sitemap] failed to fetch dynamic share entries', err);
  }

  return [...staticEntries, ...shareEntries];
}
