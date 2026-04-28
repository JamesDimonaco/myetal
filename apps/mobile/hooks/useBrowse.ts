import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { BrowseResponse } from '@/types/share';

export function useBrowse() {
  return useQuery({
    queryKey: ['browse'],
    queryFn: () => api<BrowseResponse>('/public/browse', { auth: null }),
    staleTime: 5 * 60_000,
  });
}
