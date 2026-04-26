import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { PublicShareResponse } from '@/types/share';

export function usePublicShare(code: string | undefined) {
  return useQuery({
    queryKey: ['publicShare', code],
    queryFn: () => api<PublicShareResponse>(`/public/c/${code}`),
    enabled: Boolean(code),
  });
}
