import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  clearSavedShares as clearSavedSharesStorage,
  getSavedShares,
  type SavedShare,
} from '@/lib/saved-shares';

export interface UseSavedSharesResult {
  items: SavedShare[] | null;
  clear: () => Promise<void>;
}

export function useSavedShares(): UseSavedSharesResult {
  const [items, setItems] = useState<SavedShare[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getSavedShares().then((list) => {
        if (!cancelled) setItems(list);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const clear = useCallback(async () => {
    await clearSavedSharesStorage();
    setItems([]);
  }, []);

  return { items, clear };
}
