'use client';

/**
 * Add-paper modal — three input modes: DOI, Search, Manual. Mirrors the
 * mobile flow at apps/mobile/app/(authed)/share/add-paper.tsx, but laid out
 * as a centred dialog rather than a full-screen presentation.
 *
 * Wiring: parent owns visibility and receives the chosen Paper via `onPick`.
 * No outbox / pending-paper bus needed on web — the editor mounts the modal
 * directly so the callback path is straight-line.
 */

import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import {
  extractDoi,
  useLookupPaper,
  useSearchPapers,
} from '@/lib/hooks/usePapers';
import type { Paper, PaperSearchResult } from '@/types/paper';

type Mode = 'doi' | 'search' | 'manual';

interface Props {
  onClose: () => void;
  onPick: (paper: Paper) => void;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'Manual' },
];

const DEBOUNCE_MS = 300;

export function AddPaperModal({ onClose, onPick }: Props) {
  const [mode, setMode] = useState<Mode>('doi');

  // Lock body scroll + Escape to close — same UX contract as <QrModal>.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-paper-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 px-4 py-8 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-rule bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-6 py-4">
          <h2 id="add-paper-title" className="font-serif text-xl text-ink">
            Add paper
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-m-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-paper-soft hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex gap-1 rounded-full border border-rule bg-paper-soft p-1">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={[
                    'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition',
                    active
                      ? 'bg-ink text-paper'
                      : 'text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 pb-6 pt-4">
          {mode === 'doi' ? <DoiPane onPick={onPick} /> : null}
          {mode === 'search' ? <SearchPane onPick={onPick} /> : null}
          {mode === 'manual' ? <ManualPane onPick={onPick} /> : null}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function DoiPane({ onPick }: { onPick: (p: Paper) => void }) {
  const [input, setInput] = useState('');
  const debounced = useDebouncedValue(input, DEBOUNCE_MS);
  const parsedDoi = useMemo(() => extractDoi(debounced), [debounced]);
  const lookup = useLookupPaper(debounced);

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-xs uppercase tracking-wider text-ink-muted">
          DOI
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="10.1038/nature12373 or https://doi.org/..."
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
        />
        <span className="text-xs text-ink-faint">
          Paste a DOI from a paper, a doi.org URL, or arXiv.
        </span>
      </label>

      <div className="min-h-[180px]">
        {!parsedDoi ? (
          <EmptyHint
            title="Waiting for a DOI"
            body="As soon as we recognise one, we'll fetch the metadata."
          />
        ) : lookup.isLoading || lookup.isFetching ? (
          <LoadingRow text={`Looking up ${parsedDoi}…`} />
        ) : lookup.isError ? (
          <ErrorBanner error={lookup.error} />
        ) : lookup.data ? (
          <PaperPreview paper={lookup.data} onPick={onPick} />
        ) : null}
      </div>
    </div>
  );
}

