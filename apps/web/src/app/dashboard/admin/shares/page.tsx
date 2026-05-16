import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type {
  AdminShareFilter,
  AdminShareListResponse,
  AdminShareSort,
} from '@/types/admin';

import { SharesList } from './shares-list';

export const metadata = { title: 'Admin — Shares' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  q?: string;
  filter?: AdminShareFilter;
  type?: string;
  age?: string;
  sort?: AdminShareSort;
  cursor?: string;
}>;

/**
 * Stage 3 entry point — searchable, filter-chip-able, paginated share
 * list. Same shape as the Stage 2 users list; first-page is
 * server-fetched so admins see content immediately.
 */
export default async function AdminSharesPage(props: {
  searchParams: SearchParams;
}) {
  const sp = await props.searchParams;
  const q = sp.q ?? '';
  const filter: AdminShareFilter = sp.filter ?? 'all';
  const type = sp.type ?? '';
  const age = sp.age ?? 'all';
  const sort: AdminShareSort = sp.sort ?? 'created_desc';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (filter !== 'all') params.set('filter', filter);
  if (type) params.set('type', type);
  if (age !== 'all') params.set('age', age);
  if (sort !== 'created_desc') params.set('sort', sort);

  let page: AdminShareListResponse;
  try {
    page = await serverFetch<AdminShareListResponse>(
      `/admin/shares${params.toString() ? `?${params}` : ''}`,
      { cache: 'no-store' },
    );
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin/shares');
    }
    throw err;
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Shares
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Find any share by short code, owner, DOI, or tag. Tombstone,
            restore, unpublish, or rebuild precompute.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          {page.total.toLocaleString()} total
        </p>
      </header>

      <SharesList
        initialPage={page}
        initialQuery={q}
        initialFilter={filter}
        initialType={type}
        initialAge={age}
        initialSort={sort}
      />
    </div>
  );
}
