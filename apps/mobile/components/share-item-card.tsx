import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { usePressScale } from '@/hooks/usePressScale';
import { formatFileSize } from '@/lib/pdf-upload';
import type { ShareItem, ShareItemKind } from '@/types/share';

interface Props {
  item: ShareItem;
}

export function ShareItemCard({ item }: Props) {
  // Server defaults kind to 'paper' but legacy payloads (or stale caches) may
  // be missing it entirely — treat undefined as 'paper'.
  const kind: ShareItemKind = item.kind ?? 'paper';

  if (kind === 'repo') {
    return <RepoCard item={item} />;
  }
  if (kind === 'link') {
    return <LinkCard item={item} />;
  }
  if (kind === 'pdf') {
    return <PdfCard item={item} />;
  }
  return <PaperCard item={item} />;
}

// ---------- paper (unchanged behaviour) ----------

function PaperCard({ item }: Props) {
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

  const pdfUrl = item.doi ? `https://doi.org/${item.doi}` : null;
  const handleOpenPdf = async () => {
    if (!pdfUrl) return;
    haptics.tap();
    await WebBrowser.openBrowserAsync(pdfUrl, {
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
          { backgroundColor: c.surface, borderColor: c.border },
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
            {item.doi ? (
              <Text style={[styles.doi, { color: c.textSubtle }]}>DOI {item.doi}</Text>
            ) : null}
            {item.notes ? (
              <Text style={[styles.notes, { color: c.text }]}>{item.notes}</Text>
            ) : null}
          </View>
        </View>

        {interactive || pdfUrl ? (
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            {interactive ? (
              <Pressable
                onPress={handleOpen}
                hitSlop={8}
                style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="open-outline" size={14} color={c.accent} />
                <Text style={[styles.action, { color: c.accent }]}>Scholar</Text>
              </Pressable>
            ) : null}
            {pdfUrl ? (
              <Pressable
                onPress={handleOpenPdf}
                hitSlop={8}
                style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="document-text-outline" size={14} color={c.accent} />
                <Text style={[styles.action, { color: c.accent }]}>PDF</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ---------- repo ----------

function RepoCard({ item }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.985);

  const handleOpen = async () => {
    if (!item.url) return;
    haptics.tap();
    await WebBrowser.openBrowserAsync(item.url, {
      toolbarColor: c.background,
      controlsColor: c.accent,
    });
  };

  const interactive = Boolean(item.url);

  return (
    <Pressable
      accessibilityRole={interactive ? 'link' : 'text'}
      accessibilityLabel={interactive ? `Open ${item.title} on GitHub` : item.title}
      onPress={interactive ? handleOpen : undefined}
      onPressIn={interactive ? press.onPressIn : undefined}
      onPressOut={interactive ? press.onPressOut : undefined}
    >
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: c.surface, borderColor: c.border },
          Shadows.sm,
          interactive ? press.style : null,
        ]}
      >
        <View style={styles.row}>
          <View style={[styles.kindIconWrap, { backgroundColor: c.surfaceSunken }]}>
            <Ionicons name="logo-github" size={20} color={c.text} />
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {item.subtitle}
              </Text>
            ) : null}
            {item.notes ? (
              <Text style={[styles.notes, { color: c.text }]}>{item.notes}</Text>
            ) : null}
          </View>
        </View>

        {interactive ? (
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            <Ionicons name="logo-github" size={14} color={c.accent} />
            <Text style={[styles.action, { color: c.accent }]}>Open on GitHub</Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ---------- link ----------

function LinkCard({ item }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.985);

  const handleOpen = async () => {
    if (!item.url) return;
    haptics.tap();
    await WebBrowser.openBrowserAsync(item.url, {
      toolbarColor: c.background,
      controlsColor: c.accent,
    });
  };

  const interactive = Boolean(item.url);

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
          { backgroundColor: c.surface, borderColor: c.border },
          Shadows.sm,
          interactive ? press.style : null,
        ]}
      >
        {item.image_url ? (
          <Image
            source={{ uri: item.image_url }}
            style={[styles.thumbnail, { backgroundColor: c.surfaceSunken }]}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        <View style={styles.row}>
          {!item.image_url ? (
            <View style={[styles.kindIconWrap, { backgroundColor: c.surfaceSunken }]}>
              <Ionicons name="link" size={18} color={c.text} />
            </View>
          ) : null}
          <View style={styles.body}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {item.subtitle}
              </Text>
            ) : null}
            {item.notes ? (
              <Text style={[styles.notes, { color: c.text }]}>{item.notes}</Text>
            ) : null}
          </View>
        </View>

        {interactive ? (
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            <Ionicons name="open-outline" size={14} color={c.accent} />
            <Text style={[styles.action, { color: c.accent }]}>Open link</Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ---------- pdf (PR-C) ----------

function PdfCard({ item }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.985);

  const handleOpen = async () => {
    if (!item.file_url) return;
    haptics.tap();
    // Linking.openURL hands off to the OS PDF viewer (Quick Look on iOS,
    // system handler / Chrome on Android). We deliberately avoid
    // WebBrowser's in-app browser here — for PDFs the OS viewer renders
    // them better than an in-app webview, and the download story is
    // cleaner (Files app on iOS, Downloads on Android).
    try {
      await Linking.openURL(item.file_url);
    } catch {
      // openURL throws on some Android devices when no PDF handler is
      // registered. Fall back to WebBrowser so users at least see the
      // file rather than a silent no-op.
      await WebBrowser.openBrowserAsync(item.file_url, {
        toolbarColor: c.background,
        controlsColor: c.accent,
      });
    }
  };

  const interactive = Boolean(item.file_url);
  const sizeLabel =
    item.file_size_bytes != null && item.file_size_bytes > 0
      ? formatFileSize(item.file_size_bytes)
      : null;

  return (
    <Pressable
      accessibilityRole={interactive ? 'link' : 'text'}
      accessibilityLabel={interactive ? `Open PDF ${item.title}` : item.title}
      onPress={interactive ? handleOpen : undefined}
      onPressIn={interactive ? press.onPressIn : undefined}
      onPressOut={interactive ? press.onPressOut : undefined}
    >
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: c.surface, borderColor: c.border },
          Shadows.sm,
          interactive ? press.style : null,
        ]}
      >
        {item.thumbnail_url ? (
          <Image
            source={{ uri: item.thumbnail_url }}
            style={[styles.pdfThumbnail, { backgroundColor: c.surfaceSunken }]}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        <View style={styles.row}>
          {!item.thumbnail_url ? (
            <View style={[styles.kindIconWrap, { backgroundColor: c.surfaceSunken }]}>
              <Ionicons name="document-text" size={18} color={c.text} />
            </View>
          ) : null}
          <View style={styles.body}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.subtitle, { color: c.textMuted }]}>
              {sizeLabel ? `PDF · ${sizeLabel}` : 'PDF'}
            </Text>
            {item.notes ? (
              <Text style={[styles.notes, { color: c.text }]}>{item.notes}</Text>
            ) : null}
          </View>
        </View>

        {interactive ? (
          <View style={[styles.actionRow, { borderTopColor: c.border }]}>
            <Ionicons name="document-text-outline" size={14} color={c.accent} />
            <Text style={[styles.action, { color: c.accent }]}>Open PDF</Text>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm + 2,
    padding: Spacing.md,
  },
  kindIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  pdfThumbnail: {
    // PDF first-page is portrait (typically A4 / Letter ≈ 1:√2). Cap height
    // so the card stays a card and not a full-page render — the user taps
    // through to the OS viewer for full reading.
    width: '100%',
    height: 220,
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
  doi: {
    fontSize: 11,
    marginTop: Spacing.xs,
    fontVariant: ['tabular-nums'] as const,
  },
  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.xs + 2,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  subtitle: {
    fontSize: 14,
    marginTop: Spacing.xs + 2,
    lineHeight: 20,
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
