import Link from 'next/link';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10 sm:py-16"
    >
      <Link href="/sign-in" className="text-sm text-ink-muted hover:text-ink">
        &larr; Back to sign in
      </Link>

      <h1 className="mt-12 font-serif text-4xl tracking-tight text-ink">
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
