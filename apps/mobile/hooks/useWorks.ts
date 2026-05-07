import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { WorkResponse } from '@/types/works';

export interface OrcidSyncResult {
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
}

export function useWorks() {
  return useQuery({
    queryKey: ['works'],
    queryFn: () => api<WorkResponse[]>('/me/works'),
  });
}

export function useAddWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identifier: string) =>
      api<WorkResponse>('/me/works', {
        method: 'POST',
        json: { identifier },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

export function useHideWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paperId: string) =>
      api<void>(`/me/works/${paperId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

export function useRestoreWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paperId: string) =>
      api<WorkResponse>(`/me/works/${paperId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

/**
 * Trigger a sync of the current user's public works from ORCID. The endpoint
 * is synchronous (see docs/tickets/orcid-import-and-polish.md §1.3) — the
 * promise resolves with per-bucket counts once the import completes. On
 * success we invalidate both `['works']` (so the library re-fetches) and the
 * me-query (so `last_orcid_sync_at` is picked up and the auto-fire guard on
 * library re-mount sees a non-null value).
 */
export function useSyncOrcid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<OrcidSyncResult>('/me/works/sync-orcid', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
