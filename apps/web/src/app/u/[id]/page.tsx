import type { Metadata } from 'next';
import Link from 'next/link';

import { AnonymousHeader } from '@/components/anonymous-header';
import { DashboardHeader } from '@/components/dashboard-header';
import { OrcidIcon } from '@/components/orcid-icon';
import { ShareCard } from '@/components/share-card';
import { SiteFooter } from '@/components/site-footer';
import { UserAvatar } from '@/components/user-avatar';
import { API_BASE_URL, ApiError, api } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';
import type { BrowseResponse } from '@/types/share';

import { CopyPageLink } from './copy-page-link';

/**
 * Researcher page — one permanent URL + QR per researcher (`/u/{id}`), for
 * the business card, the email signature, the title slide. The lightweight
 * v1 of discovery-and-handles-future: keyed on the user UUID, no handle
 * migration (URL aesthetics don't matter inside a QR code). When real
 * handles ship, `/u/{handle}` joins and this route keeps resolving so
 * already-printed QRs never break.
 *
 * Data comes from `/public/browse?owner_id=` (owner card + published shares
 * in the `recent` slot). A 404 — unknown id OR a user the API won't surface
 * — renders a SOFT empty state (never a dead-end, never confirms or denies
 * an account's existence).
 */

type PageProps = { params: Promise<{ id: string }> };

const FETCH_OPTIONS = { next: { revalidate: 300 } };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchOwnerShares(id: string): Promise<BrowseResponse | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    return await api<BrowseResponse>(
      `/public/browse?owner_id=${encodeURIComponent(id)}&sort=recent`,
      FETCH_OPTIONS,
    );
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchOwnerShares(id);
  if (!data?.owner?.name) return { title: 'MyEtAl' };
  return {
    title: `${data.owner.name} — MyEtAl`,
    description: `Collections published by ${data.owner.name} on MyEtAl.`,
  };
}

export default async function ResearcherPage({ params }: PageProps) {
  const { id } = await params;
  const [data, user] = await Promise.all([fetchOwnerShares(id), getCurrentUser()]);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myetal.app').replace(/\/$/, '');
  const pageUrl = `${siteUrl}/u/${id}`;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {user ? <DashboardHeader user={user} /> : <AnonymousHeader />}

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        {data?.owner ? (
          <ResearcherBody data={data} pageUrl={pageUrl} userId={id} />
        ) : (
          <SoftEmptyState />
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function ResearcherBody({
  data,
  pageUrl,
  userId,
}: {
  data: BrowseResponse;
  pageUrl: string;
  userId: string;
}) {
  const owner = data.owner!;
  // Backend convention: with an owner_id filter, results arrive in the
  // `recent` slot and `trending` stays empty.
  const shares = data.recent;
  const qrUrl = `${API_BASE_URL}/public/u/${encodeURIComponent(userId)}/qr.png`;
  const displayUrl = pageUrl.replace(/^https?:\/\//, '');

  return (
    <>
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
        <UserAvatar name={owner.name} avatarUrl={owner.avatar_url} size={64} />
        <div>
          <h1 className="break-words font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            {owner.name ?? 'Researcher'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-ink-muted sm:justify-start">
            <span>
              {owner.share_count}{' '}
              {owner.share_count === 1 ? 'published collection' : 'published collections'}
            </span>
            {owner.orcid_id ? (
              <a
                href={`https://orcid.org/${owner.orcid_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 underline-offset-2 transition hover:text-ink hover:underline"
              >
                <OrcidIcon size={16} />
                {owner.orcid_id}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="mt-10 rounded-lg border border-rule bg-paper-soft p-5">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:justify-between sm:gap-6 sm:text-left">
          <div>
            <p className="font-serif text-lg text-ink">
              One QR for everything published here
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Put it on your slides, poster corner, or business card — it
              always points to the latest collections.
            </p>
            <p className="mt-2 break-all font-mono text-sm text-ink">
              {displayUrl}
            </p>
            <div className="mt-4">
              <CopyPageLink url={pageUrl} />
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt={`QR code for ${owner.name ?? 'this researcher'}'s page`}
            width={144}
            height={144}
            className="h-36 w-36 shrink-0 rounded-md border border-rule bg-white p-2"
          />
        </div>
      </aside>

      <section className="mt-10">
        {shares.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            Nothing published yet — collections will appear here as soon as
            they go live.
          </p>
        ) : (
          <div className="grid gap-4">
            {shares.map((share) => (
              <ShareCard key={share.short_code} result={share} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Rendered for unknown ids and for accounts the API won't surface. Soft on
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
