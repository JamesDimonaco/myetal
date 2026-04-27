import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getViewToken } from '@/lib/view-token';
import type { PublicShareResponse } from '@/types/share';

export function usePublicShare(code: string | undefined) {
  return useQuery({
    queryKey: ['publicShare', code],
    queryFn: async () => {
      const viewToken = await getViewToken();
      return api<PublicShareResponse>(`/public/c/${code}`, {
        auth: null,
        headers: { 'X-View-Token': viewToken },
      });
    },
    enabled: Boolean(code),
  });
}
