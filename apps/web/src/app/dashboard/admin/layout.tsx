import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

import { AdminSubNav } from './admin-sub-nav';

/**
 * Admin section layout — wraps every `/dashboard/admin/*` page with a
 * compact sub-nav (Overview / Users / Reports). Per
 * `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 1 + 2.
 *
 * Server-side admin gating is the source of truth — the API's
 * `/admin/*` endpoints already 403 non-admins, so a hostile direct hit
 * gets nothing. This layout also performs a `/me` probe so we redirect
 * away from the page entirely if the user isn't admin; the alternative
 * (let the page render then watch every child 403) is uglier.
 *
 * Mobile note: admin pages are intentionally web-only per the ticket's
 * cross-stage acceptance. The mobile app hides the entry; this layout
 * still works on a phone (the nav is horizontally scrollable) but isn't
 * the target platform.
 */
export const dynamic = 'force-dynamic';

const ADMIN_NAV: Array<{ href: string; label: string }> = [
  { href: '/dashboard/admin', label: 'Overview' },
  { href: '/dashboard/admin/users', label: 'Users' },
  { href: '/dashboard/admin/reports', label: 'Reports' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: UserResponse;
  try {
    user = await serverFetch<UserResponse>('/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard/admin');
    }
    throw err;
  }

  if (!user.is_admin) {
    redirect('/dashboard');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="border-b border-rule pb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Admin
        </p>
        <AdminSubNav links={ADMIN_NAV} />
      </div>
      <div className="mt-8">{children}</div>
    </div>
  );
}
