import Link from 'next/link';

/**
 * Marketing landing. Pure server-rendered, no JS shipped beyond Next's tiny
 * runtime. Two CTAs: sign in (real) and "try the demo" which links to a
 * hardcoded short_code (DEMO_SHORT_CODE) — once a real demo collection
 * exists in the dev DB we'll point this at it; for now it lets the layout
 * exercise the public viewer.
 */

const DEMO_SHORT_CODE = process.env.NEXT_PUBLIC_DEMO_SHORT_CODE ?? 'demo';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10 sm:py-16">
      <header className="flex items-center justify-between">
        <span className="font-serif text-xl tracking-tight text-ink">Ceteris</span>
        <nav className="text-sm text-ink-muted">
          <Link
            href="/sign-in"
            className="rounded-md px-3 py-1.5 hover:text-ink"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <section className="mt-16 sm:mt-28">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-ink sm:text-6xl">
          Share your research with a QR.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
          A paper. A reading list. A poster you&apos;re standing in front of.
          One QR code that resolves to a clean, shareable page — works whether
          the scanner has the app or not.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            href={`/c/${DEMO_SHORT_CODE}`}
            className="inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
          >
            Try the demo
          </Link>
        </div>
      </section>

      <section className="mt-24 grid gap-8 sm:mt-32 sm:grid-cols-3">
        <Feature
          title="One QR, many papers"
          body="A share is the unit on a QR — one paper or a curated collection. Same flow, same code."
        />
        <Feature
          title="No app required"
          body="Scanned by someone without the app? They land on a fast, server-rendered web page."
        />
        <Feature
          title="ORCID-aware"
          body="Sign in with ORCID, Google, GitHub, or email. Built for the people who actually publish papers."
        />
      </section>

      <footer className="mt-auto pt-24 text-xs text-ink-faint">
        <div className="flex flex-wrap items-center gap-4">
          <span>Ceteris paribus.</span>
          <span aria-hidden>·</span>
          <span>v0.1 dev</span>
        </div>
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-serif text-lg text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}
