import Link from 'next/link';

import { SignUpForm } from './sign-up-form';

export const metadata = { title: 'Create an account' };

/**
 * Dedicated sign-up page. Pre-cutover comms email pointed testers at
 * this URL to re-create accounts post Better-Auth migration; we keep
 * it as a real page (not a redirect) so the link lands meaningfully.
 *
 * Existing users still see ``/sign-in`` for both flows; ``/sign-up``
 * is for the cutover-era "create my account" link in the comms email
 * and any future onboarding traffic.
 */
export default function SignUpPage() {
  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6 sm:py-16"
    >
      <Link href="/" className="inline-flex min-h-[40px] items-center text-sm text-ink-muted hover:text-ink">
        &larr; MyEtAl
      </Link>

      <h1 className="mt-8 font-serif text-3xl tracking-tight text-ink sm:mt-12 sm:text-4xl">
        Create an account
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Sign up with email and password. We&apos;ll send a verification link;
        you can use the app right away while you wait.
      </p>

      <SignUpForm />

      <p className="mt-6 text-sm text-ink-muted">
        Prefer Google, GitHub, or ORCID?{' '}
        <Link
          href="/sign-in"
          className="text-ink underline-offset-2 hover:underline"
        >
          Sign in here
        </Link>
        .
      </p>
    </main>
  );
}
