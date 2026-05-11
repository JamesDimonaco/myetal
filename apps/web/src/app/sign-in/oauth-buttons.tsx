'use client';

import { useState } from 'react';

import { GitHubIcon } from '@/components/github-icon';
import { GoogleIcon } from '@/components/google-icon';
import { OrcidIcon } from '@/components/orcid-icon';
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

/**
 * OAuth buttons (Google + GitHub + ORCID).
 *
 * Google and GitHub use BA's built-in social provider client; ORCID
 * uses the genericOAuth client which redirects to
 * ``/api/auth/sign-in/oauth2`` with ``providerId=orcid``. The hijack-
 * claim error from the genericOAuth flow lands back at
 * ``/sign-in?error=...``; the parent server page displays the friendly
 * copy.
 */
export function OAuthButtons({ returnTo: rawReturnTo }: { returnTo: string | null }) {
  const callbackURL = safeReturnTo(rawReturnTo);
  const [pending, setPending] = useState<'google' | 'github' | 'orcid' | null>(
    null,
  );

  async function startSocial(provider: 'google' | 'github') {
    setPending(provider);
    await authClient.signIn.social({ provider, callbackURL });
    // signIn.social performs a top-level redirect; the function
    // typically doesn't return. Reset pending only on the slow path
    // where it does return (e.g. the user blocked the popup).
    setPending(null);
  }

  async function startOrcid() {
    setPending('orcid');
    await authClient.signIn.oauth2({ providerId: 'orcid', callbackURL });
    setPending(null);
  }

  return (
    <div className="mt-8 grid gap-3 sm:mt-10">
      <button
        type="button"
        onClick={() => startSocial('google')}
        disabled={pending !== null}
        className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40 disabled:opacity-60"
      >
        <GoogleIcon size={18} />
        {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        onClick={() => startSocial('github')}
        disabled={pending !== null}
        className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40 disabled:opacity-60"
      >
        <GitHubIcon size={18} />
        {pending === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
      </button>
      <button
        type="button"
        onClick={startOrcid}
        disabled={pending !== null}
        className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-medium text-ink transition hover:border-ink/40 disabled:opacity-60"
      >
        <OrcidIcon size={18} />
        {pending === 'orcid' ? 'Redirecting…' : 'Continue with ORCID'}
      </button>
      <p className="text-xs text-ink-muted">
        Already signed up with Google or GitHub? Add your ORCID iD on your
        profile instead — signing in with ORCID will create a separate
        account.
      </p>
    </div>
  );
}
