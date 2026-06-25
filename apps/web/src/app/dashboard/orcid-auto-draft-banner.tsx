'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import type { ShareResponse } from '@/types/share';

/**
 * Dashboard onboarding banner. Surfaces ONCE for the user when the
 * ORCID first-sign-in auto-sync pre-built a draft "Publications" share
 * on their behalf. Tone: inviting, not pushy — the user landed here
 * because we did something for them, not because we want something
 * from them.
 *
 * Detection (server-derived from the dashboard's `/shares` fetch):
 *   - name === "Publications"
 *   - published_at === null  (still a draft)
 *   - items.length > 0       (something to publish)
 *   - deleted_at === null    (not tombstoned)
 *
 * Once the user publishes or deletes the share, the predicate no
 * longer matches and the banner disappears on its own — no extra
 * server state to track.
 *
 * Dismissal:
 *   - localStorage keyed by share id, so "I've seen it" doesn't
 *     leak across shares or across users on the same browser.
 *   - Soft UI signal only — we deliberately do NOT persist on the
 *     user row. A user opening the dashboard in a new browser will
 *     see the banner again (which is the right call — the artifact
 *     is still sitting in their account, unpublished).
 */

const DISMISS_STORAGE_PREFIX = 'orcid-auto-draft-dismissed:';

function findAutoDraft(shares: ShareResponse[]): ShareResponse | null {
  return (
    shares.find(
      (s) =>
        s.name === 'Publications' &&
        s.published_at === null &&
        s.deleted_at === null &&
        s.items.length > 0,
    ) ?? null
  );
}

function dismissKey(shareId: string): string {
  return DISMISS_STORAGE_PREFIX + shareId;
}

function readDismissedFromStorage(shareId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(shareId)) === '1';
  } catch {
    // Private mode / quota — treat as not dismissed.
    return false;
  }
}

/** No-op subscribe — localStorage doesn't change while the dashboard
 *  is mounted from anywhere we care about (the dismiss button bumps
 *  React state directly), so we never need to re-snapshot. */
function subscribeNoop(): () => void {
  return () => {};
}

export function OrcidAutoDraftBanner({ shares }: { shares: ShareResponse[] }) {
  const autoDraft = findAutoDraft(shares);

  // SSR-safe read of "have they dismissed this share's banner?".
  // useSyncExternalStore returns the server snapshot (always false)
  // during SSR and the real localStorage value on the client — the
  // SSR/client snapshot transition is handled by the hook itself, so
  // we get no hydration mismatch and no setState-in-effect.
  const storedDismissed = useSyncExternalStore(
    subscribeNoop,
    () => (autoDraft ? readDismissedFromStorage(autoDraft.id) : false),
    () => false,
  );

  // Local "dismissed during this session" state — combined with the
  // persisted flag via OR so clicking dismiss takes effect even if
  // localStorage write failed (private mode etc.).
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const dismissed = storedDismissed || sessionDismissed;

  if (!autoDraft) return null;
  if (dismissed) return null;

  const paperCount = autoDraft.items.length;
  const paperWord = paperCount === 1 ? 'paper' : 'papers';

  function handleDismiss() {
    setSessionDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(autoDraft!.id), '1');
    } catch {
      // Same swallow as above — dismissal won't persist but the
      // current session is dismissed.
    }
  }

  return (
    <div
      role="status"
      className="mb-8 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-accent/30 bg-accent-soft p-5"
    >
      <div className="min-w-0 flex-1">
        <h2 className="font-serif text-lg text-ink">
          Your publications, ready to share.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          We imported {paperCount} {paperWord} from ORCID and prepared a
          draft share for you. Have a look — when it&apos;s right, publish
          in one click.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`/dashboard/share/${autoDraft.id}`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
          >
            Review draft
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
          >
            Maybe later
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="rounded-md px-2 text-ink-muted transition hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
