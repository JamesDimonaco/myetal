import type { Metadata } from 'next';
import Link from 'next/link';

import { AnonymousHeader } from '@/components/anonymous-header';
import { DashboardHeader } from '@/components/dashboard-header';
import { ResearcherPageContent } from '@/components/researcher-page-content';
import { SiteFooter } from '@/components/site-footer';
import { API_BASE_URL, ApiError, api } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';
import type { BrowseResponse } from '@/types/share';

/**
 * Researcher page — one permanent URL + QR per researcher, for the business
 * card, the email signature, the title slide. Two shapes resolve to the same
 * page:
 *
 * * ``/u/{uuid}`` — the original UUID-keyed URL, preserved forever so QRs
 *   already printed on CVs and slides never dead-end.
 * * ``/u/{handle}`` — the human-readable slug researchers claim on the
 *   profile screen.
 *
 * Routing strategy: a single ``[slug]`` dynamic segment. We sniff the slug —
 * UUID-shape → look up by id; otherwise → look up by handle. Single route
 * file means there's exactly one place to change render logic, and the
 * Next.js router can't shadow one route with the other.
 *
 * When the owner has claimed a handle, the canonical URL points at
 * ``/u/{handle}`` regardless of which URL the visitor used — SEO consolidates
 * without auto-redirecting the UUID URL (deliberate: printed cards must keep
 * resolving exactly as-is per the deferred ticket spec).
 */

type PageProps = { params: Promise<{ slug: string }> };

const FETCH_OPTIONS = { next: { revalidate: 300 } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedOwner {
  /** The BrowseResponse payload (owner card + recent shares). */
  data: BrowseResponse;
  /** The UUID — always known once the owner is resolved (it's how the QR
   *  endpoint is keyed). */
  ownerId: string;
}

async function fetchOwner(slug: string): Promise<ResolvedOwner | null> {
  if (!slug) return null;
  const isUuid = UUID_RE.test(slug);
  const path = isUuid
    ? `/public/browse?owner_id=${encodeURIComponent(slug)}&sort=recent`
    : `/public/by-handle/${encodeURIComponent(slug)}`;

  try {
    const data = await api<BrowseResponse>(path, FETCH_OPTIONS);
    if (!data.owner) return null;
    return { data, ownerId: data.owner.id };
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) return null;
    throw err;
  }
}

async function getCurrentUser(): Promise<UserResponse | null> {
  try {
    return await serverFetch<UserResponse>('/me', { cache: 'no-store' });
  } catch {
    return null;
  }
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app').replace(/\/$/, '');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await fetchOwner(slug);

  // Unresolved owner: the page renders a soft empty state that must
  // not confirm or deny that an account exists. Mark the page
  // non-indexable so search engines don't enumerate guessable handles
  // / UUIDs via a generic title.
  if (!resolved?.data.owner) {
    return { title: 'MyEtAl', robots: { index: false } };
  }

  const owner = resolved.data.owner;
  // Canonical URL prefers the handle when present. SEO consolidates;
  // the UUID URL still resolves so printed cards never break. Emitted
  // regardless of whether the owner has a display name — without it
  // the handle/UUID consolidation defeats itself for accounts whose
  // ``name`` is empty.
  const canonicalSlug = owner.handle ?? owner.id;
  const canonical = `${siteUrl()}/u/${canonicalSlug}`;

  return {
    title: owner.name ? `${owner.name} — MyEtAl` : 'MyEtAl',
    description: owner.name
      ? `Collections published by ${owner.name} on MyEtAl.`
      : undefined,
    alternates: { canonical },
  };
}

export default async function ResearcherPage({ params }: PageProps) {
  const { slug } = await params;
  const [resolved, user] = await Promise.all([fetchOwner(slug), getCurrentUser()]);

  const base = siteUrl();
  // The page URL reflects what the visitor typed. The canonical URL
  // (set via generateMetadata's ``alternates.canonical``) is the
  // handle-or-id form; we don't 308-redirect.
  const pageUrl = `${base}/u/${slug}`;

  // QR endpoint is UUID-keyed on the API side
  // (``/public/u/{uuid}/qr.png``). The QR's encoded target URL is
  // assembled server-side and points to ``/u/{uuid}``, which still
  // resolves correctly after handles ship (the [slug] route accepts
  // both shapes). When the owner has a handle, the printed canonical
  // tag on the page points at the prettier URL for SEO purposes — the
  // QR itself stays UUID-keyed so caching and cross-printing remain
  // stable.
  const qrUrl = resolved?.ownerId
    ? `${API_BASE_URL}/public/u/${encodeURIComponent(resolved.ownerId)}/qr.png`
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {user ? <DashboardHeader user={user} /> : <AnonymousHeader />}

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        {resolved && qrUrl ? (
          <ResearcherPageContent
            data={resolved.data}
            pageUrl={pageUrl}
            qrUrl={qrUrl}
          />
        ) : (
          <SoftEmptyState />
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * Rendered for unknown slugs and for accounts the API won't surface. Soft on
 * purpose: this URL lives on printed business cards, so it must never
 * dead-end — and the copy must not confirm or deny that an account exists.
 */
function SoftEmptyState() {
  return (
    <div className="rounded-lg border border-rule bg-paper-soft p-8 text-center">
      <h1 className="font-serif text-2xl text-ink">Nothing published here yet</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
        When collections are published, this page will list them — check back
        soon, or explore what other researchers are sharing.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/browse"
          className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Browse collections
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
        >
          What is MyEtAl?
        </Link>
      </div>
    </div>
  );
}
