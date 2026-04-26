import Link from 'next/link';

export default function ShareNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-xs uppercase tracking-widest text-ink-faint">404</p>
      <h1 className="mt-4 font-serif text-4xl tracking-tight text-ink">
        Collection not found
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-ink-muted">
        We couldn&apos;t find a public collection with that code. Double-check
        the URL — short codes are case-sensitive.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-2.5 text-sm font-medium text-ink hover:border-ink/40"
      >
        Back to MyEtal
      </Link>
    </main>
  );
}
