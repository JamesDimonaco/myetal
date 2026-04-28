import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAuth } from '@/hooks/useAuth';

/**
 * Gate every screen inside `(authed)` on a live session. While the session
 * resolves we render a neutral splash so the layout doesn't flash to /sign-in
 * every cold launch. Once resolved, an unauthenticated user is bounced to the
 * sign-in modal; an authenticated user gets the bottom-tab shell.
 */
export default function AuthedLayout() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { isAuthed, isLoading, user } = useAuth();
  const analytics = useAnalytics();

  // Identify the user with PostHog when authenticated
  useEffect(() => {
    if (user) {
      analytics.identify(user.id, { email: user.email, name: user.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (!isAuthed) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.background,
          borderTopColor: c.border,
        },
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Shares',
          tabBarLabel: 'Shares',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" color={color} size={size} />
          ),
        }}
      />
      {/* Library hidden from tabs but route file kept for future use */}
      <Tabs.Screen name="library" options={{ href: null }} />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarLabel: 'Scan',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
      {/* Hidden routes — reachable by navigation but not in the tab bar.
          headerShown must NOT be false here — the screens set their own
          header via Stack.Screen options inside the component. */}
      <Tabs.Screen name="share/[id]" options={{ href: null }} />
      {/* share/add-paper moved to root /add-item as a modal */}
      <Tabs.Screen
        name="feedback"
        options={{ href: null, title: 'Feedback' }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
