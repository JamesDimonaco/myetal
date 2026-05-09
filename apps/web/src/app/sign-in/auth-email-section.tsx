'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

const ALLOWED_RETURN_PREFIXES = ['/dashboard', '/'];

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (!ALLOWED_RETURN_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/dashboard';
  }
  return raw;
}

type Tab = 'sign-in' | 'create-account';

/**
 * Email/password auth section — Better Auth client helpers.
 *
 * Sign-in calls ``authClient.signIn.email``; sign-up calls
 * ``authClient.signUp.email``. Both surface BA's structured error
 * messages in the form's error region.
 */
export function AuthEmailSection({
  searchParamsPromise: _searchParamsPromise,
}: {
  searchParamsPromise: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = safeReturnTo(searchParams.get('return_to'));

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('sign-in');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
      callbackURL: returnTo,
    });

    if (signInError) {
      setError(signInError.message ?? 'Sign-in failed.');
      setSubmitting(false);
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  async function handleCreateAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signUpError } = await authClient.signUp.email({
      email,
      password,
      // BA requires `name` on email sign-up; default to email-localpart
      // for users who skip the optional field.
      name: name.trim() || email.split('@')[0],
      callbackURL: returnTo,
    });

    if (signUpError) {
      setError(signUpError.message ?? 'Sign-up failed.');
      setSubmitting(false);
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-4 text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Sign in with email
      </button>
    );
  }

  return (
    <div className="mt-4">
      {/* Tabs */}
      <div className="flex gap-4 border-b border-rule text-sm">
        <button
          type="button"
          onClick={() => {
            setTab('sign-in');
            setError(null);
          }}
          className={`pb-2 transition ${
            tab === 'sign-in'
              ? 'border-b-2 border-ink font-medium text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('create-account');
            setError(null);
          }}
          className={`pb-2 transition ${
            tab === 'create-account'
              ? 'border-b-2 border-ink font-medium text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Create account
        </button>
      </div>

      {/* Sign-in tab */}
      {tab === 'sign-in' && (
        <form onSubmit={handleSignIn} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
            />
          </label>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-xs text-ink-faint">
            <a
              href="/forgot-password"
              className="text-ink underline-offset-2 hover:underline"
            >
              Forgot your password?
            </a>
          </p>

          <p className="text-xs text-ink-faint">
            New here?{' '}
            <button
              type="button"
              onClick={() => {
                setTab('create-account');
                setError(null);
              }}
              className="text-ink underline-offset-2 hover:underline"
            >
              Create an account
            </button>
          </p>
        </form>
      )}

      {/* Create-account tab */}
      {tab === 'create-account' && (
        <form onSubmit={handleCreateAccount} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Name{' '}
              <span className="lowercase text-ink-faint">(optional)</span>
            </span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              Password{' '}
              <span className="lowercase text-ink-faint">(8+ chars)</span>
            </span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
            />
          </label>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 inline-flex items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>

          <p className="text-xs text-ink-faint">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                setTab('sign-in');
                setError(null);
              }}
              className="text-ink underline-offset-2 hover:underline"
            >
              Sign in
            </button>
            . We&apos;ll email you a verification link — verifying is optional
            for now.
          </p>
        </form>
      )}
    </div>
  );
}
