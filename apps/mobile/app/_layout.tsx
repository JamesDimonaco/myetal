import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider } from 'posthog-react-native';
import 'react-native-reanimated';

import { AnalyticsConsent } from '@/components/analytics-consent';
import { ErrorBoundary } from '@/components/error-boundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { queryClient } from '@/lib/queryClient';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { consent, accept, decline, isLoading } = useAnalyticsConsent();

  const content = (
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
          {/* Authed group owns its own bottom-tab navigator + nested stack */}
          <Stack.Screen name="(authed)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />

        {/* Show consent modal on first launch when not yet decided */}
        {consent === null && !isLoading && (
          <AnalyticsConsent onAccept={accept} onDecline={decline} />
        )}
      </ThemeProvider>
    </ErrorBoundary>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {consent === 'accepted' ? (
        <PostHogProvider
          apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY!}
          options={{
            host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
          }}
        >
          {content}
        </PostHogProvider>
      ) : (
        content
      )}
    </QueryClientProvider>
  );
}
