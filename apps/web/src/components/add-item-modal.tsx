'use client';

/**
 * Add-item modal — top-level kind picker (Paper / Repo / Link), each kind
 * with its own pane. The paper pane is the original three-mode flow (DOI /
 * Search / Manual). The repo pane parses a GitHub URL, hits our same-origin
 * `/api/github/repo` wrapper for metadata, and lets the user edit before
 * saving. The link pane is pure manual entry — no upstream fetch.
 *
 * Wiring: parent owns visibility and receives the chosen draft via `onPick`,
 * a discriminated-union payload so the editor can append it as the right
 * kind without re-deriving the shape.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import type { RepoInfo } from '@/lib/github';
import {
  extractDoi,
  useLookupPaper,
  useSearchPapers,
} from '@/lib/hooks/usePapers';
import {
  PDF_COPYRIGHT_LABEL,
  PDF_GENERIC_ERR,
  PDF_NETWORK_ERR,
  PDF_NOT_VALID_MSG,
  PDF_TOO_LARGE_MSG,
  PDF_TRUST_NOTE,
} from '@/lib/pdf-copy';
import type { Paper, PaperSearchResult } from '@/types/paper';
import type { PresignResponse, ShareItemOut } from '@/types/share';

type SortOption = 'relevance' | 'newest' | 'oldest' | 'most-cited';

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'most-cited', label: 'Most cited' },
];

function sortResults(
  results: PaperSearchResult[],
  sort: SortOption,
): PaperSearchResult[] {
  if (sort === 'relevance') return results;
  const sorted = [...results];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => {
        const da = a.publication_date ?? String(a.year ?? '0');
        const db = b.publication_date ?? String(b.year ?? '0');
        return db.localeCompare(da);
      });
      break;
    case 'oldest':
      sorted.sort((a, b) => {
        const da = a.publication_date ?? String(a.year ?? '9999');
        const db = b.publication_date ?? String(b.year ?? '9999');
        return da.localeCompare(db);
      });
      break;
    case 'most-cited':
      sorted.sort((a, b) => b.cited_by_count - a.cited_by_count);
      break;
  }
  return sorted;
}

function filterResults(
  results: PaperSearchResult[],
  filters: {
    oaOnly: boolean;
    activeTypes: Set<string>;
    yearFrom: string;
    yearTo: string;
    authorFilter: string;
  },
): PaperSearchResult[] {
  let filtered = results;
  if (filters.oaOnly) {
    filtered = filtered.filter((r) => r.open_access?.is_oa);
  }
  if (filters.activeTypes.size > 0) {
    filtered = filtered.filter(
      (r) => r.type !== null && filters.activeTypes.has(r.type),
    );
  }
  if (filters.yearFrom) {
    const from = Number(filters.yearFrom);
    if (!isNaN(from)) {
      filtered = filtered.filter((r) => (r.year ?? 0) >= from);
    }
  }
  if (filters.yearTo) {
    const to = Number(filters.yearTo);
    if (!isNaN(to)) {
      filtered = filtered.filter((r) => (r.year ?? 9999) <= to);
    }
  }
  if (filters.authorFilter.trim()) {
    const needle = filters.authorFilter.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => r.authors && r.authors.toLowerCase().includes(needle),
    );
  }
  return filtered;
}

type Kind = 'paper' | 'repo' | 'link' | 'pdf';
type PaperMode = 'doi' | 'search' | 'manual';

export type AddItemPaper = { kind: 'paper'; paper: Paper };
export type AddItemRepo = {
  kind: 'repo';
  url: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
};
export type AddItemLink = {
  kind: 'link';
  url: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
};
/**
 * PDF payload — the upload + record dance has already happened by the time the
 * editor sees this; we just hand back the materialised file URLs so the editor
 * can append a `DraftItem` with `kind: 'pdf'` and the four PDF fields populated.
 */
export type AddItemPdf = {
  kind: 'pdf';
  title: string;
  file_url: string;
  thumbnail_url: string;
  file_size_bytes: number;
  file_mime: string;
};
export type AddItemPayload =
  | AddItemPaper
  | AddItemRepo
  | AddItemLink
  | AddItemPdf;

