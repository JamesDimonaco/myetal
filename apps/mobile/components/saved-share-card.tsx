import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { usePressScale } from '@/hooks/usePressScale';
import type { SavedShare } from '@/lib/saved-shares';
import { formatRelativeTime } from '@/lib/time';

export function SavedShareCard({ entry }: { entry: SavedShare }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.985);

  const itemLabel = `${entry.item_count} ${entry.item_count === 1 ? 'paper' : 'papers'}`;

  return (
    <Link href={`/c/${entry.short_code}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${entry.name}`}
        onPress={() => haptics.tap()}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      >
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
            },
            Shadows.sm,
            press.style,
          ]}
        >
          <View
            style={[
              styles.iconTile,
              { backgroundColor: c.accentSoft },
            ]}
          >
            <Ionicons name="bookmark" size={20} color={c.accent} />
          </View>

          <View style={styles.body}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {entry.name}
            </Text>
            <View style={styles.metaRow}>
              {entry.owner_name ? (
                <>
                  <Text
                    style={[styles.meta, { color: c.textMuted }]}
                    numberOfLines={1}
                  >
                    {entry.owner_name}
                  </Text>
                  <Text style={[styles.dot, { color: c.textSubtle }]}>·</Text>
                </>
              ) : null}
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {itemLabel}
              </Text>
              <Text style={[styles.dot, { color: c.textSubtle }]}>·</Text>
              <Text style={[styles.typeBadge, { color: c.textMuted }]}>
                {entry.type.toUpperCase()}
              </Text>
            </View>
            <View style={styles.footerRow}>
              <Text style={[styles.code, { color: c.textSubtle }]}>
                {entry.short_code}
              </Text>
              <Text style={[styles.dot, { color: c.textSubtle }]}>·</Text>
              <Text style={[styles.code, { color: c.textSubtle }]}>
                {formatRelativeTime(entry.saved_at)}
              </Text>
            </View>
          </View>

          <Ionicons
            name="chevron-forward"
            size={18}
            color={c.textSubtle}
            style={styles.chevron}
          />
        </Animated.View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm + 2,
    gap: Spacing.md,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 2,
  },
  meta: {
    fontSize: 13,
    flexShrink: 1,
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 4,
  },
  code: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  dot: {
    fontSize: 13,
  },
  chevron: {
    opacity: 0.7,
  },
});
