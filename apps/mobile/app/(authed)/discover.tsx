import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { SavedShareCard } from '@/components/saved-share-card';
import { TagChips } from '@/components/tag-chips';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBrowse } from '@/hooks/useBrowse';
import { useSavedShares } from '@/hooks/useSavedShares';
import { formatRelativeTime } from '@/lib/time';
import type { BrowseShareResult } from '@/types/share';

export default function DiscoverScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const navigation = useNavigation();
  const savedShares = useSavedShares();
  const hasSaved = (savedShares?.length ?? 0) > 0;
  const { data: browseData } = useBrowse();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Discover',
    });
  }, [navigation]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {/* Search entry */}
      <Pressable
        onPress={() => router.push('/search')}
        accessibilityRole="search"
        accessibilityLabel="Search collections"
        style={({ pressed }) => [
          styles.searchEntry,
          {
            borderColor: c.border,
            backgroundColor: c.surface,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={c.textSubtle} />
        <Text style={[styles.searchPlaceholder, { color: c.textSubtle }]}>
          Search collections...
        </Text>
      </Pressable>

      {/* Saved collections */}
      {savedShares === null ? null : hasSaved ? (
        <Animated.View entering={FadeIn.duration(300)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: c.textSubtle }]}>
              SAVED
            </Text>
            <Text style={[styles.sectionCount, { color: c.textSubtle }]}>
              {savedShares!.length}
            </Text>
          </View>
          {savedShares!.map((entry) => (
            <SavedShareCard key={entry.short_code} entry={entry} />
          ))}
        </Animated.View>
      ) : null}

      {/* Browse sections */}
      {browseData ? (
        <BrowseSections data={browseData} colors={c} />
      ) : (
        <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
          <View
            style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}
          >
            <Ionicons name="compass-outline" size={24} color={c.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            Discover collections
          </Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            Search for published collections or browse what others are sharing.
          </Text>
        </Animated.View>
      )}
    </ScrollView>
  );
}

function BrowseSections({
  data,
  colors: c,
}: {
  data: { trending: BrowseShareResult[]; recent: BrowseShareResult[]; total_published: number };
  colors: typeof Colors.light;
}) {
  const { trending, recent, total_published } = data;

  if (trending.length === 0 && recent.length === 0) {
    return (
      <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
        <View style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="sparkles-outline" size={24} color={c.accent} />
        </View>
        <Text style={[styles.emptyTitle, { color: c.text }]}>Be the first</Text>
        <Text style={[styles.emptyBody, { color: c.textMuted }]}>
          Publish a collection and it will appear here.
        </Text>
      </Animated.View>
    );
  }

  const showTrending = trending.length >= 3;

  return (
    <Animated.View entering={FadeInUp.duration(300)}>
      {showTrending ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.textSubtle }]}>
            TRENDING THIS WEEK
          </Text>
          {trending.map((item, i) => (
            <View key={item.short_code}>
              {i > 0 && (
                <View style={[styles.separator, { backgroundColor: c.border }]} />
              )}
              <BrowseCard item={item} colors={c} showViews />
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.section, showTrending ? { marginTop: Spacing.lg } : undefined]}>
        <Text style={[styles.sectionLabel, { color: c.textSubtle }]}>
          RECENTLY PUBLISHED
        </Text>
        {recent.map((item, i) => (
          <View key={item.short_code}>
            {i > 0 && (
              <View style={[styles.separator, { backgroundColor: c.border }]} />
            )}
            <BrowseCard item={item} colors={c} />
          </View>
        ))}
      </View>

      {total_published >= 5 ? (
        <Text style={[styles.browseTotal, { color: c.textSubtle }]}>
          {total_published} collections published
        </Text>
      ) : null}
    </Animated.View>
  );
}

function BrowseCard({
  item,
  colors: c,
  showViews,
}: {
  item: BrowseShareResult;
  colors: typeof Colors.light;
  showViews?: boolean;
}) {
  const handlePress = () => {
    router.push(`/c/${item.short_code}` as any);
  };

  const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={`View ${item.name}`}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>
        {item.name}
      </Text>
      {item.description ? (
        <Text style={[styles.cardDesc, { color: c.textMuted }]} numberOfLines={1}>
          {item.description}
        </Text>
      ) : null}
      <View style={styles.metaRow}>
        {item.owner_name ? (
          <>
            <Text style={[styles.metaText, { color: c.textSubtle }]}>
              {item.owner_name}
            </Text>
            <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
          </>
        ) : null}
        <View style={[styles.typePill, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.typePillText, { color: c.accent }]}>{typeLabel}</Text>
        </View>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {showViews && item.view_count != null
            ? `${item.view_count} ${item.view_count === 1 ? 'view' : 'views'}`
            : formatRelativeTime(item.published_at)}
        </Text>
      </View>
      {item.preview_items.length > 0 && (
        <Text style={[styles.preview, { color: c.textSubtle }]} numberOfLines={1}>
          Contains: {item.preview_items.join(', ')}
        </Text>
      )}
      <TagChips tags={item.tags} max={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  searchEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchPlaceholder: {
    fontSize: 15,
    fontWeight: '400',
  },

  section: {
    marginTop: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
  },

  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: Spacing.xs + 2,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },

  separator: {
    height: StyleSheet.hairlineWidth,
  },
  browseTotal: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },

  card: {
    paddingVertical: Spacing.md,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  cardDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: Spacing.sm,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  metaDot: {
    fontSize: 12,
    fontWeight: '700',
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  typePillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  preview: {
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
});
