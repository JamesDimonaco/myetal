import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';

export default function ProfileScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

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

  signOut: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  signOutText: { fontSize: 16, fontWeight: '600' },
});
