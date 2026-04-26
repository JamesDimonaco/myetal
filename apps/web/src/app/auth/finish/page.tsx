'use client';

/**
 * The backend's OAuth callback redirects here with the JWT pair in the URL
 * fragment. Fragment is server-invisible, so the access token never appears
 * in API logs. We:
 *
 *   1. Pull access_token, refresh_token, return_to (and optional `error`)
 *      out of `window.location.hash` synchronously on first render.
 *   2. POST those to /api/auth/cookie-set, which sets httpOnly cookies.
 *   3. router.replace(return_to) so the back button doesn't re-trigger this.
 *
 * The fragment lifetime is one navigation. As soon as cookie-set returns,
 * the tokens are gone from anywhere JS can see them.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

function parseFragment(hash: string): Record<string, string> {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  return Object.fromEntries(new URLSearchParams(trimmed));
}

const ALLOWED_RETURN_PREFIXES = ['/dashboard', '/'];

function safeReturnTo(raw: string | undefined): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (!ALLOWED_RETURN_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/dashboard';
  }
  return raw;
}

export default function AuthFinishPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const params = parseFragment(window.location.hash);

    if (params.error) {
      setState({ kind: 'error', message: params.error });
      // Clear the fragment regardless — leaves a clean URL even on error.
      history.replaceState(null, '', window.location.pathname);
      return;
    }

    const access = params.access_token;
    const refresh = params.refresh_token;
    const returnTo = safeReturnTo(params.return_to);

    if (!access || !refresh) {
      setState({ kind: 'error', message: 'missing tokens in callback' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/cookie-set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: access, refresh_token: refresh }),
        });
        if (!res.ok) throw new Error(`cookie-set failed: ${res.status}`);

        // Strip the fragment immediately — even though the cookie is set, we
        // don't want a hash with bearer tokens sitting in the address bar.
        history.replaceState(null, '', window.location.pathname);

        if (cancelled) return;
        setState({ kind: 'done' });
        router.replace(returnTo);
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
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      {state.kind === 'loading' || state.kind === 'done' ? (
        <>
          <p className="font-serif text-xl text-ink">Signing you in…</p>
          <p className="mt-2 text-sm text-ink-muted">One moment.</p>
        </>
      ) : (
        <>
          <p className="text-xs uppercase tracking-widest text-danger">
            Sign-in failed
          </p>
          <p className="mt-3 font-serif text-xl text-ink">{state.message}</p>
          <a
            href="/sign-in"
            className="mt-6 inline-flex items-center justify-center rounded-md border border-ink/20 px-5 py-2 text-sm font-medium text-ink hover:border-ink/40"
          >
            Try again
          </a>
        </>
      )}
    </main>
  );
}
