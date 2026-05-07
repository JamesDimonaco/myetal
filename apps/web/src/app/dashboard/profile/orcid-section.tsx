'use client';

import { useState } from 'react';

import { OrcidIcon } from '@/components/orcid-icon';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import type { UserResponse } from '@/types/auth';

const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

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
  const hasChange = trimmed !== normalisedSaved;
  const isClearing = trimmed === '' && savedValue !== null;
  const formatValid = trimmed === '' || ORCID_REGEX.test(trimmed);

  async function patch(body: { orcid_id: string | null }): Promise<UserResponse> {
    return clientApi<UserResponse>('/auth/me', {
      method: 'PATCH',
      json: body,
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);

    if (!formatValid) {
      setError(
        "That doesn't look like a valid ORCID iD — try the format 0000-0000-0000-0000.",
      );
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
          setError('That ORCID iD is already linked to another account.');
        } else if (err.status === 422) {
          setError(
            "That doesn't look like a valid ORCID iD — try the format 0000-0000-0000-0000.",
          );
        } else {
          setError(err.detail || 'Could not save your ORCID iD.');
        }
      } else {
        setError('Could not save your ORCID iD.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setJustSaved(false);
    setSubmitting(true);
    try {
      const updated = await patch({ orcid_id: null });
      setSavedValue(updated.orcid_id ?? null);
      setDraft('');
      setJustSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail || 'Could not remove your ORCID iD.');
      } else {
        setError('Could not remove your ORCID iD.');
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
        Connect your ORCID record so you can import your works.
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
            className={[
              'rounded-md border bg-paper px-3 py-2.5 font-mono text-base text-ink outline-none focus:border-accent',
              error ? 'border-danger' : 'border-rule',
            ].join(' ')}
          />
          <span className="text-xs text-ink-muted">
            Don&apos;t know yours?{' '}
            <a
              href="https://orcid.org"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
            >
              Find your ORCID iD
            </a>
            .
          </span>
        </label>

        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {justSaved && !error ? (
          <p className="text-sm text-ink-muted">Saved.</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submitting || !hasChange}
            className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting
              ? 'Saving…'
              : isClearing
                ? 'Save (clear)'
                : 'Save'}
          </button>
          {savedValue ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={submitting}
              className="rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-danger transition hover:bg-paper-soft disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
