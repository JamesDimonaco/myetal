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

import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import type { RepoInfo } from '@/lib/github';
import {
  extractDoi,
  useLookupPaper,
  useSearchPapers,
} from '@/lib/hooks/usePapers';
import type { Paper, PaperSearchResult } from '@/types/paper';

type Kind = 'paper' | 'repo' | 'link';
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
export type AddItemPayload = AddItemPaper | AddItemRepo | AddItemLink;

interface Props {
  onClose: () => void;
  onPick: (item: AddItemPayload) => void;
}

const KINDS: { id: Kind; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'repo', label: 'Repo' },
  { id: 'link', label: 'Link' },
];

const PAPER_MODES: { id: PaperMode; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'Manual' },
];

const DEBOUNCE_MS = 300;

export function AddItemModal({ onClose, onPick }: Props) {
  const [kind, setKind] = useState<Kind>('paper');

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

  const titleByKind: Record<Kind, string> = {
    paper: 'Add paper',
    repo: 'Add repo',
    link: 'Add link',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-item-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 px-4 py-8 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-xl flex-col rounded-xl border border-rule bg-paper shadow-2xl" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
        <div className="flex items-start justify-between gap-3 border-b border-rule px-6 py-4">
          <h2 id="add-item-title" className="font-serif text-xl text-ink">
            {titleByKind[kind]}
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
          </div>
        </div>
      </div>
    </div>
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
                  {r.keywords.length > 0 ? (
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
            Add to project
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
        Add to project
      </button>
    </div>
  );
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
