import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ComponentType, type ReactNode } from 'react';
import 'react-native-reanimated';
import { PostHogProvider } from 'posthog-react-native';

import { AnalyticsConsent } from '@/components/analytics-consent';
import { ErrorBoundary } from '@/components/error-boundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { useSplashGate } from '@/hooks/useSplashGate';
import {
  ThemePreferenceContext,
  useThemePreferenceProvider,
} from '@/hooks/useThemePreference';
import { queryClient } from '@/lib/queryClient';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? '';

// Statically typed reference so we can fall back to a passthrough if the
// module ever fails to load. Avoids `require()` inside a render body, which
// re-evaluates the module on every render and can cross React copies.
const PostHogProviderSafe = (PostHogProvider ?? null) as
  | ComponentType<{ apiKey: string; options?: { host?: string }; children?: ReactNode }>
  | null;

/**
 * Conditionally wraps children in PostHogProvider. If the key is empty or
 * the provider is unavailable, children render unwrapped — the app never
 * crashes because of analytics.
 */
function MaybePostHog({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled || !POSTHOG_KEY || !PostHogProviderSafe) return <>{children}</>;

  return (
    <PostHogProviderSafe apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
      {children}
    </PostHogProviderSafe>
  );
}

export default function RootLayout() {
  const themeCtx = useThemePreferenceProvider();
  const { consent, accept, decline, isLoading } = useAnalyticsConsent();
  useSplashGate();

  return (
    <ThemePreferenceContext.Provider value={themeCtx}>
      <RootLayoutInner consent={consent} accept={accept} decline={decline} consentLoading={isLoading} />
    </ThemePreferenceContext.Provider>
  );
}

function RootLayoutInner({
  consent,
  accept,
  decline,
  consentLoading,
}: {
  consent: ReturnType<typeof useAnalyticsConsent>['consent'];
  accept: ReturnType<typeof useAnalyticsConsent>['accept'];
  decline: ReturnType<typeof useAnalyticsConsent>['decline'];
  consentLoading: boolean;
}) {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <MaybePostHog enabled={consent === 'accepted'}>
        <ErrorBoundary>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: 'transparent' },
                headerTitle: '',
                headerBackTitle: 'Back',
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="scan" options={{ title: 'Scan' }} />
              <Stack.Screen name="enter-code" options={{ title: 'Enter code' }} />
              <Stack.Screen name="search" options={{ title: 'Search' }} />
              <Stack.Screen name="c/[code]" options={{ headerBackTitle: 'Home' }} />
              <Stack.Screen
                name="sign-in"
                options={{ presentation: 'modal', title: 'Sign in' }}
              />
              <Stack.Screen name="(authed)" options={{ headerShown: false }} />
              <Stack.Screen
                name="add-item"
                options={{ presentation: 'modal', headerShown: false }}
              />
            </Stack>
            <StatusBar style="auto" />

            {consent === null && !consentLoading && (
              <AnalyticsConsent onAccept={accept} onDecline={decline} />
            )}
          </ThemeProvider>
        </ErrorBoundary>
      </MaybePostHog>
    </QueryClientProvider>
  );
}
