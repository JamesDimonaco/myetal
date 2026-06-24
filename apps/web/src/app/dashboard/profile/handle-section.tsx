'use client';

import { useEffect, useState } from 'react';

import { API_BASE_URL, ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import type { UserResponse } from '@/types/auth';

/**
 * Researcher-page handle entry — claims, changes, and clears the
 * ``users.handle`` slug surfaced at ``/u/{handle}``. The UUID URL
 * ``/u/{id}`` keeps resolving regardless, so already-printed business
 * cards never break.
 *
 * Real-time availability check: 300ms-debounced GET to
 * ``/public/by-handle/{handle}`` — 404 = available, 200 = taken. The
 * server validates again on save (this is convenience, not the source
 * of truth).
 *
 * Mirrors the orcid-section component's collapsed Save/Remove button
 * model: only one primary action is visible at a time.
 */

const HANDLE_REGEX = /^[a-z][a-z0-9_-]{2,29}$/;
const CONSECUTIVE_SEPS_RE = /[_-]{2,}/;

// Mirror of services/handles.py::RESERVED_HANDLES. Kept inline rather
// than fetched so the input can validate optimistically while the user
// types — the server is still the source of truth and will return 400
// if drift occurs.
const RESERVED_HANDLES = new Set([
  'about',
  'admin',
  'api',
  'assets',
  'browse',
  'c',
  'dashboard',
  'demo',
  'help',
  'login',
  'logout',
  'me',
  'privacy',
  'profile',
  'public',
  'register',
  'root',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'static',
  'support',
  'system',
  'terms',
  'u',
  'www',
]);

interface Props {
  initialHandle: string | null;
}

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken' }
  | { state: 'error' };

interface ValidationResult {
  ok: boolean;
  message?: string;
}

function validateClientSide(handle: string): ValidationResult {
  if (handle === '') return { ok: false };
  if (handle.length < 3) {
    return { ok: false, message: 'Must be at least 3 characters.' };
  }
  if (handle.length > 30) {
    return { ok: false, message: 'Must be 30 characters or fewer.' };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      ok: false,
      message:
        'Use lowercase letters, digits, _ or - only. Must start with a letter.',
    };
  }
  if (CONSECUTIVE_SEPS_RE.test(handle)) {
    return {
      ok: false,
      message: 'No double separators (no “__”, “--”, or mixed “_-”).',
    };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, message: 'That name is reserved by the platform.' };
  }
  return { ok: true };
}

