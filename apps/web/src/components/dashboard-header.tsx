'use client';

import Link from 'next/link';

import { SignOutButton } from '@/components/sign-out-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
 * collapses behind a hamburger menu. The previous implementation used
 * `<details>/<summary>` which didn't close when a Link inside was tapped —
 * users complained that "it doesn't close nicely, I have to hit the x".
 * Migrated to Radix's DropdownMenu (via our shadcn-ui wrapper) which closes
 * on outside-click, Escape, AND when a `<DropdownMenuItem>` is activated.
 * Radix also wires aria-expanded / aria-haspopup / aria-controls on the
 * trigger so the menu is fully accessible.
 *
 * Now a client component because Radix uses portals + state. The page-level
 * layouts can stay RSC; the header just renders inline.
 */
const NAV_LINK_CLASS = 'text-ink-muted hover:text-ink';

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Shares' },
  { href: '/dashboard/library', label: 'Library' },
  { href: '/browse', label: 'Browse' },
  { href: '/dashboard/search', label: 'Search' },
  { href: '/dashboard/feedback', label: 'Feedback' },
];

// `Admin` is appended dynamically when `user.is_admin === true`. Web-only
// per the admin dashboard ticket's cross-stage acceptance (mobile hides
// the entry).
const ADMIN_LINK = { href: '/dashboard/admin', label: 'Admin' };

export function DashboardHeader({ user }: { user: UserResponse }) {
  const navLinks = user.is_admin ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;
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
          {navLinks.map((link) => (
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

        {/* Mobile cluster — avatar always visible, nav links behind a Radix
            DropdownMenu. Sign-out lives inside the menu to free up bar real
            estate. */}
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
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Menu"
              className="group inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-rule bg-paper text-ink-muted transition hover:bg-paper-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {/* Hamburger when closed, X when open. Radix sets
                  data-state="open"/"closed" on the trigger, so we toggle the
                  SVGs off that rather than a hand-rolled boolean. */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
                className="group-data-[state=open]:hidden"
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
                className="hidden group-data-[state=open]:block"
              >
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56">
              {navLinks.map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <Link href={link.href}>{link.label}</Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem asChild>
                <Link href="/dashboard/profile">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <SignOutButton className="w-full px-4 py-2.5 text-left text-ink-muted transition hover:text-ink" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
