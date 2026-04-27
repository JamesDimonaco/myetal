'use client';

/**
 * Wraps the app in a TanStack Query client and the cookie-consent-gated
 * PostHog provider. Server components don't need this — they fetch directly
 * via `serverFetch` and pass data down — but client components (forms,
 * dashboards with optimistic updates) get caching and mutation state from
 * useQuery / useMutation.
 *
 * The QueryClient is created inside a useState so a hot-reload during dev
 * doesn't blow away in-flight queries.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useState, type ReactNode } from 'react';

import { ConsentProvider } from '@/components/consent-provider';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The backend is fast and caching is per-route on the server;
            // 30s on the client is a sane default that prevents thundering
            // back-to-back fetches without holding stale data forever.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <ConsentProvider>{children}</ConsentProvider>
      </Suspense>
    </QueryClientProvider>
  );
}
