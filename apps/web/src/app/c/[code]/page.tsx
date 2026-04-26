import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ShareItemCard } from '@/components/share-item-card';
import { API_BASE_URL, ApiError, api } from '@/lib/api';
import { formatItemCount, formatRelativeTime } from '@/lib/format';
import type { PublicShareResponse } from '@/types/share';

/**
 * The public, no-auth-required collection viewer. THIS IS THE GROWTH LOOP —
 * when someone shares a `https://myetal.app/c/X` link in Slack/Twitter/email,
 * the recipient lands here. Server-rendered for fast first paint, indexed by
 * search engines, and (crucially) crawlable by social-preview bots so the
 * embed shows the collection title + a QR thumbnail.
 *
 * Caching strategy:
 *  - `next.revalidate: 300` on the fetch puts the share in Next's data cache
 *    for 5 minutes; a busy collection survives a Slack-induced thundering herd
 *    without hammering the home server.
 *  - We add a `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`
 *    header via the layout/page response so any CDN in front of the app
 *    follows the same policy. (Set in `headers()` from the route segment.)
 *  - The QR image is served by the API with its own long max-age.
 */

type PageProps = { params: Promise<{ code: string }> };

const FETCH_OPTIONS = { next: { revalidate: 300 } };

async function fetchPublicShare(code: string): Promise<PublicShareResponse | null> {
  try {
    return await api<PublicShareResponse>(`/public/c/${encodeURIComponent(code)}`, FETCH_OPTIONS);
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const share = await fetchPublicShare(code);

  if (!share) {
    return {
      title: 'Collection not found',
      robots: { index: false },
    };
  }

  const description =
    share.description?.trim() ||
    `${formatItemCount(share.items.length)} shared via MyEtal`;

  const ogImage = `${API_BASE_URL}/public/c/${encodeURIComponent(code)}/qr.png`;
  const canonicalPath = `/c/${encodeURIComponent(code)}`;

  return {
    title: share.name,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: share.name,
      description,
      type: 'article',
      siteName: 'MyEtal',
      url: canonicalPath,
      images: [
        {
          url: ogImage,
          width: 600,
          height: 600,
          alt: `QR code for "${share.name}"`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.name,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicSharePage({ params }: PageProps) {
  const { code } = await params;
  const share = await fetchPublicShare(code);

  if (!share) notFound();

  const qrUrl = `${API_BASE_URL}/public/c/${encodeURIComponent(code)}/qr.png`;
  const itemCount = share.items.length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
      <div className="text-sm text-ink-muted">
        <Link href="/" className="hover:text-ink">
          MyEtal
        </Link>
      </div>

      <header className="mt-8">
        <h1 className="font-serif text-4xl leading-tight tracking-tight text-ink sm:text-5xl">
          {share.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          {share.owner_name ? <span>by {share.owner_name}</span> : null}
          <span aria-hidden>·</span>
          <span>Updated {formatRelativeTime(share.updated_at)}</span>
          <span aria-hidden>·</span>
          <span className="uppercase tracking-wide text-ink-faint">{share.type}</span>
        </div>
        {share.description ? (
          <p className="mt-6 text-base leading-relaxed text-ink">{share.description}</p>
        ) : null}
      </header>

      <section className="mt-10">
        {itemCount === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            This collection is empty.
          </p>
        ) : (
          share.items.map((item) => <ShareItemCard key={item.id} item={item} />)
        )}
      </section>

      <aside className="mt-16 border-t border-rule pt-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-lg text-ink">Scan to keep this</p>
            <p className="mt-1 text-sm text-ink-muted">
              {formatItemCount(itemCount)} ·{' '}
              <code className="text-ink">/c/{share.short_code}</code>
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt={`QR code for "${share.name}"`}
            width={140}
            height={140}
            className="h-32 w-32 rounded-md border border-rule bg-white p-2 sm:h-36 sm:w-36"
          />
        </div>
      </aside>

      <footer className="mt-16 text-xs text-ink-faint">
        Built with MyEtal ·{' '}
        <Link href="/" className="underline-offset-2 hover:underline">
          myetal.app
        </Link>
      </footer>
    </main>
  );
}
