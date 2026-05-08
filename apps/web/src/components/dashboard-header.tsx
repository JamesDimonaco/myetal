import Link from 'next/link';

import { SignOutButton } from '@/components/sign-out-button';
import { UserAvatar } from '@/components/user-avatar';
import type { UserResponse } from '@/types/auth';

/**
 * Shared authed header chrome — used by `/dashboard/layout.tsx` and by
 * `/browse/page.tsx` when the visitor is signed in. Keeping the nav identical
 * across surfaces means an authed user landing on `/browse` doesn't lose
 * `Library`, `Search`, `Feedback` etc. (W-FIX-3).
 *
 * The wordmark links to `/dashboard` for authed users (precedent: the
 * dashboard layout's wordmark already does this).
 */
export function DashboardHeader({ user }: { user: UserResponse }) {
  return (
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
          <Link href="/browse" className="text-ink-muted hover:text-ink">
            Browse
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
  );
}
