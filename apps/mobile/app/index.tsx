import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  LinearTransition,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { RecentShareCard } from '@/components/recent-share-card';
import { Wordmark } from '@/components/wordmark';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { useRecentShares } from '@/hooks/useRecentShares';
import { useSplashGate } from '@/hooks/useSplashGate';

export default function LandingScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const haptics = useHaptics();
  const recents = useRecentShares();
  const hasRecents = (recents?.length ?? 0) > 0;
  useSplashGate();

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
        <Animated.View
          entering={FadeInDown.duration(420).springify().damping(18)}
          style={styles.hero}
        >
          <Wordmark size="lg" showTagline />
          <Text style={[styles.tagline, { color: c.textMuted }]}>
            Scan a researcher&apos;s QR. See their work.
          </Text>
        </Animated.View>

        {/* Primary actions */}
        <Animated.View
          entering={FadeInUp.duration(400).delay(120).springify().damping(20)}
          style={styles.actions}
        >
          <Button
            label="Scan a QR code"
            icon="scan-outline"
            variant="primary"
            onPress={() => router.push('/scan')}
          />
          <Button
            label="Enter a code"
            icon="keypad-outline"
            variant="secondary"
            onPress={() => router.push('/enter-code')}
          />
        </Animated.View>

        {/* Recently viewed — or polished empty state */}
        {recents === null ? null : hasRecents ? (
          <Animated.View
            entering={FadeInUp.duration(380).delay(220)}
            style={styles.section}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, { color: c.textSubtle }]}>
                RECENTLY VIEWED
              </Text>
              <Text style={[styles.sectionCount, { color: c.textSubtle }]}>
                {recents!.length}
              </Text>
            </View>
            <Animated.View layout={LinearTransition.springify().damping(20)}>
              {recents!.map((entry, i) => (
                <Animated.View
                  key={entry.short_code}
                  entering={FadeInUp.duration(340).delay(260 + i * 50)}
                >
                  <RecentShareCard entry={entry} />
                </Animated.View>
              ))}
            </Animated.View>
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeInUp.duration(380).delay(220)}
            style={[styles.emptyState, { borderColor: c.border, backgroundColor: c.surface }]}
          >
            <View
              style={[
                styles.emptyIconWrap,
                { backgroundColor: c.accentSoft },
              ]}
            >
              <Ionicons name="albums-outline" size={22} color={c.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.text }]}>
              No collections yet
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              Scan a QR or paste a code to open a researcher&apos;s collection. The
              ones you visit will live here for next time.
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* Footer */}
      <Animated.View entering={FadeInUp.duration(400).delay(380)}>
        <Link href="/sign-in" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.footer,
              { opacity: pressed ? 0.5 : 1 },
            ]}
            accessibilityRole="link"
            accessibilityLabel="Sign in to create your own collection"
            onPress={() => haptics.tap()}
          >
            <Text style={[styles.footerText, { color: c.textMuted }]}>
              Sign in to create your own collection
            </Text>
            <Ionicons
              name="arrow-forward"
              size={14}
              color={c.textMuted}
              style={styles.footerArrow}
            />
          </Pressable>
        </Link>
      </Animated.View>
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
  tagline: {
    fontSize: 17,
    marginTop: Spacing.lg,
    lineHeight: 25,
    maxWidth: 320,
  },
  actions: {
    gap: Spacing.sm + 2,
  },
  section: {
    marginTop: Spacing.xl + Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
  },
  emptyState: {
    marginTop: Spacing.xl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: Spacing.xs + 2,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.xs + 2,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
  },
  footerArrow: {
    marginTop: 1,
  },
});
