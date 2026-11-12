'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { PostHogPageview } from '@/components/posthog-pageview';

/* ------------------------------------------------------------------ */
/*  Consent context                                                    */
/* ------------------------------------------------------------------ */

type ConsentState = 'pending' | 'accepted' | 'declined';

interface ConsentContextValue {
  consent: ConsentState;
  accept: () => void;
  decline: () => void;
}

const ConsentContext = createContext<ConsentContextValue>({
  consent: 'pending',
  accept: () => {},
  decline: () => {},
});

export const useConsent = () => useContext(ConsentContext);

/* ------------------------------------------------------------------ */
/*  PostHog init                                                       */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'myetal_consent';

// Before consent PostHog runs cookieless: memory-only storage, no recording,
// so we still count anonymous pageviews without needing the banner.
// ponytail: memory persistence gives a new anonymous id per full page load, so
// unique visitors are overcounted. Switch to PostHog's server-side cookieless
// mode if that matters.
export function posthogConfig(consented: boolean) {
  return {
    persistence: consented ? 'localStorage+cookie' : 'memory',
    disable_session_recording: !consented,
  } as const;
}

function initPostHog(consented: boolean) {
  if (typeof window === 'undefined') return;
  if (posthog.__loaded) return; // already initialised

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    console.warn('[PostHog] Missing env vars — skipping init');
    return;
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // we capture manually
    capture_pageleave: true,
    person_profiles: 'identified_only',
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
    ...posthogConfig(consented),
  });
}

function upgradeToConsented() {
  if (!posthog.__loaded) {
    initPostHog(true);
    return;
  }
  posthog.set_config(posthogConfig(true));
  posthog.startSessionRecording();
}

/* ------------------------------------------------------------------ */
/*  Cookie banner                                                      */
/* ------------------------------------------------------------------ */

function CookieBanner({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-4 sm:flex-row sm:px-6">
        <p className="text-sm text-ink-muted">
          We use cookies for analytics and error tracking to improve MyEtAl.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="inline-flex min-h-11 sm:min-h-9 items-center justify-center rounded border border-rule px-4 py-1.5 text-sm text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex min-h-11 sm:min-h-9 items-center justify-center rounded bg-accent px-4 py-1.5 text-sm text-paper transition-colors hover:bg-accent/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>('pending');
  const [showBanner, setShowBanner] = useState(false);
  // Gates PostHogPageview: its effect runs before this provider's mount
  // effect (children first), so rendering it earlier drops the landing
  // pageview against an uninitialised client.
  const [tracking, setTracking] = useState(false);

  // Read persisted preference on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== 'declined') {
      initPostHog(stored === 'accepted');
      setTracking(posthog.__loaded);
    }
    if (stored === 'accepted') {
      setConsent('accepted');
    } else if (stored === 'declined') {
      setConsent('declined');
    } else {
      // First visit — show banner
      setShowBanner(true);
    }
  }, []);

  // Global unhandled-rejection handler (only when PostHog is active)
  useEffect(() => {
    if (consent !== 'accepted') return;

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (posthog.__loaded) {
        posthog.captureException(event.reason);
      }
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [consent]);

  const accept = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    setConsent('accepted');
    setShowBanner(false);
    upgradeToConsented();
    setTracking(posthog.__loaded);
  }, []);

  const decline = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    setConsent('declined');
    setShowBanner(false);
    // Stops the cookieless tracking that ran before the choice.
    if (posthog.__loaded) posthog.opt_out_capturing();
    setTracking(false);
  }, []);

  const contextValue: ConsentContextValue = { consent, accept, decline };

  // PostHogProvider is rendered unconditionally so that `children` keeps the
  // same parent across consent flips. Toggling the wrapper used to remount the
  // entire subtree on Accept, wiping in-progress local state (e.g. an
  // unsaved share-editor draft).
  return (
    <ConsentContext.Provider value={contextValue}>
      <PostHogProvider client={posthog}>
        {tracking ? <PostHogPageview /> : null}
        {children}
      </PostHogProvider>

      {showBanner && <CookieBanner onAccept={accept} onDecline={decline} />}
    </ConsentContext.Provider>
  );
}
