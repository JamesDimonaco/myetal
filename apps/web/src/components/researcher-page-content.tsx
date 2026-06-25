import Link from 'next/link';

import { CopyPageLink } from '@/components/copy-page-link';
import { OrcidIcon } from '@/components/orcid-icon';
import { ShareCard } from '@/components/share-card';
import { UserAvatar } from '@/components/user-avatar';
import type { BrowseResponse } from '@/types/share';

/**
 * Renders the body of ``/u/{slug}`` once a valid owner has been resolved.
 *
 * Extracted from the old ``/u/[id]/page.tsx`` so the consolidated route
 * file stays a thin shell over resolution + canonical-URL logic. Single
 * source of truth for the page layout means the UUID-shape resolution
 * and the handle-shape resolution can't drift visually.
 *
 * ``isOwner`` is set by the route when the currently-signed-in user's
 * id matches the page owner's id. It unlocks two affordances that are
 * inappropriate for visitors but obvious for the owner: a "+ New
 * share" button next to the shares grid (non-empty view), and a
 * "Create your first share" primary CTA in the empty-state (otherwise
 * the owner lands on their own page with no path forward).
 */
interface Props {
  data: BrowseResponse;
  pageUrl: string;
  qrUrl: string;
  isOwner: boolean;
}

export function ResearcherPageContent({ data, pageUrl, qrUrl, isOwner }: Props) {
  // ``data.owner`` is guaranteed by the caller (the route renders the
  // soft empty state when owner is null) — assert it locally so the
  // rest of the component can stop juggling the optional.
  const owner = data.owner!;
  // Backend convention: with an owner_id filter or by-handle resolution,
  // results arrive in the ``recent`` slot and ``trending`` stays empty.
  const shares = data.recent;
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
          isOwner ? (
            // Owner-on-empty: friendly nudge + a clear path to fixing the
            // emptiness. Without this the owner sees an empty page about
            // themselves and has to navigate back to /dashboard manually.
            <div className="rounded-lg border border-rule bg-paper-soft p-8 text-center">
              <p className="text-sm text-ink-muted">
                Nothing published here yet. Your researcher page lists every
                share you publish — start with one.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/dashboard/share/new"
                  className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
                >
                  Create your first share
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-[44px] items-center rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  Back to dashboard
                </Link>
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-ink-muted">
              Nothing published yet — collections will appear here as soon as
              they go live.
            </p>
          )
        ) : (
          <>
            {isOwner ? (
              // Non-empty owner view: a subtle "+ New share" sitting above
              // the grid so the owner can extend their public page without
              // navigating away. Hidden for visitors.
              <div className="mb-4 flex justify-end">
                <Link
                  href="/dashboard/share/new"
                  className="inline-flex min-h-[44px] items-center rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  + New share
                </Link>
              </div>
            ) : null}
            <div className="grid gap-4">
              {shares.map((share) => (
                <ShareCard key={share.short_code} result={share} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
