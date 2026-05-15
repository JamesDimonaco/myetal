import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  clearRecentShares as clearRecentSharesStorage,
  getRecentShares,
  type RecentShare,
} from '@/lib/recent-shares';

export interface UseRecentSharesResult {
  items: RecentShare[] | null;
  clear: () => Promise<void>;
}

/**
 * Re-reads the recent-shares list every time the screen gains focus, so
 * navigating back from a viewer reflects the new entry without a hard
 * refresh. `items` is `null` on the first render so the UI can distinguish
 * "still loading" from "empty list". `clear` wipes AsyncStorage and the
 * in-memory list synchronously (no need to wait for next focus).
 */
export function useRecentShares(): UseRecentSharesResult {
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

  const clear = useCallback(async () => {
    await clearRecentSharesStorage();
    setItems([]);
  }, []);

  return { items, clear };
}
