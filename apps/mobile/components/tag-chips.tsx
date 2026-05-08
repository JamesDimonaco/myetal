/**
 * Tiny read-only tag chip row, shown on share cards + the share detail view.
 *
 * `max` truncates the visible chip count and renders a "+N more" pill at the
 * end. Pass `linkPattern='browse'` on detail/discover surfaces (PR-B onward)
 * to make each chip tappable — taps push to Discover with the tag preselected.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Tag } from '@/types/share';

interface TagChipsProps {
  tags: Tag[] | undefined | null;
  /** Hard cap on visible chips. Excess collapses into "+N". Defaults to 2. */
  max?: number;
  /**
   * Tap behaviour for each chip.
   * - `'static'` (default): non-interactive — wrapped in a plain `<View>`.
   * - `'browse'`: tap pushes to `/(authed)/discover?tag=<slug>` — Discover
   *   reads the param into screen-local filter state on mount.
   */
  linkPattern?: 'static' | 'browse';
}

export function TagChips({
  tags,
  max = 2,
  linkPattern = 'static',
}: TagChipsProps) {
  const c = Colors[useColorScheme() ?? 'light'];

  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;

  const handlePress = (tag: Tag) => {
    router.push({
      pathname: '/(authed)/discover',
      params: { tag: tag.slug },
    });
  };

  return (
    <View style={styles.row}>
      {visible.map((t) =>
        linkPattern === 'browse' ? (
          <Pressable
            key={t.id}
            accessibilityRole="link"
            accessibilityLabel={`Browse shares tagged ${t.label}`}
            onPress={(e) => {
              // Stop the parent card's onPress from firing on chip taps.
              e.stopPropagation();
              handlePress(t);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: c.accentSoft,
                borderColor: c.accent,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: c.accentText }]}>
              {t.label}
            </Text>
          </Pressable>
        ) : (
          <View key={t.id}>
            <View
              style={[
                styles.chip,
                { backgroundColor: c.accentSoft, borderColor: c.accent },
              ]}
            >
              <Text style={[styles.chipText, { color: c.accentText }]}>
                {t.label}
              </Text>
            </View>
          </View>
        ),
      )}
      {overflow > 0 ? (
        <View
          style={[
            styles.chip,
            { backgroundColor: c.surfaceSunken, borderColor: c.border },
          ]}
        >
          <Text style={[styles.chipText, { color: c.textMuted }]}>
            +{overflow}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
