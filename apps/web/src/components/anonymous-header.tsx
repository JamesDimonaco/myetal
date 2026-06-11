import Link from 'next/link';

/**
 * Header for anonymous visitors on public pages (/browse, /u/[id]) —
 * wordmark + sign-in / sign-up CTAs. Signed-in visitors get
 * `DashboardHeader` instead; the page decides which to render.
 */
export function AnonymousHeader() {
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="font-serif text-xl tracking-tight text-ink">
          MyEtAl
        </Link>
        <nav className="flex items-center gap-2 text-sm sm:gap-6">
          <Link
            href="/sign-in"
            className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md px-2 hover:text-ink sm:px-3"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md bg-ink px-3 text-paper transition hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
