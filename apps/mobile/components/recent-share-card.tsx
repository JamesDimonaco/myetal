import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecentShare } from '@/lib/recent-shares';
import { formatRelativeTime } from '@/lib/time';

export function RecentShareCard({ entry }: { entry: RecentShare }) {
  const c = Colors[useColorScheme() ?? 'light'];

  const subtitle = [
    entry.owner_name,
    `${entry.item_count} ${entry.item_count === 1 ? 'paper' : 'papers'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/c/${entry.short_code}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${entry.name}`}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.code, { color: c.textMuted }]}>{entry.short_code}</Text>
          <Text style={[styles.code, { color: c.textMuted }]}>
            {formatRelativeTime(entry.viewed_at)}
          </Text>
        </View>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {entry.name}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  code: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    marginTop: Spacing.xs,
  },
});
