import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const STORAGE_KEY = 'myetal_theme_preference';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemePreferenceContextValue {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
  resolvedScheme: 'light' | 'dark';
}

export const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  preference: 'system',
  setPreference: async () => {},
  resolvedScheme: 'light',
});

/**
 * Call once in the root layout to initialise state; every consumer reads
 * from the context instead so preference changes propagate immediately.
 */
export function useThemePreferenceProvider() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const deviceScheme = useRNColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setPreferenceState(val);
      }
    });
  }, []);

  const setPreference = useCallback(async (next: ThemePreference) => {
    await AsyncStorage.setItem(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  const resolvedScheme: 'light' | 'dark' =
    preference === 'system' ? (deviceScheme ?? 'light') : preference;

  return { preference, setPreference, resolvedScheme } as const;
}

/**
 * Read the user's theme preference from any component below the provider.
 */
export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}
