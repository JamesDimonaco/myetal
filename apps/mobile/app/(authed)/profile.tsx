import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { useAuth } from '@/hooks/useAuth';

export default function ProfileScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user, signOut } = useAuth();
  const { reset: resetAnalytics } = useAnalytics();
  const { reset: resetConsent } = useAnalyticsConsent();
  const [signingOut, setSigningOut] = useState(false);

  const handleResetConsent = () => {
    resetAnalytics();
    resetConsent();
    Alert.alert(
      'Analytics consent reset',
      'The app will ask again on next launch.',
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to manage your shares.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.body}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.textMuted }]}>NAME</Text>
          <Text style={[styles.value, { color: c.text }]}>{user?.name ?? '—'}</Text>

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          <Text style={[styles.label, { color: c.textMuted }]}>EMAIL</Text>
          <Text style={[styles.value, { color: c.text }]}>{user?.email ?? '—'}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/feedback')}
        style={({ pressed }) => [
          styles.feedbackRow,
          { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.feedbackText, { color: c.text }]}>Send feedback</Text>
        <Text style={{ color: c.textMuted, fontSize: 18 }}>{'\u203A'}</Text>
      </Pressable>

      <Pressable
        onPress={handleResetConsent}
        style={({ pressed }) => [
          styles.feedbackRow,
          { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.feedbackText, { color: c.text }]}>Reset analytics consent</Text>
        <Text style={{ color: c.textMuted, fontSize: 18 }}>{'\u203A'}</Text>
      </Pressable>

      <Pressable
        onPress={handleSignOut}
        disabled={signingOut}
        style={({ pressed }) => [
          styles.signOut,
          { borderColor: c.text, opacity: signingOut ? 0.6 : pressed ? 0.7 : 1 },
        ]}
      >
        {signingOut ? (
          <ActivityIndicator color={c.text} />
        ) : (
          <Text style={[styles.signOutText, { color: c.text }]}>Sign out</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  body: { flex: 1, paddingTop: Spacing.lg },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.xs },
  value: { fontSize: 17, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.md },

  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
  },
  feedbackText: { fontSize: 16, fontWeight: '500' },

  signOut: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  signOutText: { fontSize: 16, fontWeight: '600' },
});