export function HandleSection({ initialHandle }: Props) {
  const siteUrl = (
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://myetal.app'
  ).replace(/\/$/, '');

  const [savedValue, setSavedValue] = useState<string | null>(initialHandle);
  const [draft, setDraft] = useState<string>(initialHandle ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Only stores the OUTCOME of a completed network check, scoped to the
  // exact handle it ran for. The "idle" / "checking" states are derived
  // in render from input conditions — avoids the
  // `react-hooks/set-state-in-effect` lint by not syncing transient
  // states via `setState` inside `useEffect`.
  const [checkResult, setCheckResult] = useState<
    | { handle: string; outcome: 'available' | 'taken' | 'error' }
    | null
  >(null);

  // Always lowercased for validation + submission. The user can type
  // any case; we coerce on the way in.
  const normalised = draft.trim().toLowerCase();
  const validation = validateClientSide(normalised);
  const inputDiffers = normalised !== (savedValue ?? '');
  const inputIsEmpty = normalised === '';

  // Mirror of orcid-section button-mode logic.
  const buttonMode: 'none' | 'save' | 'remove' =
    !savedValue && inputIsEmpty
      ? 'none'
      : !inputDiffers
        ? 'remove'
        : inputIsEmpty && savedValue
          ? 'remove'
          : 'save';

  // ---- Debounced availability check -----------------------------------
  //
  // Only check when the input differs from the saved value AND passes
  // client-side validation. Skip otherwise — saves a round-trip and
  // avoids flashing "taken" while the user is still typing.
  //
  // The effect ONLY writes the completed check outcome (inside the
  // async setTimeout callback). `idle` and `checking` are derived in
  // render from the same conditions the effect uses — so we never
  // synchronously `setState` in the effect body.
  const shouldCheck = inputDiffers && !inputIsEmpty && validation.ok;
  const availability: Availability = !shouldCheck
    ? { state: 'idle' }
    : checkResult?.handle === normalised
      ? { state: checkResult.outcome }
      : { state: 'checking' };

  useEffect(() => {
    if (!shouldCheck) return;
    // Skip if we already have a settled result for this exact value
    // (covers re-renders after the network call completed).
    if (checkResult?.handle === normalised) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const url = `${API_BASE_URL}/public/by-handle/${encodeURIComponent(
          normalised,
        )}`;
        const res = await fetch(url, { method: 'GET' });
        if (cancelled) return;
        if (res.status === 404) {
          setCheckResult({ handle: normalised, outcome: 'available' });
        } else if (res.ok) {
          setCheckResult({ handle: normalised, outcome: 'taken' });
        } else {
          setCheckResult({ handle: normalised, outcome: 'error' });
        }
      } catch {
        if (!cancelled) {
          setCheckResult({ handle: normalised, outcome: 'error' });
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalised, shouldCheck, checkResult?.handle]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setJustSaved(false);

    if (buttonMode === 'remove') {
      await handleRemove();
      return;
    }
    if (buttonMode !== 'save') return;
    if (!validation.ok) return;

    setSubmitting(true);
    try {
      const updated = await clientApi<UserResponse>('/me/handle', {
        method: 'PATCH',
        json: { handle: normalised },
      });
      setSavedValue(updated.handle ?? null);
      setDraft(updated.handle ?? '');
      setJustSaved(true);
      // No need to reset checkResult — availability derives from
      // `shouldCheck` which becomes false now that draft === saved.
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setServerError('That handle is already taken.');
        } else if (err.status === 400) {
          setServerError('That name is reserved by the platform.');
        } else if (err.status === 422) {
          setServerError('That handle doesn’t match the allowed format.');
        } else {
          setServerError(err.detail || 'Could not save your handle.');
        }
      } else {
        setServerError('Could not save your handle.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Remove your handle? Your researcher page stays at /u/' +
          '<your-id>. You can claim a new handle later.',
      );
      if (!ok) return;
    }
    setSubmitting(true);
    setServerError(null);
    setJustSaved(false);
    try {
      await clientApi<void>('/me/handle', { method: 'DELETE' });
      setSavedValue(null);
      setDraft('');
      setJustSaved(true);
      // checkResult is left as-is; availability derives to idle now
      // that draft is empty.
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.detail || 'Could not remove your handle.');
      } else {
        setServerError('Could not remove your handle.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Display helpers -------------------------------------------------
  const formatError = validation.ok ? null : validation.message;
  const showFormatError = !inputIsEmpty && !!formatError;
  // Suppress availability hints while format is wrong — no point telling
  // someone "available" for a handle they can't actually save.
  const availabilityHint = (() => {
    if (showFormatError || !inputDiffers || inputIsEmpty || !validation.ok) {
      return null;
    }
    if (availability.state === 'checking') return 'Checking availability…';
    if (availability.state === 'available') return 'Available.';
    if (availability.state === 'taken') return 'Already taken — try another.';
    return null;
  })();

  const canSubmit =
    buttonMode === 'save' &&
    validation.ok &&
    availability.state !== 'taken' &&
    availability.state !== 'checking' &&
    !submitting;

  return (
    <section className="mt-10 rounded-lg border border-rule bg-paper-soft p-6">
      <header>
        <h2 className="font-serif text-xl text-ink">Handle</h2>
      </header>
      <p className="mt-1 text-sm text-ink-muted">
        A short, human-readable URL for your researcher page — like{' '}
        <span className="font-mono">{siteUrl.replace(/^https?:\/\//, '')}/u/drsmith</span>.
        Add it to your business card, slide deck, or email signature.
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Lowercase letters, digits, <span className="font-mono">_</span> or{' '}
        <span className="font-mono">-</span>. 3–30 characters. Your old{' '}
        <span className="font-mono">/u/&lt;id&gt;</span> URL keeps working
        regardless.
      </p>

      {savedValue ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-paper px-3 py-2 text-sm">
          <span className="text-ink-muted">Current:</span>
          <a
            href={`/u/${savedValue}`}
            className="font-mono text-ink underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
          >
            /u/{savedValue}
          </a>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-faint">Not set.</p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 grid gap-2">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
            Your handle
          </span>
          <div className="flex items-stretch overflow-hidden rounded-md border border-rule bg-paper focus-within:border-accent">
            <span className="flex items-center bg-paper-soft px-3 font-mono text-sm text-ink-muted">
              /u/
            </span>
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setServerError(null);
                setJustSaved(false);
              }}
              placeholder="drsmith"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={30}
              aria-invalid={showFormatError || availability.state === 'taken'}
              aria-describedby={
                showFormatError
                  ? 'handle-format-error'
                  : serverError
                    ? 'handle-server-error'
                    : undefined
              }
              className="w-full bg-paper px-3 py-2.5 font-mono text-base text-ink outline-none"
            />
          </div>
        </label>

        {showFormatError ? (
          <p id="handle-format-error" className="text-sm text-danger" role="alert">
            {formatError}
          </p>
        ) : null}

        {availabilityHint && !showFormatError ? (
          <p
            className={[
              'text-sm',
              availability.state === 'taken'
                ? 'text-danger'
                : availability.state === 'available'
                  ? 'text-ink'
                  : 'text-ink-muted',
            ].join(' ')}
            role={availability.state === 'taken' ? 'alert' : undefined}
          >
            {availabilityHint}
          </p>
        ) : null}

        {serverError ? (
          <p id="handle-server-error" className="text-sm text-danger" role="alert">
            {serverError}
          </p>
        ) : null}

        {justSaved && !serverError ? (
          <p className="text-sm text-ink-muted">Saved.</p>
        ) : null}

        {buttonMode !== 'none' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {buttonMode === 'save' ? (
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRemove}
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-danger/40 bg-paper px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/5 disabled:opacity-60"
              >
                {submitting ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}
