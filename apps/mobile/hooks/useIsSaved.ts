import { useCallback, useEffect, useState } from 'react';

import { useHaptics } from '@/hooks/useHaptics';
import { isShareSaved, saveShare, unsaveShare, type SavedShare } from '@/lib/saved-shares';

export function useIsSaved(
  shortCode: string,
  entry: Omit<SavedShare, 'saved_at'> | null,
) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const haptics = useHaptics();

  useEffect(() => {
    let cancelled = false;
    isShareSaved(shortCode).then((v) => {
      if (!cancelled) { setSaved(v); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [shortCode]);

  const toggle = useCallback(async () => {
    if (!entry) return;
    if (saved) {
      await unsaveShare(shortCode);
      setSaved(false);
      haptics.tap();
    } else {
      await saveShare(entry);
      setSaved(true);
      haptics.success();
    }
  }, [saved, shortCode, entry, haptics]);

  return { isSaved: saved, toggle, isLoading: loading };
}
