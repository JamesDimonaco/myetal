'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Active-state-aware sub-nav for /dashboard/admin/*.
 *
 * Server-rendered links are fine for nav, but the active-tab indicator
 * needs the current pathname, which is client-only. usePathname is
 * cheap (no fetch); the cost is one tiny client island below the
 * server-rendered shell.
 *
 * a11y: the outer <nav> carries an aria-label so screen readers can
 * distinguish this from the dashboard's main nav. Active link is
 * marked with aria-current="page".
 */
export function AdminSubNav({
  links,
}: {
  links: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard/admin') {
      // Exact match for the overview root so /admin/users doesn't
      // claim "Overview" as active.
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav aria-label="Admin sections" className="mt-2 flex flex-wrap gap-1 text-sm">
      {links.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'rounded-md px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active
                ? 'bg-paper-soft font-medium text-ink'
                : 'text-ink-muted hover:bg-paper-soft hover:text-ink',
            ].join(' ')}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