function SearchPane({ onPick }: { onPick: (p: Paper) => void }) {
  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<PaperSearchResult | null>(null);
  const debounced = useDebouncedValue(input, DEBOUNCE_MS);
  const search = useSearchPapers(debounced);

  const trimmed = input.trim();

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-xs uppercase tracking-wider text-ink-muted">
          Search by title
        </span>
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Refining the search — drop any preview the user had picked.
            if (picked) setPicked(null);
          }}
          placeholder="Attention is all you need"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
        />
        <span className="text-xs text-ink-faint">
          Powered by OpenAlex. Best with title or first author + year.
        </span>
      </label>

      <div className="min-h-[180px]">
        {picked ? (
          <PaperPreview paper={picked} onPick={onPick} />
        ) : trimmed.length < 3 ? (
          <EmptyHint
            title="Type at least 3 characters"
            body="Search runs as soon as you've typed enough to be meaningful."
          />
        ) : search.isLoading || search.isFetching ? (
          <LoadingRow text="Searching…" />
        ) : search.isError ? (
          <ErrorBanner error={search.error} />
        ) : search.data && search.data.results.length === 0 ? (
          <EmptyHint
            title="Nothing matched"
            body="Try a different phrasing or fall back to Manual."
          />
        ) : search.data ? (
          <ul className="grid gap-2">
            {search.data.results.map((r, idx) => (
              <li key={`${r.doi ?? r.title}-${idx}`}>
                <button
                  type="button"
                  onClick={() => setPicked(r)}
                  className="block w-full rounded-md border border-rule bg-paper-soft p-3 text-left transition hover:bg-paper"
                >
                  <p className="font-serif text-sm leading-snug text-ink">
                    {r.title}
                  </p>
                  {r.authors ? (
                    <p className="mt-0.5 text-xs text-ink-muted">{r.authors}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {[r.container, r.year].filter(Boolean).join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ManualPane({ onPick }: { onPick: (p: Paper) => void }) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [doi, setDoi] = useState('');
  const [scholarUrl, setScholarUrl] = useState('');

  const canSave = title.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) return;
    const paper: Paper = {
      title: title.trim(),
      authors: authors.trim() || null,
      year: year.match(/^\d{4}$/) ? Number(year) : null,
      doi: doi.trim() || null,
      container: null,
      scholar_url: scholarUrl.trim() || null,
      // Closest fit; manual entries don't have a real source.
      source: 'crossref',
    };
    onPick(paper);
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-ink-faint">
        For preprints, posters, grey literature — anything not in Crossref /
        OpenAlex.
      </p>
      <ManualField label="Title (required)" value={title} onChange={setTitle} />
      <ManualField
        label="Authors"
        value={authors}
        onChange={setAuthors}
        placeholder="Lovelace A, Babbage C"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ManualField
          label="Year"
          value={year}
          onChange={(v) => setYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
          placeholder="2026"
          inputMode="numeric"
        />
        <ManualField
          label="DOI"
          value={doi}
          onChange={setDoi}
          placeholder="10.1000/xyz123"
        />
      </div>
      <ManualField
        label="Scholar URL"
        value={scholarUrl}
        onChange={setScholarUrl}
        placeholder="https://scholar.google.com/..."
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!canSave}
        className="mt-2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
      >
        Add to collection
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------

function PaperPreview({
  paper,
  onPick,
}: {
  paper: Paper;
  onPick: (p: Paper) => void;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper-soft p-4">
      <p className="font-serif text-base leading-snug text-ink">
        {paper.title}
      </p>
      {paper.authors ? (
        <p className="mt-1 text-sm text-ink-muted">{paper.authors}</p>
      ) : null}
      <p className="mt-1 text-xs text-ink-faint">
        {[paper.container, paper.year].filter(Boolean).join(' · ')}
        {' · '}
        <span className="uppercase tracking-wider">{paper.source}</span>
      </p>
      {paper.doi ? (
        <p className="mt-1 font-mono text-xs text-ink-faint">{paper.doi}</p>
      ) : null}
      <button
        type="button"
        onClick={() => onPick(paper)}
        className="mt-4 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
      >
        Add to collection
      </button>
    </div>
  );
}

function LoadingRow({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-sm text-ink-muted">
      <Spinner />
      <span>{text}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-ink-muted"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorBanner({ error }: { error: unknown }) {
  let title = 'Something went wrong';
  let body = 'Please try again.';
  if (error instanceof ApiError) {
    if (error.isNotFound) {
      title = 'Not found';
      body =
        "Crossref doesn't know that DOI. Double-check it, or fall back to Manual.";
    } else if (error.status >= 500) {
      title = 'Server hiccup';
      body =
        'The metadata service is having a moment. Try again, or use Manual.';
    } else {
      body = error.detail;
    }
  } else if (error instanceof Error) {
    title = 'No connection';
    body = 'Check your network and try again.';
  }
  return (
    <div className="rounded-md border border-rule bg-paper-soft px-4 py-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function EmptyHint({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function ManualField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'numeric';
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
    </label>
  );
}
