import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getRecentShares, type RecentShare } from '@/lib/recent-shares';

/**
 * Re-reads the recent-shares list every time the screen gains focus, so
 * navigating back from a viewer reflects the new entry without a hard
 * refresh. Returns `null` for the very first render so the UI can
 * distinguish "still loading" from "empty list".
 */
export function useRecentShares(): RecentShare[] | null {
  const [items, setItems] = useState<RecentShare[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getRecentShares().then((list) => {
        if (!cancelled) setItems(list);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return items;
}
