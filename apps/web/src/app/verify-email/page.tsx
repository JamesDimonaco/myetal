import Link from 'next/link';
import { Suspense } from 'react';

import { VerifyEmailRunner } from './verify-email-runner';

export const metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10 text-center"
    >
      <Link
        href="/sign-in"
        className="self-start text-sm text-ink-muted hover:text-ink"
      >
        &larr; Back to sign in
      </Link>

      <Suspense fallback={<div className="mt-8 text-sm text-ink-muted">Verifying…</div>}>
        <VerifyEmailRunner />
      </Suspense>
    </main>
  );
}
