'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setError(
        'No reset token in this URL. Request a fresh email from the forgot-password page.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (resetError) {
      setError(resetError.message ?? 'Could not reset password.');
      setSubmitting(false);
      return;
    }

    router.replace('/sign-in?reset=ok');
  }

  if (!token) {
    return (
      <div className="mt-8 rounded-md border border-danger/40 bg-danger/5 p-5 text-sm text-danger">
        No reset token in this URL. Request a fresh email from the{' '}
        <a
          href="/forgot-password"
          className="underline-offset-2 hover:underline"
        >
          forgot-password page
        </a>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-xs uppercase tracking-wider text-ink-muted">
          New password{' '}
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
          className="min-h-[44px] rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
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
        className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
