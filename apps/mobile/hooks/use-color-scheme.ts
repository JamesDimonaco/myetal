import { useThemePreference } from './useThemePreference';

/**
 * Returns the resolved color scheme ('light' | 'dark') respecting the
 * user's persisted theme preference (light / dark / system).
 */
export function useColorScheme(): 'light' | 'dark' {
  const { resolvedScheme } = useThemePreference();
  return resolvedScheme;
}
