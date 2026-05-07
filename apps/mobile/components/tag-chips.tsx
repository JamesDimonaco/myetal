/**
 * Tiny read-only tag chip row, shown on share cards + the share detail view.
 *
 * `max` truncates the visible chip count and renders a "+N more" pill at the
 * end. Pass `linkPattern='browse'` on detail/discover surfaces once the
 * /browse route is wired through (PR-B); until then chips render as plain
 * non-interactive Views so a tap doesn't dead-end on Discover.
 */

import { StyleSheet, Text, View } from 'react-native';

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
   * - `'browse'`: navigate to the tag-filtered browse view.
   *
   * TODO(PR-B): wire `'browse'` to push to the discover/browse route with
   * `?tags=<slug>` once the param plumbing lands. For now `'browse'` is
   * a no-op stub so callers can opt in early without dead-ending the tap.
   */
  linkPattern?: 'static' | 'browse';
}

export function TagChips({
  tags,
  max = 2,
  linkPattern = 'static',
}: TagChipsProps) {
  const c = Colors[useColorScheme() ?? 'light'];
  // Marked unused while PR-B is unshipped. Kept as a prop so callers can
  // opt in early; reading the value here keeps lint happy.
  void linkPattern;

  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;

  return (
    <View style={styles.row}>
      {visible.map((t) => (
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
      ))}
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
