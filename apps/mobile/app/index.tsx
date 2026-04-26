import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function LandingScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.hero}>
        <Text style={[styles.title, { color: c.text }]}>Ceteris</Text>
        <Text style={[styles.tagline, { color: c.textMuted }]}>
          Scan a researcher&apos;s QR. See their work.
        </Text>
      </View>

      <View style={styles.actions}>
        <Link href="/scan" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: c.background }]}>
              Scan a QR code
            </Text>
          </Pressable>
        </Link>

        <Link href="/enter-code" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: c.text }]}>Enter a code</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: c.textMuted }]}>
          Sign in to create your own collection · coming soon
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: 18,
    marginTop: Spacing.md,
    lineHeight: 26,
  },
  actions: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  primaryButton: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  footer: {
    paddingBottom: Spacing.sm,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
  },
});
