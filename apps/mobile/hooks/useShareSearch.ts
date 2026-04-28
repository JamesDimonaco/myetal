import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ShareSearchResponse } from '@/types/share';

export function useShareSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['shareSearch', trimmed.toLowerCase()],
    queryFn: () =>
      api<ShareSearchResponse>(
        `/public/search?q=${encodeURIComponent(trimmed)}&limit=20`,
        { auth: null },
      ),
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
  });
}
