import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  Image,
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
import { ApiError } from '@/lib/api';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBrowse } from '@/hooks/useBrowse';
import { usePopularTags } from '@/hooks/usePopularTags';
import { useSavedShares } from '@/hooks/useSavedShares';
import { formatRelativeTime } from '@/lib/time';
import type { BrowseShareResult, UserPublicOut } from '@/types/share';

/**
 * Discover — the canonical "browse public shares" surface on mobile.
 *
 * Reads two route params on mount (M1, M4):
 * - `tag=<slug>` — pre-selects a tag in the chip-row filter.
 * - `owner_id=<uuid>` — scopes the feed to a single user's shares and
 *   renders an owner header above the list.
 *
 * Filters persist in screen-local state (per spec — mobile route stack handles
 * state, no urlencoded round-trip needed). Default state on a fresh nav is
 * "no filters", which matches the spec.
 */
export default function DiscoverScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ tag?: string; owner_id?: string }>();
  const { items: savedShares } = useSavedShares();
  const hasSaved = (savedShares?.length ?? 0) > 0;

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // Hydrate filter state from route params on first mount + whenever the
  // params change (e.g. user taps a chip on a card → router.push with new tag).
  // Both effects are symmetric: when the param is removed from the URL the
  // state must clear as well, otherwise stale filters stick around after the
  // user navigates away and back without the param. (M-FIX-1)
  useEffect(() => {
    const next =
      typeof params.tag === 'string' && params.tag.length > 0
        ? params.tag
        : null;
    setActiveTag(next);
  }, [params.tag]);
  useEffect(() => {
    const next =
      typeof params.owner_id === 'string' && params.owner_id.length > 0
        ? params.owner_id
        : null;
    setOwnerId(next);
  }, [params.owner_id]);

  const { data: popularTags } = usePopularTags(8);
  const browseQuery = useBrowse({
    tags: activeTag ? [activeTag] : undefined,
    ownerId,
  });
  const { data: browseData, error: browseError } = browseQuery;

  // Resolve the active slug to its display label. Prefer the popular-tags
  // cache (most common path — chip taps); fall back to a slug→label
  // de-hyphenation when the tag isn't in the popular set (e.g. arrived via
  // deep-link from a share card). (M-FIX-5)
  const activeTagLabel = activeTag
    ? (popularTags?.find((t) => t.slug === activeTag)?.label ??
      activeTag.replace(/-/g, ' '))
    : null;

  const ownerNotFound =
    !!ownerId &&
    browseError instanceof ApiError &&
    browseError.isNotFound;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Discover',
    });
  }, [navigation]);

  const clearOwner = () => {
    // "Show all" clears every filter — tag and owner. Single intent: surface
    // all collections. (M-FIX-2)
    setOwnerId(null);
    setActiveTag(null);
    // Replace the route so back doesn't bounce us back into the owner view.
    router.replace('/(authed)/discover');
  };

  const toggleTag = (slug: string) => {
    setActiveTag((prev) => (prev === slug ? null : slug));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {/* Owner header (M4) — only when filtering by a single user. */}
      {ownerId ? (
        <OwnerHeader
          owner={browseData?.owner ?? null}
          notFound={ownerNotFound}
          onClear={clearOwner}
          colors={c}
        />
      ) : null}

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

      {/* Tag pill row (M1) */}
      {popularTags && popularTags.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagRow}
          style={styles.tagScroll}
        >
          {popularTags.map((tag) => {
            const active = activeTag === tag.slug;
            return (
              <Pressable
                key={tag.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter by ${tag.label}`}
                onPress={() => toggleTag(tag.slug)}
                style={({ pressed }) => [
                  styles.tagPill,
                  {
                    backgroundColor: active ? c.accent : 'transparent',
                    borderColor: active ? c.accent : c.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tagPillText,
                    { color: active ? c.background : c.textMuted },
                  ]}
                >
                  {tag.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Active tag indicator + clear */}
      {activeTag ? (
        <View style={styles.activeRow}>
          <Text style={[styles.activeLabel, { color: c.textSubtle }]}>
            Filtering by{' '}
            <Text style={{ color: c.text, fontWeight: '600' }}>
              {activeTagLabel}
            </Text>
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear tag filter"
            onPress={() => setActiveTag(null)}
            hitSlop={8}
          >
            <Text style={[styles.clearLink, { color: c.accent }]}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Saved collections — only when no filter is active so we don't
          confuse "tag-filtered list" with "saved list". */}
      {!activeTag && !ownerId && savedShares !== null && hasSaved ? (
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

      {/* Owner-not-found path takes precedence over the normal browse render. */}
      {ownerNotFound ? (
        <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
          <View style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}>
            <Ionicons name="person-outline" size={24} color={c.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>User not found</Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            We couldn&apos;t find that person. They may have removed their account
            or have no published shares yet.
          </Text>
        </Animated.View>
      ) : browseData ? (
        <BrowseSections
          data={browseData}
          activeTag={activeTag}
          activeTagLabel={activeTagLabel}
          colors={c}
        />
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

/* ──────────────────────── Owner header (M4) ──────────────────────── */

/**
 * Slim filter-context bar (not a profile). Mirrors the web reframing
 * (M-FIX-6): the owner header is a "you're filtering by Alice" indicator,
 * not a user profile card. Layout:
 *   [ avatar 28px ]  Collections by Alice (4)         [ Show all ]
 */
function OwnerHeader({
  owner,
  notFound,
  onClear,
  colors: c,
}: {
  owner: UserPublicOut | null;
  notFound: boolean;
  onClear: () => void;
  colors: typeof Colors.light;
}) {
  return (
    <View
      style={[
        styles.ownerHeader,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      {owner && !notFound ? (
        <View style={styles.ownerRow}>
          {owner.avatar_url ? (
            <Image
              source={{ uri: owner.avatar_url }}
              style={styles.ownerAvatar}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={[
                styles.ownerAvatarFallback,
                { backgroundColor: c.accentSoft },
              ]}
            >
              <Text style={[styles.ownerInitials, { color: c.accent }]}>
                {(owner.name ?? 'U').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text
            style={[styles.ownerLine, { color: c.textMuted }]}
            numberOfLines={1}
          >
            Collections by{' '}
            <Text style={{ color: c.text, fontWeight: '600' }}>
              {owner.name ?? 'Anonymous'}
            </Text>{' '}
            ({owner.share_count})
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show all collections"
        onPress={onClear}
        hitSlop={8}
      >
        <Text style={[styles.clearLink, { color: c.accent }]}>
          Show all
        </Text>
      </Pressable>
    </View>
  );
}

/* ──────────────────────── Browse sections ──────────────────────── */

function BrowseSections({
  data,
  activeTag,
  activeTagLabel,
  colors: c,
}: {
  data: { trending: BrowseShareResult[]; recent: BrowseShareResult[]; total_published: number };
  activeTag: string | null;
  activeTagLabel: string | null;
  colors: typeof Colors.light;
}) {
  const { trending, recent, total_published } = data;

  if (trending.length === 0 && recent.length === 0) {
    // E6 — tag-filter empty state (mobile)
    if (activeTag) {
      return (
        <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
          <View style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}>
            <Ionicons name="pricetag-outline" size={24} color={c.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            Nothing here yet
          </Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            No shares tagged &apos;{activeTagLabel ?? activeTag}&apos; yet. Be
            the first to tag one.
          </Text>
        </Animated.View>
      );
    }
    // E7 fallback — brand new app, no shares anywhere
    return (
      <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
        <View style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="sparkles-outline" size={24} color={c.accent} />
        </View>
        <Text style={[styles.emptyTitle, { color: c.text }]}>Be the first</Text>
        <Text style={[styles.emptyBody, { color: c.textMuted }]}>
          No public collections to browse yet. Share a paper, a reading list, or
          a poster, and it shows up here.
        </Text>
      </Animated.View>
    );
  }

  const showTrending = trending.length >= 3 && !activeTag;

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
          {activeTag ? 'MATCHING SHARES' : 'RECENTLY PUBLISHED'}
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
            <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'·'}</Text>
          </>
        ) : null}
        <View style={[styles.typePill, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.typePillText, { color: c.accent }]}>{typeLabel}</Text>
        </View>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'·'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'·'}</Text>
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
      <TagChips tags={item.tags} max={2} linkPattern="browse" />
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

  /* Tag pill row */
  tagScroll: {
    flexGrow: 0,
    marginBottom: Spacing.sm,
  },
  tagRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  tagPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
    justifyContent: 'center',
  },
  tagPillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  activeLabel: { fontSize: 13 },
  clearLink: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Owner header — slim filter-context bar (M-FIX-6) */
  ownerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  ownerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ownerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  ownerAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerInitials: {
    fontSize: 12,
    fontWeight: '700',
  },
  ownerLine: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
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
