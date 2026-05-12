'use client';

import { useState } from 'react';

import { OrcidIcon } from '@/components/orcid-icon';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import type { UserResponse } from '@/types/auth';

const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

const ORCID_VALIDATION_ERROR =
  "That doesn't look like a valid ORCID iD. Use the format 0000-0000-0000-0000 (last digit may be X).";
const ORCID_CONFLICT_ERROR =
  'That ORCID iD is already linked to another account.';
const ORCID_GENERIC_SAVE_ERROR = 'Could not save your ORCID iD.';

interface Props {
  initialOrcidId: string | null;
}

/**
 * ORCID iD entry — lets GitHub/Google users link an ORCID iD manually so they
 * can use ORCID-backed features without re-signing-in via ORCID.
 */
export function OrcidSection({ initialOrcidId }: Props) {
  const [savedValue, setSavedValue] = useState<string | null>(initialOrcidId);
  const [draft, setDraft] = useState<string>(initialOrcidId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const trimmed = draft.trim().toUpperCase();
  const normalisedSaved = savedValue ?? '';
  const inputDiffers = trimmed !== normalisedSaved;
  const inputIsEmpty = trimmed === '';
  const formatValid = trimmed === '' || ORCID_REGEX.test(trimmed);

  // Per §2.2:
  //   Empty + nothing saved          → no button.
  //   Differs from saved (and valid) → Save (primary).
  //   Matches saved exactly          → Remove (destructive, with confirm).
  //   Empty + value saved            → Remove (destructive, with confirm).
  const buttonMode: 'none' | 'save' | 'remove' =
    !savedValue && inputIsEmpty
      ? 'none'
      : !inputDiffers
        ? 'remove'
        : inputIsEmpty && savedValue
          ? 'remove'
          : 'save';

  async function patch(body: { orcid_id: string | null }): Promise<UserResponse> {
    return clientApi<UserResponse>('/me/orcid', {
      method: 'PATCH',
      json: body,
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);

    if (buttonMode === 'remove') {
      await handleRemove();
      return;
    }

    if (buttonMode !== 'save') return;

    if (!formatValid) {
      setError(ORCID_VALIDATION_ERROR);
      return;
    }

    setSubmitting(true);
    try {
      const updated = await patch({
        orcid_id: trimmed === '' ? null : trimmed,
      });
      setSavedValue(updated.orcid_id ?? null);
      setDraft(updated.orcid_id ?? '');
      setJustSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError(ORCID_CONFLICT_ERROR);
        } else if (err.status === 422) {
          setError(ORCID_VALIDATION_ERROR);
        } else {
          setError(err.detail || ORCID_GENERIC_SAVE_ERROR);
        }
      } else {
        setError(ORCID_GENERIC_SAVE_ERROR);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setJustSaved(false);
    // Web Remove confirmation per §2.4 — native confirm() mirrors mobile's
    // Alert.alert; no new dependency needed.
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Remove your ORCID iD? You can add it back any time.',
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const updated = await patch({ orcid_id: null });
      setSavedValue(updated.orcid_id ?? null);
      setDraft('');
      setJustSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail || ORCID_GENERIC_SAVE_ERROR);
      } else {
        setError(ORCID_GENERIC_SAVE_ERROR);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-rule bg-paper-soft p-6">
      <header className="flex items-center gap-2">
        <OrcidIcon size={20} />
        <h2 className="font-serif text-xl text-ink">ORCID iD</h2>
      </header>
      <p className="mt-1 text-sm text-ink-muted">
        Add your ORCID iD to import your public works. We only read — we never
        write to your ORCID record.
      </p>

      {savedValue ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-paper px-3 py-2 text-sm">
          <span className="text-ink-muted">Current:</span>
          <a
            href={`https://orcid.org/${savedValue}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-ink underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
          >
            {savedValue}
          </a>
          <span aria-hidden className="text-ink-faint">
            ↗
          </span>
        </div>
      ) : null}

      <form onSubmit={handleSave} className="mt-4 grid gap-2">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
            Your ORCID iD
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
              setJustSaved(false);
            }}
            placeholder="0000-0000-0000-0000"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={19}
            aria-invalid={!!error}
            aria-describedby={error ? 'orcid-id-error' : undefined}
            className={[
              'rounded-md border bg-paper px-3 py-2.5 font-mono text-base text-ink outline-none focus:border-accent',
              error ? 'border-danger' : 'border-rule',
            ].join(' ')}
          />
        </label>

        <p className="text-xs text-ink-muted">
          <a
            href="https://orcid.org"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
          >
            What&apos;s an ORCID iD? ↗
          </a>
        </p>

        {error ? (
          <p id="orcid-id-error" className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {justSaved && !error ? (
          <p className="text-sm text-ink-muted">Saved.</p>
        ) : null}

        {buttonMode !== 'none' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {buttonMode === 'save' ? (
              <button
                type="submit"
                disabled={submitting || !formatValid}
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
