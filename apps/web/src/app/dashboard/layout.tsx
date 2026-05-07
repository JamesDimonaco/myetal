import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PostHogIdentify } from '@/components/posthog-identify';
import { SignOutButton } from '@/components/sign-out-button';
import { SiteFooter } from '@/components/site-footer';
import { UserAvatar } from '@/components/user-avatar';
import { ApiError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { UserResponse } from '@/types/auth';

/**
 * Authed shell: wraps every /dashboard/* page with the same header (wordmark,
 * nav, avatar). Server component — fetches /auth/me once per request so
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
              href="/dashboard/search"
              className="text-ink-muted hover:text-ink"
            >
              Search
            </Link>
            <Link
              href="/dashboard/feedback"
              className="text-ink-muted hover:text-ink"
            >
              Feedback
            </Link>
            <Link
              href="/dashboard/profile"
              className="transition hover:opacity-80"
              title={user.name ?? user.email ?? 'Profile'}
            >
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatar_url}
                size={32}
              />
            </Link>
            <SignOutButton className="text-ink-muted hover:text-ink" />
          </nav>
        </div>
      </header>
      <PostHogIdentify
        userId={user.id}
        email={user.email}
        name={user.name}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
