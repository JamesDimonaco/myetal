import type { MetadataRoute } from 'next';

import { api } from '@/lib/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app';

// sitemap.ts is cached at build time by default; without this the sitemap
// froze at the last deploy and new shares never reached search engines.
export const revalidate = 3600;

interface SitemapShare {
  short_code: string;
  updated_at: string;
  // Optional until the API deploy that adds it is live.
  owner_slug?: string;
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

  // Dynamic share and profile pages — fetched from the API's sitemap-shares endpoint.
  // On error we gracefully degrade: the sitemap still includes static pages.
  let shareEntries: MetadataRoute.Sitemap = [];
  const profileUpdated = new Map<string, Date>();
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
    for (const share of shares) {
      if (!share.owner_slug) continue;
      const updated = new Date(share.updated_at);
      const seen = profileUpdated.get(share.owner_slug);
      if (!seen || updated > seen) profileUpdated.set(share.owner_slug, updated);
    }
  } catch (err) {
    // Graceful degradation: static pages are still returned so the
    // sitemap is never a hard 500. We DO log though — a silent catch
    // was hiding genuine API outages from observability. The error is
    // best-effort and the build / request continues.
    console.error('[sitemap] failed to fetch dynamic share entries', err);
  }

  const profileEntries: MetadataRoute.Sitemap = [...profileUpdated].map(
    ([slug, lastModified]) => ({
      url: `${SITE_URL}/u/${slug}`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    }),
  );

  return [...staticEntries, ...profileEntries, ...shareEntries];
}
