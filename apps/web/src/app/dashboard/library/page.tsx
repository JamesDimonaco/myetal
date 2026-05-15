import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';
import type { WorkResponse } from '@/types/works';

import { LibraryList } from './library-list';

export const metadata = { title: 'Library' };
export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  let works: WorkResponse[];
  let user: UserResponse;
  try {
    [works, user] = await Promise.all([
      serverFetch<WorkResponse[]>('/me/works', { cache: 'no-store' }),
      serverFetch<UserResponse>('/me', { cache: 'no-store' }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/library');
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Your library
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Papers you&apos;ve saved by DOI. Add papers here, then attach them
            to shares.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <LibraryList
          initialWorks={works}
          orcidId={user.orcid_id}
          lastOrcidSyncAt={user.last_orcid_sync_at}
        />
      </div>
    </div>
  );
}
