'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';
import { formatRelativeTime } from '@/lib/format';
import type { SessionResponse } from '@/types/auth';

const SESSIONS_KEY = ['auth', 'sessions'] as const;

interface Props {
  initialSessions: SessionResponse[];
}

/**
 * Active-sessions list with per-session revoke. Hydrated from SSR; refetches
 * after a revoke so a freshly-killed row disappears.
 */
export function SessionsList({ initialSessions }: Props) {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => clientApi<SessionResponse[]>('/auth/me/sessions'),
    initialData: initialSessions,
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      clientApi<void>(`/auth/me/sessions/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const sessions = data ?? [];

  if (isError) {
    return (
      <p className="text-sm text-ink-muted">
        Couldn&apos;t load sessions:{' '}
        {error instanceof ApiError ? error.detail : 'unknown error'}
      </p>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No active sessions besides this one.
      </p>
    );
  }

  return (
    <ul className="grid gap-2">
      {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper-soft px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-ink-faint">
                {s.id.slice(0, 8)}…
              </p>
              <p className="mt-0.5 text-ink">
                Issued {formatRelativeTime(s.issued_at)}
                {s.revoked ? (
                  <span className="ml-2 text-xs uppercase tracking-wider text-ink-faint">
                    revoked
                  </span>
                ) : null}
              </p>
            </div>
            {!s.revoked ? (
              <button
                type="button"
                onClick={() => revoke.mutate(s.id)}
                disabled={revoke.isPending}
                className="rounded-md border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-paper disabled:opacity-60"
              >
                {revoke.isPending && revoke.variables === s.id
                  ? 'Revoking…'
                  : 'Revoke'}
              </button>
            ) : null}
          </li>
      ))}
    </ul>
  );
}
