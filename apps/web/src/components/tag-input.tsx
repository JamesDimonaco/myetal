'use client';

import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { clientApi } from '@/lib/client-api';
import type { Tag } from '@/types/share';

const DEBOUNCE_MS = 200;
const DEFAULT_MAX = 5;

interface Props {
  /** Slugs already attached to the share. */
  value: string[];
  onChange: (slugs: string[]) => void;
  /** Hard cap on attached tags (Q10 = 5). */
  max?: number;
  /** Hint text rendered when the input is in non-empty state. Optional. */
  placeholder?: string;
  /** Disable the entire control (e.g. while saving). */
  disabled?: boolean;
}

/**
 * Canonicalise a free-form string the way the backend does: lowercased,
 * trimmed, internal whitespace collapsed to single hyphens, then non-allowed
 * characters stripped. Mirroring this on the client lets the chip the user
 * commits read as the canonical slug they'll see everywhere else.
 */
function canonicalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Title-case the slug for inline preview (the API returns a `label` for
 *  known tags, but newly-typed ones don't have one yet). */
function labelFromSlug(slug: string): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Tag chip + autocomplete input. Pure React + tailwind; no extra deps.
 *
 * Keyboard:
 *   - Enter / Comma → commit current text as a chip
 *   - Backspace on empty input → pop the last chip
 *   - ArrowUp / ArrowDown → move highlight in the suggestion list
 *   - Escape → close the dropdown
 *
 * Network:
 *   - Empty query (focus, no typing yet) → /public/tags/popular?limit=10
 *   - Non-empty query → /public/tags?q=<text>&limit=10, debounced 200ms
 *   The client-api proxy re-issues these as same-origin /api/proxy/public/...
 *   so they work for anon and authed sessions alike.
 */
export function TagInput({
  value,
  onChange,
  max = DEFAULT_MAX,
  placeholder = 'Add a tag and press Enter',
  disabled,
}: Props) {
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popularEnabled, setPopularEnabled] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const atCap = value.length >= max;
  const trimmed = text.trim();
  const debouncedTrimmed = debouncedText.trim();

  // Debounce the text the network layer sees. 200ms — short enough that
  // typing feels live, long enough that ten-finger typists don't fire a
  // request per keystroke. setTimeout writing local state is fine here;
  // the lint rule that flags setState-in-effect specifically targets calls
  // that happen synchronously during render commit.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedText(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  // Suggestions for the typed query. Driven by TanStack so we cache by query
  // string and avoid a fetch-on-every-keystroke even after the debounce.
  const suggestionsQuery = useQuery({
    queryKey: ['tag-suggestions', debouncedTrimmed],
    queryFn: () =>
      clientApi<Tag[]>(
        `/public/tags?q=${encodeURIComponent(debouncedTrimmed)}&limit=10`,
      ),
    enabled: open && debouncedTrimmed.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Popular tags — fetched once on first focus. Same TanStack cache so a
  // second focus doesn't re-hit the network.
  const popularQuery = useQuery({
    queryKey: ['tag-popular'],
    queryFn: () => clientApi<Tag[]>('/public/tags/popular?limit=10'),
    enabled: popularEnabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Stable references for the two pools so useMemo dependencies don't churn
  // on every render (TanStack returns undefined while the query is idle).
  const suggestionsData = suggestionsQuery.data;
  const popularData = popularQuery.data;
  const suggestions = useMemo<Tag[]>(
    () => suggestionsData ?? [],
    [suggestionsData],
  );
  const popular = useMemo<Tag[]>(() => popularData ?? [], [popularData]);
  const loading = suggestionsQuery.isFetching;

  // Click-outside closes the dropdown without committing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visibleSuggestions = useMemo<Tag[]>(() => {
    const pool = trimmed ? suggestions : popular;
    // Filter out anything already attached so users can't double-add.
    return pool.filter((t) => !value.includes(t.slug));
  }, [trimmed, suggestions, popular, value]);

  // Clamp the highlight so it never points past the end of the current
  // suggestion list (which can shrink when the query changes or when the
  // user attaches a chip). Computed at read-time to avoid a setState-in-
  // effect dance.
  const safeHighlight =
    visibleSuggestions.length === 0
      ? 0
      : Math.min(highlight, visibleSuggestions.length - 1);

  const commit = useCallback(
    (slug: string) => {
      const canonical = canonicalise(slug);
      if (!canonical) return;
      if (value.includes(canonical)) {
        setText('');
        return;
      }
      if (value.length >= max) return;
      onChange([...value, canonical]);
      setText('');
      setDebouncedText('');
      setHighlight(0);
    },
    [value, onChange, max],
  );

  const removeAt = useCallback(
    (idx: number) => {
      const next = value.slice(0, idx).concat(value.slice(idx + 1));
      onChange(next);
    },
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Prefer the highlighted suggestion if the dropdown is open and has
      // entries; otherwise commit the typed text as-is.
      if (open && visibleSuggestions[safeHighlight]) {
        e.preventDefault();
        commit(visibleSuggestions[safeHighlight].slug);
        return;
      }
      if (trimmed) {
        e.preventDefault();
        commit(trimmed);
      }
      return;
    }
    if (
      e.key === 'Backspace' &&
      text === '' &&
      // Mid-IME composition (Japanese/Chinese/Korean keyboards) — let the
      // backspace fall through to the composer so it doesn't pop a chip.
      !e.nativeEvent.isComposing &&
      value.length > 0
    ) {
      e.preventDefault();
      removeAt(value.length - 1);
      return;
    }
    if (e.key === 'ArrowDown') {
      if (visibleSuggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((safeHighlight + 1) % visibleSuggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (visibleSuggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlight(
        safeHighlight === 0 ? visibleSuggestions.length - 1 : safeHighlight - 1,
      );
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
  };

  const showDropdown = open && visibleSuggestions.length > 0;

  return (
    <div ref={containerRef} className="relative grid gap-1">
      <div
        className={[
          'flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-md border bg-paper px-2 py-1.5',
          atCap ? 'border-rule' : 'border-rule focus-within:border-accent',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {value.map((slug, idx) => (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full border border-ink bg-ink px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-paper"
          >
            {labelFromSlug(slug)}
            <button
              type="button"
              aria-label={`Remove ${labelFromSlug(slug)}`}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(idx);
              }}
              disabled={disabled}
              className="-mr-0.5 rounded-full px-1 leading-none text-paper/80 transition hover:text-paper"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setPopularEnabled(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled || atCap}
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && visibleSuggestions[safeHighlight]
              ? `${listboxId}-opt-${safeHighlight}`
              : undefined
          }
          className="min-w-[8rem] flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
        />
      </div>

      <p className="text-[11px] text-ink-faint">
        {atCap ? `${max} max — remove one to add another` : `${max} max`}
        {loading ? ' · searching…' : ''}
      </p>

      {showDropdown ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%-1.25rem)] z-20 mt-2 max-h-64 overflow-y-auto rounded-md border border-rule bg-paper shadow-lg"
        >
          {!trimmed ? (
            <li
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-faint"
              aria-hidden
            >
              Popular
            </li>
          ) : null}
          {visibleSuggestions.map((tag, idx) => {
            const active = idx === safeHighlight;
            return (
              <li
                key={tag.id}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown beats blur — keeps focus on the input so the
                  // dropdown doesn't disappear before commit() runs.
                  e.preventDefault();
                  commit(tag.slug);
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={[
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                  active ? 'bg-paper-soft text-ink' : 'text-ink',
                ].join(' ')}
              >
                <span className="truncate">{tag.label}</span>
                <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                  {tag.usage_count}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
