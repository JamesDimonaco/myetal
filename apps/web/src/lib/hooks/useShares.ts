'use client';

/**
 * TanStack Query hooks for /shares. Mirrors apps/mobile/hooks/useShares.ts —
 * same query keys, same mutation shapes — so the contract is uniform across
 * platforms.
 *
 * The dashboard route uses `initialData` from the server-fetched list to
 * avoid a flash of empty content; subsequent invalidations refetch via
 * `clientApi`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { clientApi } from '@/lib/client-api';
import type {
  ShareCreateInput,
  ShareResponse,
  ShareUpdateInput,
} from '@/types/share';

export const SHARES_KEY = ['shares'] as const;
export const shareKey = (id: string) => ['shares', id] as const;

export function useShares(initialData?: ShareResponse[]) {
  return useQuery({
    queryKey: SHARES_KEY,
    queryFn: () => clientApi<ShareResponse[]>('/shares'),
    initialData,
  });
}

export function useShare(id: string | undefined, initialData?: ShareResponse) {
  return useQuery({
    queryKey: id ? shareKey(id) : ['shares', 'unknown'],
    queryFn: () => clientApi<ShareResponse>(`/shares/${id}`),
    enabled: Boolean(id) && id !== 'new',
    initialData,
  });
}

export function useCreateShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShareCreateInput) =>
      clientApi<ShareResponse>('/shares', { method: 'POST', json: body }),
    onSuccess: (created) => {
      qc.setQueryData(shareKey(created.id), created);
      qc.invalidateQueries({ queryKey: SHARES_KEY });
    },
  });
}

export function useUpdateShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShareUpdateInput) =>
      clientApi<ShareResponse>(`/shares/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (updated) => {
      qc.setQueryData(shareKey(updated.id), updated);
      qc.invalidateQueries({ queryKey: SHARES_KEY });
    },
  });
}

export function useDeleteShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      clientApi<void>(`/shares/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: shareKey(id) });
      qc.invalidateQueries({ queryKey: SHARES_KEY });
    },
  });
}
