'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * First-run product tour for the dashboard. Four cards explaining what a
 * share is, how to fill one, how the QR works, and how publishing differs
 * from a simple link. Centred Radix Dialog (no anchored arrows) — keeps the
 * component small and avoids resize / scroll re-positioning bugs.
 *
 * Trigger model:
 * - Auto-opens on first mount if `myetal.tour_dismissed.v1` is unset.
 * - Re-opens on receiving a window `myetal:open-tour` CustomEvent — that's
 *   what {@link ShowTourButton} dispatches. Decoupling the launcher from the
 *   overlay via an event means any future surface can re-launch the tour
 *   without prop-drilling or context.
 *
 * Dismissal is permanent: Skip, Done, Esc, or outside-click all persist the
 * key. Bumping the version suffix (`.v2`) re-triggers for everyone after a
 * copy refresh.
 */

const STORAGE_KEY = 'myetal.tour_dismissed.v1';
const OPEN_EVENT = 'myetal:open-tour';

type TourStep = {
  title: string;
  body: string;
  icon: 'spark' | 'plus' | 'qr' | 'globe';
};

const STEPS: TourStep[] = [
  {
    icon: 'spark',
    title: "What's a share?",
    body: 'A share is one curated link — a paper, a repo, a list of papers, or a PDF — packaged behind a single QR code. Put the QR on your poster, slides, or CV; whoever scans it lands on your collection. No sign-up needed for them.',
  },
  {
    icon: 'plus',
    title: 'Add anything you want people to find',
    body: 'Start a share, give it a name, then drag in papers from your library, paste a DOI, link a GitHub repo, or upload a PDF. Each share is one QR — keep it focused on the moment you’ll use it (a poster, a talk, a job application).',
  },
  {
    icon: 'qr',
    title: 'Each share has its own QR',
    body: 'Open a share to view its QR. Print it on a poster, copy it onto a slide, or just send the link. Whoever scans lands on a clean public viewer.',
  },
  {
    icon: 'globe',
    title: 'Make it findable',
    body: 'Turn on "Publish to discovery" inside a share to list it in MyEtAl search and let Google index it. Off by default — leave it off if the share is for a private audience.',
  },
];

export function DashboardTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    // Single open-event path serves both auto-open (first visit) and the
    // manual ShowTourButton re-launch. Dispatching the same event the button
    // uses keeps setState inside the handler (lint-clean) and gives us one
    // code path for "tour should be visible now."
    const handler = () => setStep(0);
    window.addEventListener(OPEN_EVENT, handler);

    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        window.dispatchEvent(new Event(OPEN_EVENT));
      }
    } catch {
      // Private-mode / quota-exceeded: just don't auto-open. The
      // ShowTourButton still works without persistence.
    }

    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const close = () => {
    setStep(null);
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore — see above
    }
  };

  if (step === null) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-ink">
          <TourIcon kind={current.icon} />
        </div>
        <DialogTitle className="mt-4 pr-8">{current.title}</DialogTitle>
        <DialogDescription className="mt-2 text-base text-ink-muted">
          {current.body}
        </DialogDescription>

        {/* Progress dots */}
        <div
          className="mt-6 flex items-center justify-center gap-1.5"
          aria-hidden
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={[
                'h-1.5 rounded-full transition-all',
                i === step ? 'w-6 bg-ink' : 'w-1.5 bg-ink/20',
              ].join(' ')}
            />
          ))}
        </div>
        <p className="sr-only">
          Step {step + 1} of {STEPS.length}
        </p>

        {/* Controls. Skip on the left mirrors "Cancel" placement in our other
            dialogs; primary CTA on the right. */}
        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="text-sm text-ink-muted underline-offset-4 transition hover:text-ink hover:underline"
          >
            {isLast ? 'Close' : 'Skip tour'}
          </button>
          <div className="flex items-center gap-2">
            {!isFirst ? (
              <Button
                variant="secondary"
                onClick={() => setStep((s) => (s === null ? 0 : Math.max(0, s - 1)))}
              >
                Back
              </Button>
            ) : null}
            {isLast ? (
              <Button onClick={close}>Got it</Button>
            ) : (
              <Button onClick={() => setStep((s) => (s === null ? 1 : s + 1))}>
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ShowTourButtonProps {
  className?: string;
}

/**
 * Tiny text-button that re-launches the tour by dispatching the open event.
 * Safe to mount anywhere in the dashboard tree — the {@link DashboardTour}
 * subscriber catches it. Renders nothing (`null`) on SSR + first client paint
 * to avoid a hydration mismatch for users who have already dismissed; once
 * mounted it always shows.
 */
export function ShowTourButton({ className }: ShowTourButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className={
        className ??
        'text-xs text-ink-muted underline-offset-4 transition hover:text-ink hover:underline'
      }
    >
      Show tour
    </button>
  );
}

function TourIcon({ kind }: { kind: TourStep['icon'] }) {
  switch (kind) {
    case 'spark':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <path
            d="M11 2v4M11 16v4M2 11h4M16 11h4M4.6 4.6l2.8 2.8M14.6 14.6l2.8 2.8M4.6 17.4l2.8-2.8M14.6 7.4l2.8-2.8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'plus':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <path
            d="M11 4v14M4 11h14"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'qr':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
          <rect x="12.5" y="2.5" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2.5" y="12.5" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="13" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          <rect x="17" y="13" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          <rect x="13" y="17" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          <rect x="17" y="17" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
        </svg>
      );
    case 'globe':
      return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="8.25" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M2.75 11h16.5M11 2.75c2.5 2.6 3.75 5.4 3.75 8.25S13.5 16.65 11 19.25M11 2.75C8.5 5.35 7.25 8.15 7.25 11S8.5 16.65 11 19.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
