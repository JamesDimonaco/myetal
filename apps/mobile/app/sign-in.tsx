import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Sign-in placeholder. The real auth flow (ORCID + Google + GitHub +
 * email/password) lands in a follow-up commit. For now this exists so the
 * landing footer has somewhere to navigate to and we can preview the layout.
 */
export default function SignInScreen() {
  const c = Colors[useColorScheme() ?? 'light'];

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.body}>
        <Text style={[styles.heading, { color: c.text }]}>Create your collection</Text>
        <Text style={[styles.subhead, { color: c.textMuted }]}>
          Sign in to publish your own papers and generate QR codes for posters,
          slides, and CV pages.
        </Text>

        <View style={styles.providerStack}>
          {(['ORCID', 'Google', 'GitHub'] as const).map((provider) => (
            <Pressable
              key={provider}
              disabled
              style={[
                styles.providerButton,
                { borderColor: c.border, backgroundColor: c.surface, opacity: 0.6 },
              ]}
            >
              <Text style={[styles.providerText, { color: c.text }]}>
                Continue with {provider}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.disclosure, { color: c.textMuted }]}>
          Sign-in arrives shortly. ORCID is the primary path for verified
          researcher identity; Google and GitHub are alternates. Email/password
          will live behind a small disclosure as a fallback.
        </Text>
      </View>

      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.dismiss,
          { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.dismissText, { color: c.text }]}>Back</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  body: { flex: 1, paddingTop: Spacing.lg },
  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  subhead: { fontSize: 16, marginTop: Spacing.sm, lineHeight: 23 },
  providerStack: { gap: Spacing.sm, marginTop: Spacing.xl },
  providerButton: {
    paddingVertical: 16,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  providerText: { fontSize: 16, fontWeight: '500' },
  disclosure: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.xl,
  },
  dismiss: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
  },
  dismissText: { fontSize: 17, fontWeight: '600' },
});
