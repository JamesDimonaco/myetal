'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Hits /api/auth/logout (revokes refresh token + clears cookies), then bounces
 * the caller to `redirectTo` (default '/'). Caller controls visual style via
 * className — we stay layout-agnostic.
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
      await fetch('/api/auth/logout', { method: 'POST' });
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
