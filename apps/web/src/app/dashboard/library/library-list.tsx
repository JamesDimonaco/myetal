'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { OrcidIcon } from '@/components/orcid-icon';
import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import type { OrcidSyncResponse, WorkResponse } from '@/types/works';

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
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Cleanup the auto-dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, []);

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

      {/* Add by DOI + Import from ORCID */}
      <div className="flex flex-wrap items-stretch gap-3">
        <form
          className="flex flex-1 gap-3"
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
            className="flex-1 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={addWork.isPending || !doi.trim()}
            className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
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
            className="inline-flex items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
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

      {/* Works list */}
      {works.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-muted">
          Your library is empty. Paste a DOI above to get started.
        </p>
      ) : (
        <div className="mt-8 space-y-0">
          {works.map((work) => (
            <WorkCard
              key={work.paper.id}
              work={work}
              onHide={() => hideWork.mutate(work.paper.id)}
              onRestore={() => restoreWork.mutate(work.paper.id)}
              isHiding={hideWork.isPending}
              isRestoring={restoreWork.isPending}
            />
          ))}
        </div>
      )}
    </>
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
  onHide,
  onRestore,
  isHiding,
  isRestoring,
}: {
  work: WorkResponse;
  onHide: () => void;
  onRestore: () => void;
  isHiding: boolean;
  isRestoring: boolean;
}) {
  const { paper } = work;
  const meta = [paper.authors, paper.year ? String(paper.year) : null, paper.venue]
    .filter(Boolean)
    .join(' · ');

  const isHidden = work.hidden_at !== null;

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
        </div>
        <div className="flex-shrink-0">
          {isHidden ? (
            <button
              onClick={onRestore}
              disabled={isRestoring}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 disabled:opacity-50"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={onHide}
              disabled={isHiding}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Hide
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
