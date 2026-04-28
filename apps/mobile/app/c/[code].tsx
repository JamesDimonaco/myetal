import { Ionicons } from '@expo/vector-icons';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { QrModal } from '@/components/qr-modal';
import { ShareItemCard } from '@/components/share-item-card';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { usePublicShare } from '@/hooks/usePublicShare';
import { ApiError } from '@/lib/api';
import { trackRecentShare } from '@/lib/recent-shares';
import { formatRelativeTime } from '@/lib/time';

export default function PublicShareScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = params.code;
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

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
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  if (error) {
    const { title, body, icon } = describeError(error);
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <View
          style={[
            styles.errorIconWrap,
            { backgroundColor: c.accentSoft },
          ]}
        >
          <Ionicons name={icon} size={28} color={c.accent} />
        </View>
        <Text style={[styles.errorTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.errorBody, { color: c.textMuted }]}>{body}</Text>
        <View style={styles.errorAction}>
          <Button
            label={isRefetching ? 'Retrying' : 'Try again'}
            icon="refresh"
            variant="secondary"
            loading={isRefetching}
            fullWidth={false}
            onPress={() => refetch()}
          />
        </View>
      </View>
    );
  }

  if (!data) return null;

  const handleShareLink = async () => {
    haptics.tap();
    await Share.share({
      message: `https://myetal.app/c/${data.short_code}`,
      title: data.name,
    });
  };

  const handleOpenQr = () => {
    haptics.tapStrong();
    setQrVisible(true);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={handleOpenQr}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Show QR code"
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  {
                    backgroundColor: pressed ? c.accentSoft : 'transparent',
                  },
                ]}
              >
                <Ionicons name="qr-code-outline" size={22} color={c.accent} />
              </Pressable>
              <Pressable
                onPress={handleShareLink}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Share link"
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  {
                    backgroundColor: pressed ? c.accentSoft : 'transparent',
                  },
                ]}
              >
                <Ionicons name="share-outline" size={22} color={c.accent} />
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

      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={c.accent}
          />
        }
      >
        <Animated.View entering={FadeInUp.duration(360)} style={styles.header}>
          <View style={styles.codeChipRow}>
            <View
              style={[styles.codeChip, { backgroundColor: c.surfaceSunken }]}
            >
              <Ionicons name="link" size={11} color={c.textMuted} />
              <Text style={[styles.codeChipText, { color: c.textMuted }]}>
                {data.short_code}
              </Text>
            </View>
            <Text style={[styles.timestamp, { color: c.textSubtle }]}>
              Updated {formatRelativeTime(data.updated_at)}
            </Text>
          </View>

          <Text style={[styles.title, { color: c.text }]}>{data.name}</Text>

          {data.owner_name ? (
            <View style={styles.bylineRow}>
              <Ionicons name="person-circle-outline" size={16} color={c.textMuted} />
              <Text style={[styles.byline, { color: c.textMuted }]}>
                {data.owner_name}
              </Text>
            </View>
          ) : null}

          {data.description ? (
            <Text style={[styles.description, { color: c.text }]}>
              {data.description}
            </Text>
          ) : null}
        </Animated.View>

        {data.items.length > 0 ? (
          <Animated.View
            entering={FadeInUp.duration(340).delay(80)}
            style={styles.countRow}
          >
            <Text style={[styles.countLabel, { color: c.textSubtle }]}>
              {data.items.length} {data.items.length === 1 ? 'PAPER' : 'PAPERS'}
            </Text>
            <View style={[styles.countRule, { backgroundColor: c.border }]} />
          </Animated.View>
        ) : null}

        <View style={styles.itemsList}>
          {data.items.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View
                style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}
              >
                <Ionicons name="document-text-outline" size={22} color={c.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                Nothing here yet
              </Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                The owner hasn&apos;t added any papers to this collection.
              </Text>
            </View>
          ) : (
            data.items.map((item, i) => (
              <Animated.View
                key={item.id}
                entering={FadeInUp.duration(340).delay(120 + i * 50)}
              >
                <ShareItemCard item={item} />
              </Animated.View>
            ))
          )}
        </View>

        {data.related_shares?.length > 0 ? (
          <Animated.View
            entering={FadeInUp.duration(340).delay(180)}
            style={styles.discoverySection}
          >
            <View style={[styles.discoverySep, { backgroundColor: c.border }]} />
            <Text style={[styles.discoveryHeading, { color: c.text }]}>
              Who else shares these papers
            </Text>
            <Text style={[styles.discoverySubtext, { color: c.textMuted }]}>
              Other public collections with papers in common.
            </Text>
            {data.related_shares.map((rs) => (
              <Link key={rs.short_code} href={`/c/${rs.short_code}` as any} asChild>
                <Pressable
                  style={({ pressed }) => [
                    styles.discoveryRow,
                    {
                      backgroundColor: pressed ? c.surfaceSunken : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[styles.discoveryName, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {rs.name}
                  </Text>
                  <View
                    style={[
                      styles.discoveryBadge,
                      { backgroundColor: c.surfaceSunken },
                    ]}
                  >
                    <Text style={[styles.discoveryBadgeText, { color: c.textMuted }]}>
                      {rs.papers_in_common} in common
                    </Text>
                  </View>
                </Pressable>
              </Link>
            ))}
          </Animated.View>
        ) : null}

        {data.similar_shares?.length > 0 ? (
          <Animated.View
            entering={FadeInUp.duration(340).delay(200)}
            style={styles.discoverySection}
          >
            <View style={[styles.discoverySep, { backgroundColor: c.border }]} />
            <Text style={[styles.discoveryHeading, { color: c.text }]}>
              Similar collections
            </Text>
            <Text style={[styles.discoverySubtext, { color: c.textMuted }]}>
              Collections with the most overlap in papers.
            </Text>
            {data.similar_shares.map((ss) => (
              <Link key={ss.short_code} href={`/c/${ss.short_code}` as any} asChild>
                <Pressable
                  style={({ pressed }) => [
                    styles.discoveryRow,
                    {
                      backgroundColor: pressed ? c.surfaceSunken : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[styles.discoveryName, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {ss.name}
                  </Text>
                  <View
                    style={[
                      styles.discoveryBadge,
                      { backgroundColor: c.surfaceSunken },
                    ]}
                  >
                    <Text style={[styles.discoveryBadgeText, { color: c.textMuted }]}>
                      {ss.papers_in_common} in common
                    </Text>
                  </View>
                </Pressable>
              </Link>
            ))}
          </Animated.View>
        ) : null}

        {/* Show-QR CTA also lives in the body for thumb-reach on the public page */}
        {data.items.length > 0 ? (
          <Animated.View
            entering={FadeInUp.duration(360).delay(220)}
            style={styles.bottomCta}
          >
            <Button
              label="Show this collection's QR"
              icon="qr-code"
              variant="secondary"
              onPress={handleOpenQr}
            />
          </Animated.View>
        ) : null}
      </ScrollView>
    </>
  );
}

function describeError(error: unknown): {
  title: string;
  body: string;
  icon: 'alert-circle-outline' | 'cloud-offline-outline' | 'help-buoy-outline';
} {
  if (error instanceof ApiError) {
    if (error.status === 410) {
      return {
        title: 'Collection removed',
        body: 'This collection has been taken down. If you believe this was an error, contact the collection owner.',
        icon: 'alert-circle-outline',
      };
    }
    if (error.isNotFound) {
      return {
        title: 'Collection not found',
        body: "We couldn't find a public collection with that code. Double-check and try again.",
        icon: 'help-buoy-outline',
      };
    }
    if (error.status >= 500) {
      return {
        title: 'Server hiccup',
        body: 'The MyEtAl backend ran into a problem. Try again in a moment.',
        icon: 'alert-circle-outline',
      };
    }
    return {
      title: 'Something went wrong',
      body: error.detail,
      icon: 'alert-circle-outline',
    };
  }
  // fetch() throws TypeError on network failure
  return {
    title: "Can't reach MyEtAl",
    body: 'Check your connection and try again.',
    icon: 'cloud-offline-outline',
  };
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  errorIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    lineHeight: 22,
    maxWidth: 320,
  },
  errorAction: {
    alignItems: 'center',
  },

  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  codeChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  codeChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  bylineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
  },
  byline: {
    fontSize: 14,
    fontWeight: '500',
  },
  timestamp: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: Spacing.md,
  },

  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  countLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  countRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },

  itemsList: {
    paddingHorizontal: Spacing.lg,
  },
  emptyCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    marginVertical: Spacing.md,
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
    marginBottom: Spacing.xs + 2,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },

  discoverySection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  discoverySep: {
    height: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  discoveryHeading: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  discoverySubtext: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  discoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.sm + 4,
    borderRadius: Radius.md,
    marginBottom: 2,
  },
  discoveryName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginRight: Spacing.sm,
  },
  discoveryBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  discoveryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  bottomCta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },

  headerActions: {
    flexDirection: 'row',
    gap: 4,
    marginRight: Spacing.xs,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
