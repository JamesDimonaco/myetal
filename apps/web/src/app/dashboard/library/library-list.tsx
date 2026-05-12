'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { OrcidIcon } from '@/components/orcid-icon';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import { SHARES_KEY, shareKey } from '@/lib/hooks/useShares';
import type {
  ShareItemInput,
  ShareResponse,
  ShareUpdateInput,
} from '@/types/share';
import type { OrcidSyncResponse, PaperOut, WorkResponse } from '@/types/works';

interface LibraryListProps {
  initialWorks: WorkResponse[];
  orcidId: string | null;
  lastOrcidSyncAt: string | null;
}

type SyncBanner =
  | { kind: 'running' }
  | { kind: 'success'; result: OrcidSyncResponse }
  | { kind: 'error'; message: string }
  | { kind: 'needs-orcid'; message: string };

type AddedToast =
  | { kind: 'added'; paperTitle: string; shareName: string }
  | { kind: 'duplicate'; paperTitle: string; shareName: string };

export function LibraryList({
  initialWorks,
  orcidId,
  lastOrcidSyncAt,
}: LibraryListProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: works } = useQuery({
    queryKey: ['works'],
    queryFn: () => clientApi<WorkResponse[]>('/me/works'),
    initialData: initialWorks,
  });

  const [doi, setDoi] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<SyncBanner | null>(null);
  const [addedToast, setAddedToast] = useState<AddedToast | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addWork = useMutation({
    mutationFn: (identifier: string) =>
      clientApi<WorkResponse>('/me/works', {
        method: 'POST',
        json: { identifier },
      }),
    onSuccess: () => {
      setDoi('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to add paper');
    },
  });

  const hideWork = useMutation({
    mutationFn: (paperId: string) =>
      clientApi<void>(`/me/works/${paperId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });

  const restoreWork = useMutation({
    mutationFn: (paperId: string) =>
      clientApi<WorkResponse>(`/me/works/${paperId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });

  // Single mutation hook shared by auto-fire and manual button — `isPending`
  // serves as the runtime guard, so a button click during auto-fire is a no-op
  // (see `disabled` on the button below).
  const syncOrcid = useMutation({
    mutationFn: () =>
      clientApi<OrcidSyncResponse>('/me/works/sync-orcid', { method: 'POST' }),
    onMutate: () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      setBanner({ kind: 'running' });
    },
    onSuccess: (result) => {
      setBanner({ kind: 'success', result });
      queryClient.invalidateQueries({ queryKey: ['works'] });
      // Re-fetch the SSR data so `last_orcid_sync_at` is reflected immediately,
      // and a subsequent navigation back doesn't re-trigger the auto-fire.
      router.refresh();
      // Auto-dismiss after 8s
      dismissTimerRef.current = setTimeout(() => {
        setBanner(null);
        dismissTimerRef.current = null;
      }, 8000);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setBanner({
            kind: 'needs-orcid',
            message:
              'Add your ORCID iD on your profile to import your works.',
          });
          return;
        }
        if (err.status === 503) {
          setBanner({
            kind: 'error',
            message: 'ORCID is unavailable right now. Try again in a minute.',
          });
          return;
        }
        if (err.status === 429) {
          setBanner({
            kind: 'error',
            message: 'Slow down — try again in a minute.',
          });
          return;
        }
      }
      setBanner({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : "Couldn't import from ORCID. Try again in a minute.",
      });
    },
  });

  // Auto-fire on first mount when orcid_id is set but never synced.
  // Ref guard ensures this fires exactly once even under React 18 StrictMode's
  // double-render of effects in dev. We also gate on `isPending` defensively.
  const autoFiredRef = useRef(false);
  const syncMutate = syncOrcid.mutate;
  const syncIsPending = syncOrcid.isPending;
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!orcidId) return;
    if (lastOrcidSyncAt !== null) return;
    if (syncIsPending) return;
    autoFiredRef.current = true;
    syncMutate();
  }, [orcidId, lastOrcidSyncAt, syncIsPending, syncMutate]);

  // Cleanup the auto-dismiss timers on unmount.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      if (addedTimerRef.current) {
        clearTimeout(addedTimerRef.current);
        addedTimerRef.current = null;
      }
    };
  }, []);

  // Append a paper to an existing share via PATCH /shares/{id}. We fetch the
  // current share so we can preserve existing items (the PATCH replaces items
  // wholesale when `items` is provided).
  const addToShare = useMutation({
    mutationFn: async (args: { share: ShareResponse; paper: PaperOut }) => {
      const { share, paper } = args;
      const fresh = await clientApi<ShareResponse>(`/shares/${share.id}`);
      // Skip silently if the paper is already in the share (DOI match) so we
      // don't create duplicates. Title-only would over-match.
      const dupe =
        paper.doi &&
        fresh.items.some(
          (it) => it.kind === 'paper' && it.doi && it.doi === paper.doi,
        );
      if (dupe) return { share: fresh, alreadyPresent: true };

      const existingItems: ShareItemInput[] = fresh.items.map((it) => ({
        kind: it.kind,
        title: it.title,
        scholar_url: it.scholar_url,
        doi: it.doi,
        authors: it.authors,
        year: it.year,
        notes: it.notes,
        url: it.url,
        subtitle: it.subtitle,
        image_url: it.image_url,
      }));
      const newItem: ShareItemInput = {
        kind: 'paper',
        title: paper.title,
        scholar_url: null,
        doi: paper.doi,
        authors: paper.authors,
        year: paper.year,
        notes: null,
        url: paper.url,
        subtitle: paper.subtitle,
        image_url: paper.image_url,
      };
      const body: ShareUpdateInput = {
        items: [...existingItems, newItem],
      };
      const updated = await clientApi<ShareResponse>(`/shares/${share.id}`, {
        method: 'PATCH',
        json: body,
      });
      return { share: updated, alreadyPresent: false };
    },
    onSuccess: ({ share, alreadyPresent }, vars) => {
      queryClient.setQueryData(shareKey(share.id), share);
      queryClient.invalidateQueries({ queryKey: SHARES_KEY });
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      setAddedToast({
        kind: alreadyPresent ? 'duplicate' : 'added',
        paperTitle: vars.paper.title,
        shareName: share.name,
      });
      addedTimerRef.current = setTimeout(() => {
        setAddedToast(null);
        addedTimerRef.current = null;
      }, 4000);
    },
    onError: (err, vars) => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      const detail =
        err instanceof ApiError
          ? err.detail || `Could not add to share (${err.status}).`
          : `Could not add "${vars.paper.title}" to a share. Try again.`;
      setBanner({ kind: 'error', message: detail });
    },
  });

  const importDisabled = !orcidId || syncOrcid.isPending;
  const importLabel = syncOrcid.isPending
    ? 'Importing from ORCID…'
    : lastOrcidSyncAt === null
      ? 'Import from ORCID'
      : 'Re-sync from ORCID';

  return (
    <>
      {/* Sync banner */}
      {banner ? (
        <SyncBannerView banner={banner} onDismiss={() => setBanner(null)} />
      ) : null}

      {/* "Added to share" / "Already in share" toast */}
      {addedToast ? (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-3 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-ink"
        >
          <span>
            {addedToast.kind === 'duplicate' ? 'Already in ' : 'Added '}
            {addedToast.kind === 'added' ? (
              <>
                <span className="font-medium">
                  &ldquo;{addedToast.paperTitle}&rdquo;
                </span>{' '}
                to{' '}
              </>
            ) : null}
            <span className="font-medium">
              &ldquo;{addedToast.shareName}&rdquo;
            </span>
            .
          </span>
          <button
            type="button"
            onClick={() => setAddedToast(null)}
            aria-label="Dismiss"
            className="-mr-1 rounded-md px-2 text-ink-muted transition hover:text-ink"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Add by DOI + Import from ORCID. On phones the form stacks above
          the ORCID button so the DOI input doesn't get squeezed to a
          handful of characters by the Add-paper button next to it. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = doi.trim();
            if (trimmed) addWork.mutate(trimmed);
          }}
        >
          <input
            type="text"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
            placeholder="Paste a DOI (e.g. 10.1234/example)"
            className="min-h-[44px] flex-1 rounded-md border border-rule bg-paper px-4 py-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={addWork.isPending || !doi.trim()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
          >
            {addWork.isPending ? 'Adding...' : '+ Add paper'}
          </button>
        </form>
        <div className="flex flex-col items-start">
          <button
            type="button"
            onClick={() => syncOrcid.mutate()}
            disabled={importDisabled}
            aria-label={importLabel}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
          >
            <OrcidIcon size={16} />
            {importLabel}
          </button>
          {!orcidId ? (
            <p className="mt-1 text-xs text-ink-muted">
              Add your ORCID iD on your profile first
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-danger">{error}</p>
      ) : null}

      {/* E8 — ORCID auto-import network failure. The auto-fire on first
          mount can fail silently; surface a banner with a Retry CTA. The
          existing SyncBanner shows transient running/success states; this
          one persists until dismissed or fixed. */}
      {syncOrcid.isError && works.length === 0 && orcidId ? (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink"
        >
          <p className="flex-1">
            We couldn&apos;t reach ORCID. Pull down to retry, or paste a DOI
            to add a paper manually.
          </p>
          <button
            type="button"
            onClick={() => syncOrcid.mutate()}
            disabled={syncOrcid.isPending}
            className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft disabled:opacity-50"
          >
            {syncOrcid.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}

      {/* Works list */}
      {works.length === 0 ? (
        <EmptyLibraryCopy
          orcidId={orcidId}
          lastOrcidSyncAt={lastOrcidSyncAt}
        />
      ) : (
        <div className="mt-8 space-y-0">
          {works.map((work) => (
            <WorkCard
              key={work.paper.id}
              work={work}
              orcidId={orcidId}
              onHide={() => hideWork.mutate(work.paper.id)}
              onRestore={() => restoreWork.mutate(work.paper.id)}
              onAddToShare={(share) =>
                addToShare.mutate({ share, paper: work.paper })
              }
              isHiding={hideWork.isPending}
              isRestoring={restoreWork.isPending}
              isAddingToShare={
                addToShare.isPending &&
                addToShare.variables?.paper.id === work.paper.id
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Empty-library copy that branches on whether the user has linked ORCID and
 * whether we've ever synced (E1 vs E2). The E8 ORCID-network-failure banner
 * lives above this, so a fresh user with a flaky connection sees both: the
 * "we couldn't reach ORCID" alert and the relevant empty-state nudge.
 */
function EmptyLibraryCopy({
  orcidId,
  lastOrcidSyncAt,
}: {
  orcidId: string | null;
  lastOrcidSyncAt: string | null;
}) {
  if (orcidId && lastOrcidSyncAt) {
    return (
      <p className="mt-10 max-w-prose text-center text-sm text-ink-muted sm:mx-auto">
        We synced your ORCID record but didn&apos;t find any works yet. Add
        your first paper at{' '}
        <a
          href="https://orcid.org"
          target="_blank"
          rel="noreferrer noopener"
          className="underline-offset-2 hover:underline"
        >
          orcid.org
        </a>
        , or paste a DOI here to get started.
      </p>
    );
  }
  if (!orcidId) {
    return (
      <p className="mt-10 max-w-prose text-center text-sm text-ink-muted sm:mx-auto">
        Your library is where your papers live. Add your{' '}
        <Link
          href="/dashboard/profile"
          className="underline-offset-2 hover:underline"
        >
          ORCID iD on your profile
        </Link>{' '}
        to auto-import them, or paste a DOI above to add one manually.
      </p>
    );
  }
  return (
    <p className="mt-10 text-center text-sm text-ink-muted">
      Your library is empty. Paste a DOI above to get started.
    </p>
  );
}

function SyncBannerView({
  banner,
  onDismiss,
}: {
  banner: SyncBanner;
  onDismiss: () => void;
}) {
  let body: React.ReactNode;
  let tone = 'border-rule bg-paper-soft text-ink';

  if (banner.kind === 'running') {
    body = (
      <span className="inline-flex items-center gap-2">
        <Spinner />
        <span>Importing your works from ORCID…</span>
      </span>
    );
  } else if (banner.kind === 'success') {
    const { added, updated, unchanged, skipped } = banner.result;
    body = (
      <span>
        Imported {added} new, {updated} updated, {unchanged} already in your
        library, {skipped} skipped.
      </span>
    );
  } else if (banner.kind === 'needs-orcid') {
    body = (
      <span>
        {banner.message}{' '}
        <a
          href="/dashboard/profile"
          className="underline decoration-ink-faint underline-offset-2 hover:decoration-ink"
        >
          Go to profile
        </a>
        .
      </span>
    );
  } else {
    tone = 'border-danger/40 bg-danger/5 text-ink';
    body = <span>{banner.message}</span>;
  }

  return (
    <div
      role="status"
      className={`mb-4 flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${tone}`}
    >
      <div className="flex-1">{body}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 rounded-md px-2 text-ink-muted transition hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-ink"
    />
  );
}

function WorkCard({
  work,
  orcidId,
  onHide,
  onRestore,
  onAddToShare,
  isHiding,
  isRestoring,
  isAddingToShare,
}: {
  work: WorkResponse;
  orcidId: string | null;
  onHide: () => void;
  onRestore: () => void;
  onAddToShare: (share: ShareResponse) => void;
  isHiding: boolean;
  isRestoring: boolean;
  isAddingToShare: boolean;
}) {
  const { paper } = work;
  const meta = [paper.authors, paper.year ? String(paper.year) : null, paper.venue]
    .filter(Boolean)
    .join(' · ');

  const isHidden = work.hidden_at !== null;
  const isOrcidImport = work.added_via === 'orcid';

  return (
    <article className={`border-t border-rule py-5 first:border-t-0 ${isHidden ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {paper.url ? (
            <a
              href={paper.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-serif text-lg leading-snug text-ink underline decoration-rule decoration-1 underline-offset-4 transition hover:decoration-ink"
            >
              {paper.title}
              <span aria-hidden className="ml-1 text-ink-faint">
                ↗
              </span>
            </a>
          ) : (
            <span className="font-serif text-lg leading-snug text-ink">
              {paper.title}
            </span>
          )}
          {isOrcidImport ? (
            <OrcidProvenanceBadge orcidId={orcidId} />
          ) : null}
          {meta ? <p className="mt-1 text-sm text-ink-muted">{meta}</p> : null}
          {paper.doi ? (
            <p className="mt-1 text-xs text-ink-faint">
              DOI{' '}
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline-offset-2 hover:underline"
              >
                {paper.doi}
              </a>
            </p>
          ) : null}
          <p className="mt-1 text-xs text-ink-faint">
            Added via {work.added_via}
          </p>
          {!isHidden ? (
            <div className="mt-3">
              <AddToShareMenu
                paperId={work.paper.id}
                onPick={onAddToShare}
                isAdding={isAddingToShare}
              />
            </div>
          ) : null}
        </div>
        <div className="flex-shrink-0">
          {isHidden ? (
            <button
              onClick={onRestore}
              disabled={isRestoring}
              className="inline-flex min-h-[40px] items-center rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={onHide}
              disabled={isHiding}
              className="inline-flex min-h-[40px] items-center rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Hide
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * "Imported from ORCID ↗" provenance pill. The arrow links to the user's
 * public ORCID profile so a viewer can verify the source. Informational only —
 * no in-app action.
 */
function OrcidProvenanceBadge({ orcidId }: { orcidId: string | null }) {
  const baseClass =
    'mt-1.5 inline-flex items-center gap-1 rounded-full border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted';
  if (!orcidId) {
    return <span className={baseClass}>Imported from ORCID</span>;
  }
  return (
    <a
      href={`https://orcid.org/${orcidId}`}
      target="_blank"
      rel="noreferrer noopener"
      className={`${baseClass} transition hover:border-ink/30 hover:text-ink`}
    >
      Imported from ORCID
      <span aria-hidden>↗</span>
    </a>
  );
}

/**
 * "Add to share..." button + popover. Loads the user's shares lazily on first
 * click (the dashboard shell preloads `/shares` server-side, but the library
 * page does not — so we fetch on demand and cache via TanStack).
 *
 * The popover lists existing shares plus a "+ New share" entry as the last
 * row that just navigates to /dashboard/share/new — pre-attaching the paper
 * inline isn't supported by the share editor today, so we take the spec's
 * documented fallback rather than building a query-param hack.
 */
function AddToShareMenu({
  paperId,
  onPick,
  isAdding,
}: {
  paperId: string;
  onPick: (share: ShareResponse) => void;
  isAdding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: shares, isLoading, isError, refetch } = useQuery({
    queryKey: SHARES_KEY,
    queryFn: () => clientApi<ShareResponse[]>('/shares'),
    enabled: open,
    staleTime: 30_000,
  });

  // Pre-attach this paper when the user clicks "+ New share". The new-share
  // page reads ?paper_id and seeds the editor's first item from /me/works.
  const newShareHref = `/dashboard/share/new?paper_id=${encodeURIComponent(paperId)}`;

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isAdding}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-[40px] items-center rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
      >
        {isAdding ? 'Adding…' : 'Add to share…'}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-rule bg-paper shadow-lg"
        >
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-ink-muted">
              Loading shares…
            </div>
          ) : isError ? (
            <div className="px-3 py-3 text-xs text-ink">
              <p>Couldn&apos;t load your shares.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 rounded-md border border-ink/20 px-2 py-1 text-[11px] font-medium text-ink transition hover:border-ink/40"
              >
                Try again
              </button>
            </div>
          ) : !shares || shares.length === 0 ? (
            // 0-share empty state — make it a clear CTA, not a quiet line.
            // The bottom "+ New share" entry below is still there, but the
            // primary action when you have no shares is to create one.
            <div className="px-3 py-3">
              <p className="text-sm font-medium text-ink">
                You don&apos;t have any shares yet.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Create your first share with this paper attached.
              </p>
              <Link
                href={newShareHref}
                onClick={() => setOpen(false)}
                className="mt-3 inline-flex items-center justify-center rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90"
              >
                Create share with this paper
              </Link>
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {shares.map((share) => (
                <li key={share.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onPick(share);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-ink transition hover:bg-paper-soft"
                  >
                    <span className="truncate">{share.name}</span>
                    <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                      {share.items.length}{' '}
                      {share.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* "+ New share with this paper" — passes paper_id so the new-share
              page seeds the editor with this paper as the first item. Hidden
              when the empty-state CTA above already fills the role. */}
          {shares && shares.length > 0 ? (
            <Link
              href={newShareHref}
              onClick={() => setOpen(false)}
              className="block border-t border-rule px-3 py-2 text-xs font-medium text-ink transition hover:bg-paper-soft"
            >
              + New share with this paper
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
