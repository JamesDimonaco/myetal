import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode } from 'react';
import 'react-native-reanimated';

import { AnalyticsConsent } from '@/components/analytics-consent';
import { ErrorBoundary } from '@/components/error-boundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { useSplashGate } from '@/hooks/useSplashGate';
import { queryClient } from '@/lib/queryClient';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? '';

/**
 * Conditionally wraps children in PostHogProvider. If the key is empty or
 * the import fails, children render unwrapped — the app never crashes
 * because of analytics.
 */
function MaybePostHog({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled || !POSTHOG_KEY) return <>{children}</>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostHogProvider } = require('posthog-react-native');
    return (
      <PostHogProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
        {children}
      </PostHogProvider>
    );
  } catch {
    // posthog-react-native failed to load — run without analytics
    return <>{children}</>;
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { consent, accept, decline, isLoading } = useAnalyticsConsent();
  useSplashGate();

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

            {consent === null && !isLoading && (
              <AnalyticsConsent onAccept={accept} onDecline={decline} />
            )}
          </ThemeProvider>
        </ErrorBoundary>
      </MaybePostHog>
    </QueryClientProvider>
  );
}
