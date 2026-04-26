import Link from 'next/link';
import { Suspense } from 'react';

import { SignInForm } from './sign-in-form';

/**
 * Sign-in shell — server component for layout, hands the form (with its
 * useState / fetch) off to a client component. OAuth buttons sit underneath:
 * GitHub and Google are wired; ORCID shows as disabled "Coming soon" so the
 * academic audience can see we're not pretending it doesn't exist.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10 sm:py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← MyEtal
      </Link>

      <h1 className="mt-12 font-serif text-4xl tracking-tight text-ink">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Manage your shares, generate QR codes, see who&apos;s scanning.
      </p>

      <Suspense fallback={<div className="mt-8 h-48" />}>
        <SignInForm />
      </Suspense>

      <div className="mt-8 flex items-center gap-3 text-xs uppercase tracking-widest text-ink-faint">
        <span className="h-px flex-1 bg-rule" />
        <span>or</span>
        <span className="h-px flex-1 bg-rule" />
      </div>

      <div className="mt-6 grid gap-3">
        <a
          href="/api/auth/github/start"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
        >
          <span aria-hidden>{'{ }'}</span>
          Continue with GitHub
        </a>
        <button
          type="button"
          disabled
          title="Coming soon — ORCID app is in registration"
          className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-md border border-rule bg-paper-soft px-5 py-3 text-sm font-medium text-ink-faint"
        >
          Continue with ORCID
          <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
            soon
          </span>
        </button>
        <a
          href="/api/auth/google/start"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40"
        >
          <span aria-hidden>G</span>
          Continue with Google
        </a>
      </div>

      <p className="mt-10 text-xs text-ink-faint">
        No account?{' '}
        <Link href="/sign-up" className="text-ink underline-offset-2 hover:underline">
          Create one
        </Link>
        . Email/password is minimal — no password reset until v1.1.
      </p>
    </main>
  );
}
