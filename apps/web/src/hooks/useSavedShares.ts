'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getSavedShares,
  saveShare as saveShareToStorage,
  unsaveShare as unsaveShareFromStorage,
  isShareSaved,
  type SavedShare,
} from '@/lib/saved-shares';

export function useSavedShares() {
  const [saved, setSaved] = useState<SavedShare[]>([]);

  useEffect(() => {
    setSaved(getSavedShares());
  }, []);

  const save = useCallback((entry: Omit<SavedShare, 'saved_at'>) => {
    saveShareToStorage(entry);
    setSaved(getSavedShares());
  }, []);

  const unsave = useCallback((shortCode: string) => {
    unsaveShareFromStorage(shortCode);
    setSaved(getSavedShares());
  }, []);

  const checkSaved = useCallback((shortCode: string) => {
    return isShareSaved(shortCode);
  }, []);

  return { saved, isSaved: checkSaved, save, unsave };
}
