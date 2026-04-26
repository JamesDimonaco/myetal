import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';

import { QrModal } from '@/components/qr-modal';
import { ShareItemCard } from '@/components/share-item-card';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePublicShare } from '@/hooks/usePublicShare';
import { ApiError } from '@/lib/api';
import { trackRecentShare } from '@/lib/recent-shares';
import { formatRelativeTime } from '@/lib/time';

export default function PublicShareScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = params.code;
  const c = Colors[useColorScheme() ?? 'light'];

  const [qrVisible, setQrVisible] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } = usePublicShare(code);

  // Persist this view to recent-shares so it shows up on the landing
  useEffect(() => {
    if (!data) return;
    trackRecentShare({
      short_code: data.short_code,
      name: data.name,
      owner_name: data.owner_name,
      item_count: data.items.length,
    });
  }, [data]);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (error) {
    const isMissing = error instanceof ApiError && error.isNotFound;
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <Text style={[styles.errorTitle, { color: c.text }]}>
          {isMissing ? 'Collection not found' : 'Something went wrong'}
        </Text>
        <Text style={[styles.errorBody, { color: c.textMuted }]}>
          {isMissing
            ? "We couldn't find a public collection with that code. Double-check and try again."
            : 'Please try again in a moment.'}
        </Text>
        <Pressable
          onPress={() => refetch()}
          style={({ pressed }) => [
            styles.retryButton,
            { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.retryButtonText, { color: c.text }]}>
            {isRefetching ? 'Retrying…' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const handleShareLink = async () => {
    await Share.share({
      message: `https://ceteris.app/c/${data.short_code}`,
      title: data.name,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => setQrVisible(true)} hitSlop={12}>
                <Text style={[styles.headerAction, { color: c.accent }]}>QR</Text>
              </Pressable>
              <Pressable onPress={handleShareLink} hitSlop={12}>
                <Text style={[styles.headerAction, { color: c.accent }]}>Share</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <QrModal
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        shortCode={data.short_code}
        collectionName={data.name}
      />

      <ScrollView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>{data.name}</Text>

          <View style={styles.bylineRow}>
            {data.owner_name ? (
              <Text style={[styles.byline, { color: c.textMuted }]}>by {data.owner_name}</Text>
            ) : null}
            <Text style={[styles.timestamp, { color: c.textMuted }]}>
              Updated {formatRelativeTime(data.updated_at)}
            </Text>
          </View>

          {data.description ? (
            <Text style={[styles.description, { color: c.text }]}>{data.description}</Text>
          ) : null}
        </View>

        <View style={styles.itemsList}>
          {data.items.length === 0 ? (
            <Text style={[styles.empty, { color: c.textMuted }]}>
              This collection is empty.
            </Text>
          ) : (
            data.items.map((item) => <ShareItemCard key={item.id} item={item} />)
          )}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: c.textMuted }]}>
            {data.items.length} {data.items.length === 1 ? 'paper' : 'papers'}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  bylineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  byline: {
    fontSize: 14,
  },
  timestamp: {
    fontSize: 14,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: Spacing.md,
  },
  itemsList: {
    paddingHorizontal: Spacing.lg,
  },
  empty: {
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  footer: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  headerAction: {
    fontSize: 16,
    fontWeight: '500',
  },
});
