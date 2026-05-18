import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';
import type { AdminUserDetail } from '@/types/admin';

import { UserActions } from './user-actions';
import { UserTabs } from './user-tabs';

export const metadata = { title: 'Admin — User' };
export const dynamic = 'force-dynamic';

/**
 * Stage 2 detail page. Server-fetches the full detail payload + the
 * acting admin's identity (the latter so the right-rail actions can
 * disable the self-toggle button without a separate roundtrip).
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: AdminUserDetail;
  let me: UserResponse;
  try {
    [detail, me] = await Promise.all([
      serverFetch<AdminUserDetail>(`/admin/users/${id}`, { cache: 'no-store' }),
      serverFetch<UserResponse>('/me', { cache: 'no-store' }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) {
      notFound();
    }
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect(`/sign-in?return_to=/dashboard/admin/users/${id}`);
    }
    throw err;
  }

  const isSelf = me.id === detail.id;

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard/admin/users"
          className="text-xs text-ink-muted hover:text-ink"
        >
          ← All users
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
              {detail.name || detail.email || 'unknown'}
            </h1>
            {detail.is_admin ? (
              <span className="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Admin
              </span>
            ) : null}
            {detail.deleted_at ? (
              <span className="rounded-sm bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                Deleted
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {detail.email}
            {detail.orcid_id ? ` · ORCID ${detail.orcid_id}` : ''}
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_280px]">
        {/* Main column: sidebar facts + tabs */}
        <div className="min-w-0">
          <section className="grid gap-4 sm:grid-cols-2">
            <FactCard label="Created">
              {formatRelativeTime(detail.created_at)}
            </FactCard>
            <FactCard label="Last sign-in">
              {detail.last_seen_at
                ? formatRelativeTime(detail.last_seen_at)
                : 'never'}
              {detail.last_sign_in_ip ? (
                <span className="ml-2 text-xs text-ink-faint">
                  from {detail.last_sign_in_ip}
                </span>
              ) : null}
            </FactCard>
            <FactCard label="Email verified">
              {detail.email_verified ? 'Yes' : 'No'}
            </FactCard>
            <FactCard label="Sessions">
              {detail.session_count.toString()}
            </FactCard>
            <FactCard label="Providers">
              {detail.providers.length === 0
                ? '—'
                : detail.providers.join(', ')}
            </FactCard>
            <FactCard label="Library">
              {`${detail.library_paper_count} paper${detail.library_paper_count === 1 ? '' : 's'}`}
              {detail.last_orcid_sync_at ? (
                <span className="ml-2 text-xs text-ink-faint">
                  · last ORCID sync {formatRelativeTime(detail.last_orcid_sync_at)}
                </span>
              ) : null}
            </FactCard>
          </section>

          <section className="mt-8">
            <UserTabs detail={detail} />
          </section>
        </div>

        {/* Right rail: actions */}
        <aside className="lg:sticky lg:top-6">
          <UserActions detail={detail} isSelf={isSelf} />
        </aside>
      </div>
    </div>
  );
}

function FactCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{children}</p>
    </div>
  );
}
