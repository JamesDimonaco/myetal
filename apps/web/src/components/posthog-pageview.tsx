'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

/**
 * Captures a `$pageview` event on every client-side route change.
 * Must be rendered inside `<PostHogProvider>` (i.e. only when consent is given).
 */
export function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  useEffect(() => {
    if (pathname && posthog) {
      posthog.capture('$pageview', {
        $current_url: window.location.href,
      });
    }
  }, [pathname, searchParams, posthog]);

  return null;
}
