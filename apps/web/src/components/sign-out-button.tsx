'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

/**
 * Calls Better Auth's ``signOut`` (revokes the session row + clears the
 * session cookie), then bounces to ``redirectTo`` (default '/'). Caller
 * controls visual style via className — we stay layout-agnostic.
 */
export function SignOutButton({
  redirectTo = '/',
  className,
  label = 'Sign out',
  busyLabel = 'Signing out…',
}: {
  redirectTo?: string;
  className?: string;
  label?: string;
  busyLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await authClient.signOut();
    } catch {
      // Even if the network call failed, the user clicked sign-out — fall
      // through and refresh so the cookie state is re-read from the server.
    }
    router.replace(redirectTo);
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={className}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
