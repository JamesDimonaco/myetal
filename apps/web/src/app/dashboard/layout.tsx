import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SiteFooter } from '@/components/site-footer';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

/**
 * Authed shell: wraps every /dashboard/* page with the same header (wordmark,
 * nav, profile link). Server component — fetches /auth/me once per request so
 * the header can show a name/email without each child page re-doing it.
 *
 * If /auth/me 401s (cookie expired between proxy redirect and SSR), we bounce
 * back to /sign-in. The proxy already does the same check at the edge for the
 * UX-shortcut case; this is the defence-in-depth pass.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: UserResponse;
  try {
    user = await serverFetch<UserResponse>('/auth/me', { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) {
      redirect('/sign-in?return_to=/dashboard');
    }
    throw err;
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="font-serif text-xl tracking-tight text-ink"
          >
            MyEtAl
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-ink-muted hover:text-ink">
              Shares
            </Link>
            <Link
              href="/dashboard/library"
              className="text-ink-muted hover:text-ink"
            >
              Library
            </Link>
            <Link
              href="/dashboard/profile"
              className="text-ink-muted hover:text-ink"
            >
              {user.name ?? user.email ?? 'Profile'}
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
