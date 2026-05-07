import Link from 'next/link';
import { Suspense } from 'react';

import { GitHubIcon } from '@/components/github-icon';
import { GoogleIcon } from '@/components/google-icon';
import { OrcidIcon } from '@/components/orcid-icon';

import { AuthEmailSection } from './auth-email-section';

/**
 * Unified auth page — OAuth-first, email/password secondary.
 *
 * OAuth buttons are prominent at the top. Below a divider, a collapsible
 * section offers email/password sign-in and account creation as a fallback.
 * `/sign-up` redirects here so both routes converge on a single page.
 */
export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10 sm:py-16"
    >
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        &larr; MyEtAl
      </Link>

      <h1 className="mt-12 font-serif text-4xl tracking-tight text-ink">
        Welcome to MyEtAl
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Share your research with a QR code.
      </p>

      {/* --- OAuth buttons (primary) --- */}
      <div className="mt-10 grid gap-3">
        <a
          href="/api/auth/google/start"
          className="inline-flex items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3.5 text-sm font-medium text-ink transition hover:border-ink/40"
        >
          <GoogleIcon size={18} />
          Continue with Google
        </a>
        <a
          href="/api/auth/github/start"
          className="inline-flex items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3.5 text-sm font-medium text-ink transition hover:border-ink/40"
        >
          <GitHubIcon size={18} />
          Continue with GitHub
        </a>
        <a
          href="/api/auth/orcid/start"
          className="inline-flex items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3.5 text-sm font-medium text-ink transition hover:border-ink/40"
        >
          <OrcidIcon size={18} />
          Continue with ORCID
        </a>
      </div>

      {/* --- Divider --- */}
      <div className="mt-8 flex items-center gap-3 text-xs uppercase tracking-widest text-ink-faint">
        <span className="h-px flex-1 bg-rule" />
        <span>or sign in / sign up with email</span>
        <span className="h-px flex-1 bg-rule" />
      </div>

      {/* --- Collapsible email/password section (client component) --- */}
      <Suspense fallback={<div className="mt-4 h-6" />}>
        <AuthEmailSection searchParamsPromise={searchParams} />
      </Suspense>
    </main>
  );
}
