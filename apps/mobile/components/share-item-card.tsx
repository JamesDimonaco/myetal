import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { usePressScale } from '@/hooks/usePressScale';
import type { ShareItem } from '@/types/share';

interface Props {
  item: ShareItem;
}

export function ShareItemCard({ item }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.985);

  const meta = [item.authors, item.year ? String(item.year) : null]
    .filter(Boolean)
    .join(' · ');

  const handleOpen = async () => {
    if (!item.scholar_url) return;
    haptics.tap();
    await WebBrowser.openBrowserAsync(item.scholar_url, {
      toolbarColor: c.background,
      controlsColor: c.accent,
    });
  };

  const interactive = Boolean(item.scholar_url);

  return (
    <Pressable
      accessibilityRole={interactive ? 'link' : 'text'}
      accessibilityLabel={interactive ? `Open ${item.title}` : item.title}
      onPress={interactive ? handleOpen : undefined}
      onPressIn={interactive ? press.onPressIn : undefined}
      onPressOut={interactive ? press.onPressOut : undefined}
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
          },
          Shadows.sm,
          interactive ? press.style : null,
        ]}
      >
        <View style={styles.row}>
          <View style={styles.body}>
            <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
            {meta ? (
              <Text style={[styles.meta, { color: c.textMuted }]}>{meta}</Text>
            ) : null}
            {item.notes ? (
              <Text style={[styles.notes, { color: c.text }]}>{item.notes}</Text>
            ) : null}
          </View>
        </View>

        {interactive ? (
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            <Ionicons
              name="open-outline"
              size={14}
              color={c.accent}
            />
            <Text style={[styles.action, { color: c.accent }]}>
              Open in Google Scholar
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm + 2,
    overflow: 'hidden',
  },
  row: {
    padding: Spacing.md,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23,
    letterSpacing: -0.1,
  },
  meta: {
    fontSize: 13,
    marginTop: Spacing.xs + 2,
    fontWeight: '500',
  },
  notes: {
    fontSize: 14,
    marginTop: Spacing.sm,
    lineHeight: 21,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
