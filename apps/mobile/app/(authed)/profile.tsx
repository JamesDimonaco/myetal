// TODO: Web parity gaps:
//   - Web profile page shows "Active sessions" list with per-session revoke
//     (GET /auth/me/sessions, POST /auth/me/sessions/:id/revoke)

import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { useAuth } from '@/hooks/useAuth';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function ProfileScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user, signOut } = useAuth();
  const { reset: resetAnalytics } = useAnalytics();
  const { reset: resetConsent } = useAnalyticsConsent();
  const { preference, setPreference } = useThemePreference();
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

      {/* Preferences */}
      <View style={styles.prefsSection}>
        <Text style={[styles.prefsLabel, { color: c.textMuted }]}>PREFERENCES</Text>
        <View style={[styles.prefsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.prefsTitle, { color: c.text }]}>Appearance</Text>
          <View style={styles.themePillRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = preference === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setPreference(opt.value)}
                  style={({ pressed }) => [
                    styles.themePill,
                    {
                      borderColor: active ? c.text : c.border,
                      backgroundColor: active ? c.text : c.surface,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? c.background : c.text,
                      fontSize: 13,
                      fontWeight: '500',
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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

  prefsSection: { marginBottom: Spacing.md },
  prefsLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.sm },
  prefsCard: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  prefsTitle: { fontSize: 15, fontWeight: '600', marginBottom: Spacing.sm },
  themePillRow: { flexDirection: 'row', gap: Spacing.xs },
  themePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },

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
