'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';

/**
 * Next.js root error boundary. Captures unhandled exceptions to PostHog
 * (when consent has been given and PostHog is initialised), and renders
 * a minimal recovery UI.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Only report if PostHog is loaded (user gave consent)
    if (typeof window !== 'undefined' && posthog.__loaded) {
      posthog.captureException(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="font-serif text-2xl text-ink">Something went wrong</h2>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        An unexpected error occurred. You can try again, or return to the
        dashboard.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-accent px-4 py-2 text-sm text-paper transition-colors hover:bg-accent/90"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="rounded border border-rule px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
