import Link from 'next/link';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6 sm:py-16"
    >
      <Link href="/sign-in" className="inline-flex min-h-[40px] items-center text-sm text-ink-muted hover:text-ink">
        &larr; Back to sign in
      </Link>

      <h1 className="mt-8 font-serif text-3xl tracking-tight text-ink sm:mt-12 sm:text-4xl">
        Reset your password
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Enter the email you signed up with. We&apos;ll send a reset link if an
        account exists.
      </p>

      <ForgotPasswordForm />
    </main>
  );
}
