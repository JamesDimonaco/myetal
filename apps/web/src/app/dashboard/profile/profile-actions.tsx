'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Sign-out button. Hits our own /api/auth/logout (which revokes the refresh
 * token on the backend, then clears the cookies) and bounces home.
 */
export function ProfileActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) {
        setError(`sign-out failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Network error.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft disabled:opacity-60"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? (
        <span className="text-sm text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
