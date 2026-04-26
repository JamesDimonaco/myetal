import Link from 'next/link';

import { SignUpForm } from './sign-up-form';

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10 sm:py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← MyEtal
      </Link>

      <h1 className="mt-12 font-serif text-4xl tracking-tight text-ink">
        Create an account
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Email/password is minimal — no password reset, no email verification
        until v1.1. For research-grade auth, use ORCID (coming soon) or GitHub.
      </p>

      <SignUpForm />

      <p className="mt-10 text-xs text-ink-faint">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-ink underline-offset-2 hover:underline">
          Sign in
        </Link>
        .
      </p>
    </main>
  );
}
