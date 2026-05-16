import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type {
  AdminUserFilter,
  AdminUserListResponse,
  AdminUserSort,
} from '@/types/admin';

import { UsersList } from './users-list';

export const metadata = { title: 'Admin — Users' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  q?: string;
  filter?: AdminUserFilter;
  sort?: AdminUserSort;
  cursor?: string;
}>;

/**
 * Stage 2 entry point — searchable, filter-chip-able, paginated user
 * list. Server-fetches the first page so the user sees content rather
 * than a spinner; the client list owns the search debounce + filter
 * toggling + cursor-driven "load more".
 */
export default async function AdminUsersPage(props: {
  searchParams: SearchParams;
}) {
  const sp = await props.searchParams;
  const q = sp.q ?? '';
  const filter: AdminUserFilter = sp.filter ?? 'all';
  const sort: AdminUserSort = sp.sort ?? 'created_desc';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (filter !== 'all') params.set('filter', filter);
  if (sort !== 'created_desc') params.set('sort', sort);

  let page: AdminUserListResponse;
  try {
    page = await serverFetch<AdminUserListResponse>(
      `/admin/users${params.toString() ? `?${params}` : ''}`,
      { cache: 'no-store' },
    );
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin/users');
    }
    throw err;
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            Users
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Search, filter, and inspect any user.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          {page.total.toLocaleString()} total
        </p>
      </header>

      <UsersList
        initialPage={page}
        initialQuery={q}
        initialFilter={filter}
        initialSort={sort}
      />
    </div>
  );
}
