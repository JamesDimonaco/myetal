import Link from 'next/link';
import { Suspense } from 'react';

import { ResetPasswordForm } from './reset-password-form';

export const metadata = { title: 'Set a new password' };

export default function ResetPasswordPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10 sm:py-16"
    >
      <Link href="/sign-in" className="text-sm text-ink-muted hover:text-ink">
        &larr; Back to sign in
      </Link>

      <h1 className="mt-12 font-serif text-4xl tracking-tight text-ink">
        Set a new password
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Pick something at least 8 characters. You&apos;ll be signed in
        automatically.
      </p>

      <Suspense fallback={<div className="mt-8 h-32" />}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
