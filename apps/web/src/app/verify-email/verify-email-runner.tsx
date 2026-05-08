'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type State = { kind: 'redirecting' } | { kind: 'no-token' };

/**
 * Triggers Better Auth's GET /api/auth/verify-email?token=...
 *
 * BA's verification email links land here directly (its
 * ``sendVerificationEmail`` handler builds ``${baseURL}/verify-email?token=...``).
 *
 * Phase 6 simplification: instead of an ``await fetch(url)`` and an
 * ``if (res.ok)`` check (which was fragile — BA returns the verification
 * result via 302 chain, not a 2xx body), we just hand the URL off to the
 * browser via ``window.location.assign``. BA's natural redirect behaviour
 * applies: success → ``callbackURL``, failure → its own error page with the
 * specific reason. ``autoSignInAfterVerification: true`` on the server means
 * the session cookie is already set by the time we land on /dashboard.
 *
 * The "no-token" branch is the only state this component renders directly;
 * everything else is the browser following the BA redirect.
 */
export function VerifyEmailRunner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'redirecting' } : { kind: 'no-token' },
  );

  useEffect(() => {
    if (!token) {
      setState({ kind: 'no-token' });
      return;
    }
    const url = `/api/auth/verify-email?token=${encodeURIComponent(
      token,
    )}&callbackURL=${encodeURIComponent('/dashboard')}`;
    // Hand off to the browser — BA's verify-email endpoint emits a 302 to
    // ``callbackURL`` on success or to its built-in error page on failure.
    // No JS-driven status parsing; the browser does the right thing.
    window.location.assign(url);
  }, [token]);

  if (state.kind === 'redirecting') {
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
      <p className="mt-3 font-serif text-xl text-ink">
        No verification token in this link.
      </p>
      <a
        href="/sign-in"
        className="mt-6 inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-2 text-sm font-medium text-ink hover:border-ink/40"
      >
        Back to sign in
      </a>
    </div>
  );
}
