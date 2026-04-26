import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ShareList } from './share-list';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { ShareResponse } from '@/types/share';

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
  try {
    shares = await serverFetch<ShareResponse[]>('/shares', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard');
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Your shares
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Each share is one QR code — could be a single paper, a curated
            list, or a poster bundle.
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
        <ShareList initialShares={shares} />
      </div>
    </div>
  );
}
