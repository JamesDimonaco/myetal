'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import type { WorkResponse } from '@/types/works';

export function LibraryList({ initialWorks }: { initialWorks: WorkResponse[] }) {
  const queryClient = useQueryClient();

  const { data: works } = useQuery({
    queryKey: ['works'],
    queryFn: () => clientApi<WorkResponse[]>('/me/works'),
    initialData: initialWorks,
  });

  const [doi, setDoi] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      {/* Add by DOI */}
      <form
        className="flex gap-3"
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
