'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type State =
  | { kind: 'pending' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

/**
 * Calls Better Auth's GET /api/auth/verify-email?token=...
 *
 * BA's verification email links land here directly (its
 * ``sendVerificationEmail`` handler builds ``${baseURL}/verify-email?token=...``).
 * The page consumes the token, hits the BA endpoint, and bounces to
 * /dashboard on success. ``autoSignInAfterVerification: true`` on the
 * server means the session cookie is already set by the time we
 * redirect.
 */
export function VerifyEmailRunner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>({ kind: 'pending' });

  useEffect(() => {
    if (!token) {
      setState({
        kind: 'error',
        message: 'No verification token in this link.',
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const url = `/api/auth/verify-email?token=${encodeURIComponent(
          token,
        )}&callbackURL=${encodeURIComponent('/dashboard')}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok && res.status !== 302) {
          let msg = `Verification failed (${res.status}).`;
          try {
            const body = await res.json();
            if (typeof body?.message === 'string') msg = body.message;
          } catch {
            // ignore — keep status-based message
          }
          if (!cancelled) setState({ kind: 'error', message: msg });
          return;
        }
        if (cancelled) return;
        setState({ kind: 'ok' });
        router.replace('/dashboard');
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'unknown error',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (state.kind === 'pending' || state.kind === 'ok') {
    return (
      <div className="mt-8">
        <p className="font-serif text-xl text-ink">Verifying your email…</p>
        <p className="mt-2 text-sm text-ink-muted">One moment.</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <p className="text-xs uppercase tracking-widest text-danger">
        Verification failed
      </p>
      <p className="mt-3 font-serif text-xl text-ink">{state.message}</p>
      <a
        href="/sign-in"
        className="mt-6 inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-2 text-sm font-medium text-ink hover:border-ink/40"
      >
        Back to sign in
      </a>
    </div>
  );
}
