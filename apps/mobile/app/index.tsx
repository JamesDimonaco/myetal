import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecentShareCard } from '@/components/recent-share-card';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRecentShares } from '@/hooks/useRecentShares';

export default function LandingScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const recents = useRecentShares();
  const hasRecents = (recents?.length ?? 0) > 0;

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={[styles.title, { color: c.text }]}>Ceteris</Text>
          <Text style={[styles.tagline, { color: c.textMuted }]}>
            Scan a researcher&apos;s QR. See their work.
          </Text>
        </View>

        {/* Primary actions */}
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
              <Text style={[styles.secondaryButtonText, { color: c.text }]}>
                Enter a code
              </Text>
            </Pressable>
          </Link>
        </View>

        {/* Recently viewed */}
        {hasRecents ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>RECENTLY VIEWED</Text>
            {recents!.map((entry) => (
              <RecentShareCard key={entry.short_code} entry={entry} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Footer */}
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
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
  },
  hero: {
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
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
  section: {
    marginTop: Spacing.xl,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: Spacing.md,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
  },
});
