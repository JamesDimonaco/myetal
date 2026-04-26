import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  ShareCreateInput,
  ShareResponse,
  ShareUpdateInput,
} from '@/types/share';

const SHARES_KEY = ['shares'] as const;
const shareKey = (id: string) => ['shares', id] as const;

/** All shares owned by the current user. */
export function useShares() {
  return useQuery({
    queryKey: SHARES_KEY,
    queryFn: () => api<ShareResponse[]>('/shares'),
  });
}

/** Single share by id (used by the editor). */
export function useShare(id: string | undefined) {
  return useQuery({
    queryKey: id ? shareKey(id) : ['shares', 'unknown'],
    queryFn: () => api<ShareResponse>(`/shares/${id}`),
    enabled: Boolean(id) && id !== 'new',
  });
}

export function useCreateShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShareCreateInput) =>
      api<ShareResponse>('/shares', { method: 'POST', json: body }),
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
      api<ShareResponse>(`/shares/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (updated) => {
      qc.setQueryData(shareKey(updated.id), updated);
      qc.invalidateQueries({ queryKey: SHARES_KEY });
    },
  });
}

export function useDeleteShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/shares/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: shareKey(id) });
      qc.invalidateQueries({ queryKey: SHARES_KEY });
    },
  });
}
