'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SignUpForm() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `sign-up failed (${res.status})`);
        setSubmitting(false);
        return;
      }

      router.replace('/dashboard');
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
          Name <span className="lowercase text-ink-faint">(optional)</span>
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
        {submitting ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
