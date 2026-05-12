import Link from 'next/link';
import { Suspense } from 'react';

import { VerifyEmailRunner } from './verify-email-runner';

export const metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-8 text-center sm:px-6 sm:py-10"
    >
      <Link
        href="/sign-in"
        className="inline-flex min-h-[40px] items-center self-start text-sm text-ink-muted hover:text-ink"
      >
        &larr; Back to sign in
      </Link>

      <Suspense fallback={<div className="mt-8 text-sm text-ink-muted">Verifying…</div>}>
        <VerifyEmailRunner />
      </Suspense>
    </main>
  );
}
