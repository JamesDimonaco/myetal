'use client';

/**
 * Email/password sign-in. POSTs to our own /api/auth/login route handler
 * (which talks to the backend and sets the httpOnly cookies), then bounces
 * to `return_to` (default /dashboard).
 *
 * Open-redirect guard: only same-site paths starting with / and not //.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const ALLOWED_RETURN_PREFIXES = ['/dashboard', '/'];

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (!ALLOWED_RETURN_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/dashboard';
  }
  return raw;
}

export function SignInForm() {
  const router = useRouter();
  const search = useSearchParams();
  const returnTo = safeReturnTo(search.get('return_to'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `sign-in failed (${res.status})`);
        setSubmitting(false);
        return;
      }

      // router.refresh() makes any server components reading cookies
      // (e.g. /dashboard) re-render with the new session.
      router.replace(returnTo);
      router.refresh();
    } catch {
      setError('Network error — is the API up?');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
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

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 inline-flex items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
