'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signUpError } = await authClient.signUp.email({
      email,
      password,
      name: name.trim() || email.split('@')[0],
      callbackURL: '/dashboard',
    });

    if (signUpError) {
      setError(signUpError.message ?? 'Sign-up failed.');
      setSubmitting(false);
      return;
    }

    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink">
          Name <span className="lowercase text-ink-faint">(optional)</span>
        </span>
        <input
          type="text"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 sm:min-h-9 rounded-md border border-rule bg-paper px-3 py-2 sm:py-1.5 text-base sm:text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink">
          Email
        </span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 sm:min-h-9 rounded-md border border-rule bg-paper px-3 py-2 sm:py-1.5 text-base sm:text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink">
          Password <span className="lowercase text-ink-faint">(8+ chars)</span>
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
          className="min-h-11 sm:min-h-9 rounded-md border border-rule bg-paper px-3 py-2 sm:py-1.5 text-base sm:text-sm text-ink outline-none focus:border-accent"
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
        className="mt-1 inline-flex min-h-11 sm:min-h-9 items-center justify-center rounded-md bg-ink px-5 py-2 sm:py-1.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-70"
      >
        {submitting ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
