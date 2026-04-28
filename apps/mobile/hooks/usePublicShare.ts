import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getViewToken } from '@/lib/view-token';
import type { PublicShareResponse } from '@/types/share';

export function usePublicShare(code: string | undefined) {
  return useQuery({
    queryKey: ['publicShare', code],
    queryFn: async () => {
      // View token is best-effort — don't let it block the share from loading
      const headers: Record<string, string> = {};
      try {
        const viewToken = await getViewToken();
        headers['X-View-Token'] = viewToken;
      } catch {
        // SecureStore or crypto unavailable — skip dedup token
      }
      return api<PublicShareResponse>(`/public/c/${code}`, {
        auth: null,
        headers,
      });
    },
    enabled: Boolean(code),
  });
}
