import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import { DemoTour } from './demo-tour';

export const metadata = {
  title: 'Demo',
  description:
    'A live, no-signup tour of MyEtAl. Edit a fake share on the left, watch the public scan view and QR update on the right.',
};

/**
 * Static-ish marketing tour of the product. Server-rendered shell with a
 * client island (<DemoTour />) that owns the editable preview and live QR.
 *
 * Nothing here hits the API — the QR encodes a fake URL, the preview is
 * hand-rendered to match /c/[code]. So it never 404s, never depends on the
 * dev DB having a "demo" share, and is safe to link from the landing page.
 */
export default function DemoPage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl overflow-hidden px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          ← MyEtAl
        </Link>
        <Link
          href="/sign-in"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Get started
        </Link>
      </div>

      <section className="mt-12 max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-ink-faint">
          Live demo · nothing is saved
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Build a share. See the QR.
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-muted">
          This is what your visitors see when they scan one of your QR codes.
          Edit the share on the left — the public page and the QR update as
          you type. When you&apos;re ready,{' '}
          <Link href="/sign-in" className="text-ink underline-offset-2 hover:underline">
            sign in
          </Link>{' '}
          to make a real one.
        </p>
      </section>

      <div className="mt-12">
        <DemoTour />
      </div>

      <section className="mt-20 border-t border-rule pt-12">
        <h2 className="font-serif text-2xl tracking-tight text-ink">
          What happens when you sign in?
        </h2>
        <ol className="mt-6 grid gap-6 text-sm leading-relaxed text-ink-muted sm:grid-cols-3">
          <li>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              01
            </span>
            <p className="mt-2 font-serif text-base text-ink">Add a paper</p>
            <p className="mt-1">
              Paste a DOI, search by title, or fill it in by hand. Crossref and
              OpenAlex do the rest.
            </p>
          </li>
          <li>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              02
            </span>
            <p className="mt-2 font-serif text-base text-ink">Get a QR</p>
            <p className="mt-1">
              Each share gets a permanent short URL and a printable PNG.
              Stick it on a poster, a slide, or your CV.
            </p>
          </li>
          <li>
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              03
            </span>
            <p className="mt-2 font-serif text-base text-ink">Edit any time</p>
            <p className="mt-1">
              The QR points at a short code, not a fixed URL. Update the
              share later — the same code keeps working.
            </p>
          </li>
        </ol>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Create your first share
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
          >
            I have an account
          </Link>
        </div>
      </section>

      <div className="mt-20">
        <SiteFooter />
      </div>
    </main>
  );
}
