import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { WorkResponse } from '@/types/works';

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
