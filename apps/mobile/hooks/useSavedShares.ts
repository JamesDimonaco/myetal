import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getSavedShares, type SavedShare } from '@/lib/saved-shares';

export function useSavedShares(): SavedShare[] | null {
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

  return items;
}
