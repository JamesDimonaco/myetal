import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { BrowseResponse } from '@/types/share';

export interface UseBrowseOptions {
  /** Tag slugs (OR semantics on the backend). */
  tags?: string[];
  /** Filter to a single owner's published shares (PR-B §5). */
  ownerId?: string | null;
  /** `recent` (default) or `popular`. */
  sort?: 'recent' | 'popular';
}

/**
 * Fetch the public browse feed. All params are optional — calling with no args
 * returns the same global trending+recent payload as before. Passing `tags`
 * filters by topical tags (OR); passing `ownerId` scopes the feed to a single
 * user's published shares and includes the `owner` header in the response.
 */
export function useBrowse(options: UseBrowseOptions = {}) {
  const { tags, ownerId, sort } = options;
  const tagKey = tags && tags.length > 0 ? [...tags].sort().join(',') : '';
  return useQuery({
    queryKey: ['browse', { tags: tagKey, ownerId: ownerId ?? null, sort: sort ?? null }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tags && tags.length > 0) {
        params.set('tags', tags.join(','));
      }
      if (ownerId) {
        params.set('owner_id', ownerId);
      }
      if (sort) {
        params.set('sort', sort);
      }
      const qs = params.toString();
      const path = qs ? `/public/browse?${qs}` : '/public/browse';
      return api<BrowseResponse>(path, { auth: null });
    },
    staleTime: 5 * 60_000,
  });
}
