import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const CONSENT_KEY = 'myetal_analytics_consent';

export type ConsentValue = 'accepted' | 'declined' | null;

/**
 * Manages the user's analytics consent state via AsyncStorage.
 * Returns `null` while loading (or if not yet decided).
 */
export function useAnalyticsConsent() {
  const [consent, setConsent] = useState<ConsentValue>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY)
      .then((val) => {
        if (val === 'accepted' || val === 'declined') {
          setConsent(val);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const accept = useCallback(async () => {
    await AsyncStorage.setItem(CONSENT_KEY, 'accepted');
    setConsent('accepted');
  }, []);

  const decline = useCallback(async () => {
    await AsyncStorage.setItem(CONSENT_KEY, 'declined');
    setConsent('declined');
  }, []);

  const reset = useCallback(async () => {
    await AsyncStorage.removeItem(CONSENT_KEY);
    setConsent(null);
  }, []);

  return { consent, accept, decline, reset, isLoading } as const;
}
