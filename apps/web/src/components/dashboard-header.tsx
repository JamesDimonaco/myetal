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
 *
 * Mobile: 5 nav links + avatar + sign-out won't fit at 375px, so the nav
 * collapses behind a hamburger `<details>` disclosure on small screens.
 * `<details>` is a no-JS HTML primitive — no client component needed, no
 * hydration cost. The avatar + sign-out stay visible in the bar so the most
 * common actions (profile, log out) don't require an extra tap. Desktop
 * (>=sm) renders the original horizontal nav unchanged.
 */
const NAV_LINK_CLASS = 'text-ink-muted hover:text-ink';

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Shares' },
  { href: '/dashboard/library', label: 'Library' },
  { href: '/browse', label: 'Browse' },
  { href: '/dashboard/search', label: 'Search' },
  { href: '/dashboard/feedback', label: 'Feedback' },
];

export function DashboardHeader({ user }: { user: UserResponse }) {
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link
          href="/dashboard"
          className="font-serif text-xl tracking-tight text-ink"
        >
          MyEtAl
        </Link>

        {/* Desktop nav — original layout, hidden on mobile */}
        <nav className="hidden items-center gap-6 text-sm sm:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={NAV_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
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
          <SignOutButton className="whitespace-nowrap text-ink-muted hover:text-ink" />
        </nav>

        {/* Mobile cluster — avatar always visible, nav links behind a
            hamburger disclosure. Sign-out lives inside the disclosure to
            free up bar real estate. */}
        <div className="flex items-center gap-2 sm:hidden">
          <Link
            href="/dashboard/profile"
            className="transition hover:opacity-80"
            title={user.name ?? user.email ?? 'Profile'}
          >
            <UserAvatar
              name={user.name}
              avatarUrl={user.avatar_url}
              size={36}
            />
          </Link>
          <details className="group relative">
            <summary
              aria-label="Menu"
              className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-rule bg-paper text-ink-muted transition hover:bg-paper-soft hover:text-ink [&::-webkit-details-marker]:hidden"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
                className="group-open:hidden"
              >
                <path
                  d="M3 5h12M3 9h12M3 13h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
                className="hidden group-open:block"
              >
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 overflow-hidden rounded-md border border-rule bg-paper shadow-lg">
              <nav className="flex flex-col py-1 text-sm">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="px-4 py-2.5 text-ink transition hover:bg-paper-soft"
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/dashboard/profile"
                  className="px-4 py-2.5 text-ink transition hover:bg-paper-soft"
                >
                  Profile
                </Link>
                <div className="my-1 border-t border-rule" />
                <SignOutButton className="px-4 py-2.5 text-left text-ink-muted transition hover:bg-paper-soft hover:text-ink" />
              </nav>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
