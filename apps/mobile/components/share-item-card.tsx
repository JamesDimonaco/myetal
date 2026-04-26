import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ShareItem } from '@/types/share';

interface Props {
  item: ShareItem;
}

export function ShareItemCard({ item }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];

  const meta = [item.authors, item.year ? String(item.year) : null]
    .filter(Boolean)
    .join(' · ');

  const handleOpen = async () => {
    if (item.scholar_url) {
      await WebBrowser.openBrowserAsync(item.scholar_url, {
        toolbarColor: c.background,
        controlsColor: c.accent,
      });
    }
  };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${item.title}`}
      onPress={item.scholar_url ? handleOpen : undefined}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
      {meta ? (
        <Text style={[styles.meta, { color: c.textMuted }]}>{meta}</Text>
      ) : null}
      {item.notes ? (
        <Text style={[styles.notes, { color: c.textMuted }]}>{item.notes}</Text>
      ) : null}
      {item.scholar_url ? (
        <Text style={[styles.action, { color: c.accent }]}>Tap to open in Scholar →</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23,
  },
  meta: {
    fontSize: 14,
    marginTop: Spacing.xs,
  },
  notes: {
    fontSize: 14,
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  action: {
    fontSize: 13,
    marginTop: Spacing.sm,
    fontWeight: '500',
  },
});
