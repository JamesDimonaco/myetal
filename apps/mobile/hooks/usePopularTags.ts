import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Tag } from '@/types/share';

/**
 * Fetch the top-N tags by usage_count. Surfaced as the chip row at the top of
 * Discover (PR-B §4 / M1). Anonymous endpoint, edge-cacheable.
 */
export function usePopularTags(limit = 8) {
  return useQuery({
    queryKey: ['tags', 'popular', limit],
    queryFn: () =>
      api<Tag[]>(`/public/tags/popular?limit=${limit}`, { auth: null }),
    staleTime: 10 * 60_000,
  });
}
