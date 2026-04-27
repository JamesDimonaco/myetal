import Link from 'next/link';

/**
 * Minimal site-wide footer. Used on public pages and the dashboard layout.
 * Deliberately excluded from sign-in / sign-up pages to keep those distraction-free.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-4 sm:flex-row">
        <span className="text-xs text-ink-faint">&copy; 2026 MyEtAl</span>
        <nav className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
          <Link
            href="/privacy"
            className="hover:text-ink-muted hover:underline"
          >
            Privacy
          </Link>
          <span aria-hidden>&middot;</span>
          <Link href="/terms" className="hover:text-ink-muted hover:underline">
            Terms
          </Link>
          <span aria-hidden>&middot;</span>
          <a
            href="mailto:dimonaco.james@gmail.com"
            className="hover:text-ink-muted hover:underline"
          >
            Support
          </a>
          <span aria-hidden>&middot;</span>
          <a
            href="https://github.com/JamesDimonaco/myetal"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink-muted hover:underline"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
