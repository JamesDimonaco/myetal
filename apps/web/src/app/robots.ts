import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/c/', '/privacy'],
      disallow: ['/dashboard/', '/api/', '/admin/', '/sign-in', '/sign-up'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
