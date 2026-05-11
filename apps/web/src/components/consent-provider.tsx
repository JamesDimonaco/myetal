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
/*  PostHog init — ONLY called after user accepts                      */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'myetal_consent';

function initPostHog() {
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
    disable_session_recording: true, // lazy-start below
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
    loaded: (ph) => {
      ph.startSessionRecording();
    },
  });
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
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-4 sm:flex-row">
        <p className="text-sm text-ink-muted">
          We use cookies for analytics and error tracking to improve MyEtAl.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="rounded border border-rule px-4 py-1.5 text-sm text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded bg-accent px-4 py-1.5 text-sm text-paper transition-colors hover:bg-accent/90"
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

  // Read persisted preference on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'accepted') {
      setConsent('accepted');
      initPostHog();
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
    initPostHog();
  }, []);

  const decline = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    setConsent('declined');
    setShowBanner(false);
  }, []);

  const contextValue: ConsentContextValue = { consent, accept, decline };

  // PostHogProvider is rendered unconditionally so that `children` keeps the
  // same parent across consent flips. Toggling the wrapper used to remount the
  // entire subtree on Accept, wiping in-progress local state (e.g. an
  // unsaved share-editor draft). The posthog SDK itself stays uninitialised
  // until `accept()` calls `initPostHog()`, so capture calls before consent
  // remain no-ops. PostHogPageview, which fires `$pageview`, is still gated
  // so declined users don't get pageview events.
  return (
    <ConsentContext.Provider value={contextValue}>
      <PostHogProvider client={posthog}>
        {consent === 'accepted' ? <PostHogPageview /> : null}
        {children}
      </PostHogProvider>

      {showBanner && <CookieBanner onAccept={accept} onDecline={decline} />}
    </ConsentContext.Provider>
  );
}
