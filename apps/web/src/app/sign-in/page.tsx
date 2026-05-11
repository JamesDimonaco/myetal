import Link from 'next/link';
import { Suspense } from 'react';

import { AuthEmailSection } from './auth-email-section';
import { OAuthButtons } from './oauth-buttons';

const ORCID_HIJACK_ERROR_CODES = new Set([
  'orcid_already_linked',
  'OrcidIdAlreadyLinkedError',
]);

function pickFirst(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function describeError(code: string | null): string | null {
  if (!code) return null;
  if (ORCID_HIJACK_ERROR_CODES.has(code)) {
    return 'This ORCID iD is already linked to another account. Sign in with that account instead.';
  }
  // Common BA error codes worth surfacing in plain English. Anything
  // we don't recognise gets shown raw — better than silent.
  switch (code) {
    case 'invalid_credentials':
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Email or password is incorrect.';
    case 'user_already_exists':
    case 'USER_ALREADY_EXISTS':
      return 'An account with that email already exists.';
    case 'account_not_linked':
    case 'ACCOUNT_NOT_LINKED':
      return 'That email is already in use under a different sign-in method.';
    default:
      return code.replace(/_/g, ' ');
  }
}

/**
 * Unified auth page — OAuth-first, email/password secondary.
 *
 * OAuth buttons sit at the top. Below a divider, a collapsible section
 * offers email/password sign-in and account creation as a fallback.
 * ``/sign-up`` redirects here so both routes converge.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = pickFirst(params.return_to);
  const errorCode = pickFirst(params.error);
  const errorMessage = describeError(errorCode);

  return (
    <main
      data-ph-no-capture
      className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6 sm:py-16"
    >
      <Link href="/" className="inline-flex min-h-[40px] items-center text-sm text-ink-muted hover:text-ink">
        &larr; MyEtAl
      </Link>

      <h1 className="mt-8 font-serif text-3xl tracking-tight text-ink sm:mt-12 sm:text-4xl">
        Welcome to MyEtAl
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Share your research with a QR code.
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {errorMessage}
        </p>
      ) : null}

      {/* --- OAuth buttons (primary, client component) --- */}
      <OAuthButtons returnTo={returnTo} />

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
