import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ShareList } from './share-list';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';
import type { ShareResponse } from '@/types/share';
import type { WorkResponse } from '@/types/works';

export const metadata = { title: 'Dashboard' };

// Authed reads must not be cached across users.
export const dynamic = 'force-dynamic';

/**
 * Owner dashboard. Server-fetches every share owned by the current user and
 * hands the list to a client component (<ShareList />) that owns the
 * interactive bits — show-QR modal, delete confirmation, query invalidation
 * on mutation.
 *
 * Why server-fetch when the client could just useQuery? Because the user is
 * already paying for SSR (we redirected them here from /sign-in) and the page
 * is more useful with content than with a spinner. The client list still uses
 * TanStack Query for refetches after mutations, seeded with the SSR result
 * via initialData.
 */
export default async function DashboardPage() {
  let shares: ShareResponse[];
  let user: UserResponse;
  let works: WorkResponse[] = [];
  try {
    // Pull shares + user + library count in parallel. Library count powers
    // the E1 / E3 empty-state copy. Failing the works fetch shouldn't take
    // the dashboard down — fall back to 0.
    const [sharesRes, userRes, worksRes] = await Promise.all([
      serverFetch<ShareResponse[]>('/shares', { cache: 'no-store' }),
      serverFetch<UserResponse>('/auth/me', { cache: 'no-store' }),
      serverFetch<WorkResponse[]>('/me/works', { cache: 'no-store' }).catch(
        () => [] as WorkResponse[],
      ),
    ]);
    shares = sharesRes;
    user = userRes;
    works = worksRes;
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard');
    }
    throw err;
  }

  const visibleWorks = works.filter((w) => w.hidden_at === null);
  const libraryCount = visibleWorks.length;
  // E1 — brand-new user with nothing in the system yet. Surface ORCID +
  // library entry points so they don't stare at an unguided empty page.
  const showWelcomeBanner =
    !user.orcid_id && shares.length === 0 && libraryCount === 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {showWelcomeBanner ? (
        <div
          role="status"
          className="mb-8 rounded-lg border border-accent/30 bg-accent-soft p-5"
        >
          <h2 className="font-serif text-lg text-ink">Welcome.</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Add your ORCID iD on your profile to auto-import your papers, or
            paste a DOI in your library to get started.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard/profile"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
            >
              Add ORCID
            </Link>
            <Link
              href="/dashboard/library"
              className="inline-flex items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              Open library
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Your shares
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Each share is one QR code — could be a single paper, a curated
            list, or a bundle of links.
          </p>
        </div>
        <Link
          href="/dashboard/share/new"
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          + New share
        </Link>
      </div>

      <div className="mt-10">
        <ShareList initialShares={shares} libraryCount={libraryCount} />
      </div>
    </div>
  );
}