interface Props {
  onClose: () => void;
  onPick: (item: AddItemPayload) => void;
  /**
   * The owner's share id. Required for PDF upload — we presign against
   * `/shares/{id}/...` and the share has to exist server-side before we can
   * upload. When absent on the PDF tab, we auto-save an empty draft via
   * `onAutoSaveDraft` so the picker activates without a manual round-trip.
   */
  shareId?: string;
  /**
   * Auto-save the share as an empty draft and resolve with the new share id.
   * Called the first time the user opens the PDF tab on an unsaved share
   * (W1 — backend now allows empty `items: []`). The editor flips to PATCH
   * mode internally; the URL stays at /dashboard/share/new.
   */
  onAutoSaveDraft?: () => Promise<string>;
}

const KINDS: { id: Kind; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'repo', label: 'Repo' },
  { id: 'link', label: 'Link' },
  { id: 'pdf', label: 'PDF' },
];

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB hard limit (Q2)

const PAPER_MODES: { id: PaperMode; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'Manual' },
];

const DEBOUNCE_MS = 300;

export function AddItemModal({ onClose, onPick, shareId, onAutoSaveDraft }: Props) {
  const [kind, setKind] = useState<Kind>('paper');

  const titleByKind: Record<Kind, string> = {
    paper: 'Add paper',
    repo: 'Add repo',
    link: 'Add link',
    pdf: 'Upload a PDF',
  };

  // Migrated from a hand-rolled `role="dialog"` + Escape useEffect to Radix's
  // Dialog (via the shadcn-ui wrapper). Radix handles focus-trap, Escape and
  // body scroll-lock, so this component no longer needs the manual
  // `document.body.style.overflow` dance. The wide-modal styling is delegated
  // to DialogContent's className override.
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-w-xl flex-col p-0 sm:max-w-3xl"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
      >
        {/* Header bar — bordered, with room on the right for the close X
            rendered by DialogContent's default close button. */}
        <div className="flex items-start justify-between gap-3 border-b border-rule px-6 py-4 pr-14">
          <DialogTitle>{titleByKind[kind]}</DialogTitle>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 pt-4">
            <div className="flex gap-1 rounded-full border border-rule bg-paper-soft p-1">
              {KINDS.map((k) => {
                const active = kind === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    className={[
                      'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition',
                      active
                        ? 'bg-ink text-paper'
                        : 'text-ink-muted hover:text-ink',
                    ].join(' ')}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-6 pb-6 pt-4">
            {kind === 'paper' ? <PaperKindPane onPick={onPick} /> : null}
            {kind === 'repo' ? <RepoKindPane onPick={onPick} /> : null}
            {kind === 'link' ? <LinkKindPane onPick={onPick} /> : null}
            {kind === 'pdf' ? (
              <PdfKindPane
                onPick={onPick}
                shareId={shareId}
                onAutoSaveDraft={onAutoSaveDraft}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
// Paper

function PaperKindPane({ onPick }: { onPick: (p: AddItemPayload) => void }) {
  const [mode, setMode] = useState<PaperMode>('doi');
  const handle = (paper: Paper) => onPick({ kind: 'paper', paper });

  return (
    <div className="grid gap-4">
      <div className="flex gap-1 rounded-md border border-rule bg-paper-soft p-1">
        {PAPER_MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={[
                'flex-1 rounded px-3 py-1 text-xs font-medium transition',
                active ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === 'doi' ? <DoiPane onPick={handle} /> : null}
      {mode === 'search' ? <SearchPane onPick={handle} /> : null}
      {mode === 'manual' ? <ManualPane onPick={handle} /> : null}
    </div>
  );
}

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

  // Sort & filter state
  const [sort, setSort] = useState<SortOption>('relevance');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [oaOnly, setOaOnly] = useState(false);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');

  const rawResults = search.data?.results ?? [];

  // Collect unique types present in raw results for filter pills
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const r of rawResults) {
      if (r.type) types.add(r.type);
    }
    return Array.from(types).sort();
  }, [rawResults]);

  const toggleType = useCallback((t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // Apply filter + sort
  const processed = useMemo(() => {
    const filtered = filterResults(rawResults, {
      oaOnly,
      activeTypes,
      yearFrom,
      yearTo,
      authorFilter,
    });
    return sortResults(filtered, sort);
  }, [rawResults, oaOnly, activeTypes, yearFrom, yearTo, authorFilter, sort]);

  const hasActiveFilters =
    oaOnly ||
    activeTypes.size > 0 ||
    yearFrom !== '' ||
    yearTo !== '' ||
    authorFilter.trim() !== '';

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

      {/* Sort + filter controls — visible once we have results */}
      {rawResults.length > 0 && !picked ? (
        <div className="grid gap-2">
          {/* Sort dropdown + filter toggle row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                  Sort
                </span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="rounded border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setFiltersOpen((p) => !p)}
                className={[
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition',
                  filtersOpen || hasActiveFilters
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M2 4h12M4 8h8M6 12h4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                Filters
                {hasActiveFilters ? (
                  <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-paper">
                    {(oaOnly ? 1 : 0) +
                      activeTypes.size +
                      (yearFrom ? 1 : 0) +
                      (yearTo ? 1 : 0) +
                      (authorFilter.trim() ? 1 : 0)}
                  </span>
                ) : null}
              </button>
            </div>
            {/* Result count */}
            <span className="text-xs text-ink-faint">
              {hasActiveFilters
                ? `${processed.length} of ${rawResults.length} results`
                : `${rawResults.length} results`}
            </span>
          </div>

          {/* Collapsible filter panel */}
          {filtersOpen ? (
            <div className="grid gap-3 rounded-md border border-rule bg-paper-soft p-3">
              {/* Open Access toggle */}
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={oaOnly}
                  onChange={(e) => setOaOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-rule accent-accent"
                />
                <span className="text-xs font-medium text-ink">
                  Open Access only
                </span>
              </label>

              {/* Type pills */}
              {availableTypes.length > 0 ? (
                <div>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                    Type
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {availableTypes.map((t) => {
                      const active = activeTypes.has(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleType(t)}
                          className={[
                            'rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition',
                            active
                              ? 'border-accent bg-accent-soft text-accent'
                              : 'border-rule bg-paper text-ink-muted hover:text-ink',
                          ].join(' ')}
                        >
                          {t.replace('-', ' ')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Year range */}
              <div>
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                  Year range
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={yearFrom}
                    onChange={(e) =>
                      setYearFrom(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                    }
                    placeholder="From"
                    inputMode="numeric"
                    className="w-20 rounded border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  />
                  <span className="text-xs text-ink-faint">to</span>
                  <input
                    type="text"
                    value={yearTo}
                    onChange={(e) =>
                      setYearTo(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                    }
                    placeholder="To"
                    inputMode="numeric"
                    className="w-20 rounded border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Author filter */}
              <div>
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                  Filter by author
                </span>
                <input
                  type="text"
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  placeholder="e.g. Vaswani"
                  autoComplete="off"
                  className="w-full rounded border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-accent sm:w-48"
                />
              </div>

              {/* Clear all filters */}
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setOaOnly(false);
                    setActiveTypes(new Set());
                    setYearFrom('');
                    setYearTo('');
                    setAuthorFilter('');
                  }}
                  className="text-left text-[11px] font-medium text-accent hover:underline"
                >
                  Clear all filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

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
        ) : rawResults.length === 0 ? (
          <EmptyHint
            title="Nothing matched"
            body="Try a different phrasing or fall back to Manual."
          />
        ) : processed.length === 0 ? (
          <EmptyHint
            title="No results match filters"
            body="Try loosening the filters above."
          />
        ) : (
          <ul className="grid gap-2">
            {processed.map((r, idx) => (
              <li key={`${r.doi ?? r.title}-${idx}`}>
                <button
                  type="button"
                  onClick={() => setPicked(r)}
                  className="block w-full rounded-md border border-rule bg-paper-soft p-3 text-left transition hover:bg-paper"
                >
                  {r.is_retracted ? (
                    <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-danger">
                      Retracted
                    </p>
                  ) : null}
                  <p className="font-serif text-sm leading-snug text-ink">
                    {r.title}
                  </p>
                  {r.authors ? (
                    <p className="mt-0.5 text-xs text-ink-muted">{r.authors}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                    {r.container ? <span>{r.container}</span> : null}
                    {r.container && (r.publication_date || r.year) ? <span aria-hidden>·</span> : null}
                    <span>{r.publication_date ?? r.year}</span>
                    {r.type ? (
                      <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                        {r.type.replace('-', ' ')}
                      </span>
                    ) : null}
                    {r.open_access?.is_oa ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-800">
                        OA{r.open_access.oa_status ? ` · ${r.open_access.oa_status}` : ''}
                      </span>
                    ) : null}
                    {r.cited_by_count > 0 ? (
                      <span>{r.cited_by_count.toLocaleString()} cited</span>
                    ) : null}
                    {r.language && r.language !== 'en' ? (
                      <span className="uppercase">{r.language}</span>
                    ) : null}
                  </div>
                  {r.keywords?.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.keywords.slice(0, 4).map((kw) => (
                        <span
                          key={kw}
                          className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] text-ink-muted"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
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
        Add to share
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Repo

function RepoKindPane({ onPick }: { onPick: (p: AddItemPayload) => void }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable buffer the user can tweak before saving.
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [url, setUrl] = useState('');

  const handleFetch = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(
        `/api/github/repo?url=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) {
        if (res.status === 404) {
          setError("GitHub doesn't know that repo, or the URL didn't parse.");
        } else if (res.status === 400) {
          setError("That doesn't look like a GitHub repo URL.");
        } else {
          setError('Lookup failed. Try again, or fill the fields manually.');
        }
        return;
      }
      const data = (await res.json()) as RepoInfo;
      setInfo(data);
      setTitle(data.fullName);
      setSubtitle(data.description ?? '');
      setImageUrl(data.avatarUrl ?? '');
      setUrl(data.htmlUrl);
    } catch {
      setError('Network blip. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const canSave = title.trim().length > 0 && url.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) return;
    onPick({
      kind: 'repo',
      url: url.trim(),
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      image_url: imageUrl.trim() || null,
    });
  };

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-xs uppercase tracking-wider text-ink-muted">
          GitHub URL
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleFetch();
              }
            }}
            placeholder="https://github.com/owner/repo"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={loading || !input.trim()}
            className="rounded-md bg-ink px-4 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '…' : 'Fetch'}
          </button>
        </div>
        <span className="text-xs text-ink-faint">
          We pull the description, stars, language, and license from GitHub.
        </span>
      </label>

      {error ? (
        <div className="rounded-md border border-rule bg-paper-soft px-4 py-3">
          <p className="text-sm font-semibold text-ink">Couldn&apos;t fetch</p>
          <p className="mt-1 text-sm text-ink-muted">{error}</p>
        </div>
      ) : null}

      {info || title || url ? (
        <div className="grid gap-3 rounded-md border border-rule bg-paper-soft p-4">
          {info?.avatarUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={info.avatarUrl}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-md border border-rule bg-paper"
              />
              <div className="min-w-0">
                <p className="truncate font-serif text-sm text-ink">
                  {info.fullName}
                </p>
                <p className="text-xs text-ink-muted">
                  {`★ ${info.stars.toLocaleString()}`}
                  {info.language ? ` · ${info.language}` : ''}
                  {info.license ? ` · ${info.license}` : ''}
                </p>
              </div>
            </div>
          ) : null}

          <ManualField label="Title" value={title} onChange={setTitle} />
          <ManualField
            label="Description"
            value={subtitle}
            onChange={setSubtitle}
          />
          <ManualField
            label="URL"
            value={url}
            onChange={setUrl}
            placeholder="https://github.com/owner/repo"
          />
          <ManualField
            label="Image URL"
            value={imageUrl}
            onChange={setImageUrl}
            placeholder="https://avatars.githubusercontent.com/..."
          />

          <button
            type="button"
            onClick={handleAdd}
            disabled={!canSave}
            className="mt-1 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
          >
            Add to share
          </button>
        </div>
      ) : (
        <EmptyHint
          title="Paste a GitHub repo URL"
          body="We'll fetch the description and metadata."
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Link

function LinkKindPane({ onPick }: { onPick: (p: AddItemPayload) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const canSave = url.trim().length > 0 && title.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) return;
    onPick({
      kind: 'link',
      url: url.trim(),
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      image_url: imageUrl.trim() || null,
    });
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-ink-faint">
        For blog posts, slides, lab pages, datasets — anything with a URL.
      </p>
      <ManualField
        label="URL (required)"
        value={url}
        onChange={setUrl}
        placeholder="https://..."
      />
      <ManualField
        label="Title (required)"
        value={title}
        onChange={setTitle}
      />
      <ManualField
        label="Description"
        value={subtitle}
        onChange={setSubtitle}
        placeholder="Optional one-liner"
      />
      <ManualField
        label="Image URL"
        value={imageUrl}
        onChange={setImageUrl}
        placeholder="https://..."
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!canSave}
        className="mt-2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
      >
        Add to share
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// PDF — file picker + R2 multipart upload + record-pdf-upload (PR-C)
//
// Three-step dance: presign → multipart POST to R2 → record. We use XHR for
// the POST so we get upload-progress events; fetch's body progress isn't
// surfaced in browsers yet. Cancel calls xhr.abort() and bumps the local
// phase back to 'idle' so the user can retry without re-picking the file.

type UploadPhase =
  | 'idle'
  | 'requesting-presign'
  | 'uploading'
  | 'recording'
  | 'done'
  | 'error';

/**
 * Strip the `.pdf` extension and decide whether the bare filename is a
 * useful default title. Working-file naming patterns (`final_v3_...`,
 * `draft_...`) yield poor public titles, so we fall back to the empty
 * string and let the placeholder prompt the user.
 *
 * Earlier revisions also blanked the title when the stripped name had ≥3
 * underscores — that hit legitimate multi-author papers like
 * `Doe_Smith_Jones_2024`. The version-marker / status-keyword heuristics
 * are specific enough on their own.
 */
function deriveDefaultTitle(filename: string): string {
  const stripped = filename.replace(/\.pdf$/i, '');
  const isJunky =
    /_v\d+/i.test(stripped) ||
    /\b(final|draft|copy)\b/i.test(stripped);
  return isJunky ? '' : stripped;
}

function PdfKindPane({
  onPick,
  shareId,
  onAutoSaveDraft,
}: {
  onPick: (p: AddItemPayload) => void;
  shareId?: string;
  onAutoSaveDraft?: () => Promise<string>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [copyrightAck, setCopyrightAck] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  // W6 — flip BEFORE calling `xhr.abort()` so the catch block can distinguish
  // a user-initiated cancel from a real upload failure. Without this, the
  // microtask ordering left phase as 'error' with message "Upload cancelled."
  const cancelledRef = useRef(false);

  // Auto-save draft state (W1) — when the user opens the PDF tab on an unsaved
  // share, we POST an empty draft so the picker activates immediately. The
  // editor flips to PATCH mode internally; the URL stays at /share/new.
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftAttemptedRef = useRef(false);

  const tryAutoSaveDraft = useCallback(async () => {
    if (!onAutoSaveDraft) return;
    setDraftError(null);
    setDraftSaving(true);
    try {
      await onAutoSaveDraft();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.detail
          : "Couldn't start your share — try again.";
      setDraftError(message);
    } finally {
      setDraftSaving(false);
    }
  }, [onAutoSaveDraft]);

  // Kick off the auto-save once when this pane mounts without a shareId.
  // Mount = the user clicked the PDF tab. Subsequent visits (after the parent
  // sets `shareId`) skip the effect since `shareId` is now truthy.
  useEffect(() => {
    if (shareId) return;
    if (!onAutoSaveDraft) return;
    if (draftAttemptedRef.current) return;
    draftAttemptedRef.current = true;
    void tryAutoSaveDraft();
  }, [shareId, onAutoSaveDraft, tryAutoSaveDraft]);

  const fileInputId = 'pdf-file-input';

  const handleFile = (picked: File | null) => {
    setError(null);
    if (!picked) {
      setFile(null);
      setTitle('');
      return;
    }
    // Belt-and-braces MIME check — the browser sets type from the OS, so this
    // mostly catches users who renamed `.docx` to `.pdf`. Server still sniffs
    // the first 8 bytes (Q3).
    const looksLikePdf =
      picked.type === 'application/pdf' ||
      picked.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      setError(PDF_NOT_VALID_MSG);
      setFile(null);
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      setError(PDF_TOO_LARGE_MSG(picked.size));
      setFile(null);
      return;
    }
    setFile(picked);
    // W2 — default title via heuristic. Junky-looking working filenames
    // (`final_v3_…`, lots of `_`) leave the field blank so the placeholder
    // prompts the user for a real title.
    setTitle(deriveDefaultTitle(picked.name));
  };

  const removeFile = () => {
    setFile(null);
    setTitle('');
    setError(null);
    setPhase('idle');
    setProgress(0);
  };

  const cancel = () => {
    // W6 — set the flag BEFORE abort() so the rejection handler can route to
    // 'idle' instead of 'error'. Order matters: xhr.abort() fires onabort
    // synchronously which schedules the rejection microtask.
    cancelledRef.current = true;
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase('idle');
    setProgress(0);
  };

  // Retry must be available after a transport error too — leaving Retry
  // disabled when phase === 'error' meant a transient CORS/network blip
  // locked the picker until the user removed and re-picked the file.
  const canUpload =
    !!file &&
    !!shareId &&
    title.trim().length > 0 &&
    copyrightAck &&
    (phase === 'idle' || phase === 'error');

  const handleUpload = async () => {
    if (!file || !shareId) return;
    setError(null);
    cancelledRef.current = false;
    setPhase('requesting-presign');
    setProgress(0);

    try {
      // 1. Presign
      const presign = await clientApi<PresignResponse>(
        `/shares/${shareId}/items/upload-url`,
        {
          method: 'POST',
          json: {
            filename: file.name,
            mime_type: 'application/pdf',
            size_bytes: file.size,
          },
        },
      );

      // 2. Multipart POST to R2 (XHR for progress events)
      setPhase('uploading');
      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        for (const [k, v] of Object.entries(presign.fields)) {
          formData.append(k, v);
        }
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(ev.loaded / ev.total);
          }
        };
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (${xhr.status}).`));
          }
        };
        xhr.onerror = () => {
          xhrRef.current = null;
          // xhr.onerror fires for transport-level failures — most commonly
          // a CORS preflight rejection, occasionally true offline. The
          // browser refuses to expose more detail for security reasons,
          // but `navigator.onLine` lets us distinguish the two cases.
          const offline =
            typeof navigator !== 'undefined' && navigator.onLine === false;
          if (!offline) {
            // Useful breadcrumb for the next time this regresses — the
            // upload host doesn't show up in any other log line.
            console.warn(
              '[pdf-upload] xhr.onerror on POST to',
              presign.upload_url,
              '— if this is a CORS issue, check the R2 bucket allow-list',
            );
          }
          reject(
            new Error(
              offline
                ? "You're offline. Reconnect and try again."
                : PDF_NETWORK_ERR,
            ),
          );
        };
        xhr.onabort = () => {
          xhrRef.current = null;
          reject(new Error('Upload cancelled.'));
        };
        xhr.open('POST', presign.upload_url);
        xhr.send(formData);
      });

      // 3. Record
      setPhase('recording');
      const item = await clientApi<ShareItemOut>(
        `/shares/${shareId}/items/record-pdf-upload`,
        {
          method: 'POST',
          json: {
            file_key: presign.file_key,
            copyright_ack: true,
            title: title.trim(),
          },
        },
      );

      setPhase('done');
      onPick({
        kind: 'pdf',
        title: item.title,
        file_url: item.file_url ?? '',
        thumbnail_url: item.thumbnail_url ?? '',
        file_size_bytes: item.file_size_bytes ?? file.size,
        file_mime: item.file_mime ?? 'application/pdf',
      });
    } catch (err) {
      // W6 — user-initiated cancels land in 'idle' (cancel() already set
      // phase / progress); other errors surface as 'error'.
      if (cancelledRef.current) {
        cancelledRef.current = false;
        setPhase('idle');
        setProgress(0);
        return;
      }
      setPhase('error');
      const message =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : PDF_GENERIC_ERR;
      setError(message);
    }
  };

  // W1 — auto-save in flight on a brand-new share. Show inline progress so
  // the user knows the picker is about to activate.
  if (!shareId && draftSaving) {
    return (
      <div className="grid gap-3">
        <p className="text-xs text-ink-faint">
          Upload a PDF (poster, slide deck, preprint) and we&apos;ll attach it
          to this share.
        </p>
        <LoadingRow text="Saving draft…" />
      </div>
    );
  }

  // W1 — auto-save failed. Surface the error with a Retry button rather than
  // pretending the picker works.
  if (!shareId && draftError) {
    return (
      <div className="grid gap-3">
        <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm font-semibold text-danger">{draftError}</p>
        </div>
        <button
          type="button"
          onClick={() => void tryAutoSaveDraft()}
          className="self-start rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
        >
          Retry
        </button>
      </div>
    );
  }

  // No share yet AND not auto-saving AND no draft error. Should be
  // unreachable in the editor flow (the parent always passes
  // onAutoSaveDraft, which sets draftSaving=true on first tab open). If
  // this branch ever fires, the previous "Saving draft…" message lied —
  // nothing was being saved and the spinner ran forever. Surface a
  // diagnostic-friendly error and a retry that triggers the autosave
  // (no-op when onAutoSaveDraft is undefined, so the user can at least
  // close the modal). Captures the case where onAutoSaveDraft is wired
  // through but the parent state means the auto-save bailed early.
  if (!shareId) {
    return (
      <div className="grid gap-3">
        <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm font-semibold text-danger">
            Couldn&apos;t start the upload draft.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Save the share from the main form first, then come back and
            attach a PDF.
          </p>
        </div>
        {onAutoSaveDraft ? (
          <button
            type="button"
            onClick={() => void tryAutoSaveDraft()}
            className="self-start rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  const busy = phase === 'requesting-presign' || phase === 'uploading' || phase === 'recording';

  return (
    <div className="grid gap-4">
      <p className="text-xs text-ink-faint">
        Upload a PDF (poster, slide deck, preprint). Up to 25 MB.
      </p>

      {/* File picker / preview */}
      {!file ? (
        <label
          htmlFor={fileInputId}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rule bg-paper-soft px-6 py-10 text-center transition hover:border-accent hover:bg-paper"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-ink-muted"
          >
            <path
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 2v6h6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-sm font-semibold text-ink">Choose a PDF</p>
          <p className="text-xs text-ink-muted">Click to browse — 25 MB max</p>
          <input
            id={fileInputId}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        // W7 — keep filename + size visible above the progress card during
        // upload so the user always knows which file is in flight. Remove
        // disables while busy.
        <div className="flex items-start gap-3 rounded-md border border-rule bg-paper-soft p-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-paper text-ink-muted">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 2v6h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm text-ink">{file.name}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {formatBytes(file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={removeFile}
            disabled={busy}
            className="text-xs font-medium text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      )}

      {/* W5 — trust signal near the picker, ORCID-style. */}
      {!file ? (
        <p className="text-xs text-ink-faint">{PDF_TRUST_NOTE}</p>
      ) : null}

      {/* Title — required, defaults to filename via heuristic (W2). */}
      {file ? (
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
            Title (required)
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Smith et al. 2024 — ICML poster"
            disabled={busy}
            className="rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
      ) : null}

      {/* W4 — longer copyright copy. Gates the upload button. */}
      {file ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-rule bg-paper-soft p-3">
          <input
            type="checkbox"
            checked={copyrightAck}
            onChange={(e) => setCopyrightAck(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded border-rule accent-accent"
          />
          <span className="text-xs text-ink">{PDF_COPYRIGHT_LABEL}</span>
        </label>
      ) : null}

      {/* Progress */}
      {phase === 'uploading' ? (
        <div className="grid gap-2 rounded-md border border-rule bg-paper-soft p-3">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Uploading…</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
            <div
              className="h-full bg-ink transition-[width] duration-150"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={cancel}
            className="self-start text-xs font-medium text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {phase === 'requesting-presign' ? (
        <LoadingRow text="Preparing upload…" />
      ) : null}

      {/* W8 — "Finishing up…" is honest about what the recording step does
          (validate bytes, persist DB row, generate thumbnail). Subtitle
          hints at the 3-8s on the Pi so the user doesn't think it's stuck. */}
      {phase === 'recording' ? (
        <LoadingRow text="Finishing up… (this can take a few seconds)" />
      ) : null}

      {/* Inline error */}
      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
          <p className="text-xs text-danger">{error}</p>
        </div>
      ) : null}

      {/* Upload button — only shown when ready, hidden during in-flight phases */}
      {file && phase !== 'uploading' && phase !== 'recording' && phase !== 'requesting-presign' ? (
        <button
          type="button"
          onClick={handleUpload}
          disabled={!canUpload}
          className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          {phase === 'error' ? 'Retry upload' : 'Upload PDF'}
        </button>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --------------------------------------------------------------------------

function PaperPreview({
  paper,
  onPick,
}: {
  paper: Paper | PaperSearchResult;
  onPick: (p: Paper) => void;
}) {
  const isSearch = 'cited_by_count' in paper;
  const sr = isSearch ? (paper as PaperSearchResult) : null;

  return (
    <div className="rounded-md border border-rule bg-paper-soft p-4">
      {sr?.is_retracted ? (
        <p className="mb-2 rounded bg-danger/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-danger">
          Retracted — verify before citing
        </p>
      ) : null}
      <p className="font-serif text-base leading-snug text-ink">
        {paper.title}
      </p>
      {paper.authors ? (
        <p className="mt-1 text-sm text-ink-muted">{paper.authors}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
        {paper.container ? <span>{paper.container}</span> : null}
        {paper.container && (sr?.publication_date || paper.year) ? <span aria-hidden>·</span> : null}
        <span>{sr?.publication_date ?? paper.year}</span>
        <span aria-hidden>·</span>
        <span className="uppercase tracking-wider">{paper.source}</span>
        {sr?.type ? (
          <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
            {sr.type.replace('-', ' ')}
          </span>
        ) : null}
      </div>
      {sr ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sr.open_access?.is_oa ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-800">
              Open Access{sr.open_access.oa_status ? ` · ${sr.open_access.oa_status}` : ''}
            </span>
          ) : null}
          {sr.cited_by_count > 0 ? (
            <span className="text-xs text-ink-muted">
              {sr.cited_by_count.toLocaleString()} citations
            </span>
          ) : null}
          {sr.pdf_url ? (
            <a
              href={sr.pdf_url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent hover:opacity-80"
            >
              PDF ↗
            </a>
          ) : null}
        </div>
      ) : null}
      {paper.doi ? (
        <p className="mt-1 font-mono text-xs text-ink-faint">{paper.doi}</p>
      ) : null}
      {sr?.keywords && sr.keywords.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {sr.keywords.slice(0, 5).map((kw) => (
            <span
              key={kw}
              className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[10px] text-ink-muted"
            >
              {kw}
            </span>
          ))}
        </div>
      ) : null}
      {sr?.topics && sr.topics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {sr.topics.slice(0, 3).map((t) => (
            <span
              key={t.name}
              className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
            >
              {t.name}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onPick(paper)}
        className="mt-4 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
      >
        Add to share
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
