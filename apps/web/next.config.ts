import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Permanent redirects for routes that used to live at the top level but
  // now sit under /dashboard/* so they inherit the authed shell (header,
  // nav, footer). Cheap insurance against stale bookmarks / external links.
  async redirects() {
    return [
      {
        source: '/search',
        destination: '/dashboard/search',
        permanent: true,
      },
      {
        source: '/feedback',
        destination: '/dashboard/feedback',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Public collection viewer — aggressive CDN cache so a Slack/Twitter
        // preview crawl doesn't hammer the home server. The page itself uses
        // `next.revalidate: 300` on the underlying fetch so Next's data cache
        // matches the s-maxage window. SWR keeps a stale render available
        // for a day if the backend is briefly down.
        source: '/c/:code*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=300, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
