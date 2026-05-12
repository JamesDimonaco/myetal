import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
      <p className="text-xs uppercase tracking-widest text-ink-faint">404</p>
      <h1 className="mt-4 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-ink-muted">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink/20 px-5 py-2.5 text-sm font-medium text-ink hover:border-ink/40"
        >
          Back to MyEtAl
        </Link>
        <Link
          href="/dashboard/search"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Try searching for it
        </Link>
      </div>
    </main>
  );
}
