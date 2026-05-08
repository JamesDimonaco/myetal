import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { TagChips } from '@/components/tag-chips';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBrowse } from '@/hooks/useBrowse';
import { useShareSearch } from '@/hooks/useShareSearch';
import { formatRelativeTime } from '@/lib/time';
import type {
  BrowseResponse,
  BrowseShareResult,
  ShareSearchResult,
  ShareType,
  UserPublicOut,
} from '@/types/share';

const TYPE_FILTERS: { label: string; value: ShareType }[] = [
  { label: 'Paper', value: 'paper' },
  { label: 'Collection', value: 'collection' },
  { label: 'Bundle', value: 'bundle' },
  { label: 'Grant', value: 'grant' },
  { label: 'Project', value: 'project' },
];

export default function SearchScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTypes, setActiveTypes] = useState<Set<ShareType>>(new Set());
  const inputRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the search query by 300ms
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(inputValue);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [inputValue]);

  const { data, isLoading, isFetching } = useShareSearch(debouncedQuery);
  const { data: browseData } = useBrowse();

  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length >= 2;

  // Client-side type filter
  const filteredResults =
    data?.results && activeTypes.size > 0
      ? data.results.filter((r) => activeTypes.has(r.type))
      : data?.results ?? [];

  const userResults = data?.users ?? [];
  const hasShares = filteredResults.length > 0;
  const hasUsers = userResults.length > 0;
  const hasResults = hasShares || hasUsers;

  const toggleType = useCallback((type: ShareType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setInputValue('');
    setDebouncedQuery('');
    inputRef.current?.focus();
  }, []);

  const browseAll = useCallback(() => {
    router.replace('/(authed)/discover');
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ShareSearchResult }) => (
      <ResultCard item={item} colors={c} />
    ),
    [c],
  );

  const keyExtractor = useCallback(
    (item: ShareSearchResult) => item.short_code,
    [],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Search',
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
        {/* Search input */}
        <View style={styles.inputWrap}>
          <View
            style={[
              styles.inputRow,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Ionicons
              name="search-outline"
              size={20}
              color={c.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              ref={inputRef}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder="Search collections or people..."
              placeholderTextColor={c.textSubtle}
              style={[styles.input, { color: c.text }]}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityRole="search"
              accessibilityLabel="Search published collections or people"
            />
            {inputValue.length > 0 && (
              <Pressable
                onPress={handleClear}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={styles.clearBtn}
              >
                <Ionicons name="close-circle" size={20} color={c.textSubtle} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Type filter pills — shown when there are share results */}
        {hasQuery && filteredResults.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
            style={styles.pillScroll}
          >
            {TYPE_FILTERS.map(({ label, value }) => {
              const active = activeTypes.has(value);
              return (
                <Pressable
                  key={value}
                  onPress={() => toggleType(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Filter by ${label}`}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: active ? c.accent : 'transparent',
                      borderColor: active ? c.accent : c.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: active ? c.background : c.textMuted },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Content area */}
        {!hasQuery ? (
          /* E11 — search initial state. Render trending+recent with a quiet
              "browse all" prompt above. */
          browseData ? (
            <ScrollView
              contentContainerStyle={styles.browseContent}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.initialPromptRow}>
                <Text style={[styles.initialPromptText, { color: c.textMuted }]}>
                  Public collections — search above or
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Browse all collections"
                  onPress={browseAll}
                  hitSlop={6}
                >
                  <Text style={[styles.initialPromptLink, { color: c.accent }]}>
                    browse all →
                  </Text>
                </Pressable>
              </View>
              <BrowseSections data={browseData} colors={c} />
            </ScrollView>
          ) : (
            <Animated.View
              entering={FadeIn.duration(300)}
              style={styles.emptyWrap}
            >
              <View
                style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}
              >
                <Ionicons name="search" size={24} color={c.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                Search collections or people
              </Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                Type to search, or{' '}
                <Text
                  onPress={browseAll}
                  style={{ color: c.accent, fontWeight: '600' }}
                  accessibilityRole="link"
                >
                  browse all →
                </Text>
              </Text>
            </Animated.View>
          )
        ) : isLoading || isFetching ? (
          /* Loading */
          <View style={styles.centered}>
            <ActivityIndicator color={c.accent} size="small" />
          </View>
        ) : !hasResults ? (
          /* E5 — combined empty state: nothing matched in either bucket. */
          <Animated.View
            entering={FadeIn.duration(300)}
            style={styles.emptyWrap}
          >
            <View
              style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}
            >
              <Ionicons name="document-text-outline" size={24} color={c.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: c.text }]}>
              No matches
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              No collections or people matched &apos;{trimmed}&apos;.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Browse all collections"
              onPress={browseAll}
              style={({ pressed }) => [
                styles.browseAllBtn,
                {
                  borderColor: c.accent,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.browseAllBtnText, { color: c.accent }]}>
                Browse all
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          /* Results — split per result type per E5 spec.
             - shares=0 && users>0 → "No collections matched 'q'." line above
               the People block.
             - users=0 && shares>0 → "No people matched 'q'." line below the
               shares list.
             - both>0 → no empty messaging, just both blocks. */
          <FlatList
            data={filteredResults}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <>
                {!hasShares && hasUsers ? (
                  <Text
                    style={[styles.inlineEmpty, { color: c.textMuted }]}
                  >
                    No collections matched &apos;{trimmed}&apos;.
                  </Text>
                ) : null}
                {hasUsers ? (
                  <PeopleBlock
                    users={userResults}
                    colors={c}
                    showCollectionsHeader={hasShares}
                  />
                ) : null}
              </>
            }
            ListFooterComponent={
              hasShares && !hasUsers ? (
                <Text
                  style={[styles.inlineEmptyFooter, { color: c.textSubtle }]}
                >
                  No people matched &apos;{trimmed}&apos;.
                </Text>
              ) : null
            }
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: c.border }]} />
            )}
          />
        )}
      </View>
    </>
  );
}

/* ──────────────────────── People block (M3) ──────────────────────── */

function PeopleBlock({
  users,
  colors: c,
  showCollectionsHeader,
}: {
  users: UserPublicOut[];
  colors: typeof Colors.light;
  /** When false, the trailing "Collections" header + separator are
   *  suppressed (no shares matched, so no list follows). */
  showCollectionsHeader: boolean;
}) {
  const visible = users.slice(0, 5);
  return (
    <View style={styles.peopleBlock}>
      <Text style={[styles.peopleHeader, { color: c.textSubtle }]}>People</Text>
      {visible.map((u, i) => (
        <View key={u.id}>
          {i > 0 ? (
            <View style={[styles.separator, { backgroundColor: c.border }]} />
          ) : null}
          <PersonRow user={u} colors={c} />
        </View>
      ))}
      {showCollectionsHeader ? (
        <>
          <View
            style={[styles.peopleSeparator, { backgroundColor: c.border }]}
            accessibilityElementsHidden
          />
          <Text style={[styles.peopleHeader, { color: c.textSubtle }]}>
            Collections
          </Text>
        </>
      ) : null}
    </View>
  );
}

function PersonRow({
  user,
  colors: c,
}: {
  user: UserPublicOut;
  colors: typeof Colors.light;
}) {
  const name = user.name ?? 'Anonymous';
  const handlePress = () => {
    router.push({
      pathname: '/(authed)/discover',
      params: { owner_id: user.id },
    });
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={`View ${name}'s collections`}
      style={({ pressed }) => [styles.personRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      {user.avatar_url ? (
        <Image
          source={{ uri: user.avatar_url }}
          style={styles.personAvatar}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.personAvatarFallback,
            { backgroundColor: c.accentSoft },
          ]}
        >
          <Text style={[styles.personInitials, { color: c.accent }]}>
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.personMeta, { color: c.textSubtle }]}>
          {user.share_count}{' '}
          {user.share_count === 1 ? 'collection' : 'collections'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
    </Pressable>
  );
}

/* ──────────────────────── Browse sections ──────────────────────── */

function BrowseSections({
  data,
  colors: c,
}: {
  data: BrowseResponse;
  colors: typeof Colors.light;
}) {
  const { trending, recent, total_published } = data;

  // Cold start: nothing published
  if (trending.length === 0 && recent.length === 0) {
    return (
      <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
        <View style={[styles.emptyIconWrap, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="sparkles-outline" size={24} color={c.accent} />
        </View>
        <Text style={[styles.emptyTitle, { color: c.text }]}>
          Be the first
        </Text>
        <Text style={[styles.emptyBody, { color: c.textMuted }]}>
          Publish a collection and it will appear here.
        </Text>
      </Animated.View>
    );
  }

  const showTrending = trending.length >= 3;

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      {showTrending ? (
        <>
          <Text style={[styles.sectionHeader, { color: c.textSubtle }]}>
            Trending this week
          </Text>
          {trending.map((item, i) => (
            <View key={item.short_code}>
              {i > 0 && (
                <View
                  style={[styles.separator, { backgroundColor: c.border }]}
                />
              )}
              <BrowseCard item={item} colors={c} showViews />
            </View>
          ))}
        </>
      ) : null}

      <Text
        style={[
          styles.sectionHeader,
          { color: c.textSubtle },
          showTrending ? { marginTop: Spacing.xl } : undefined,
        ]}
      >
        Recently published
      </Text>
      {recent.map((item, i) => (
        <View key={item.short_code}>
          {i > 0 && (
            <View
              style={[styles.separator, { backgroundColor: c.border }]}
            />
          )}
          <BrowseCard item={item} colors={c} />
        </View>
      ))}

      {total_published >= 5 ? (
        <Text style={[styles.browseTotal, { color: c.textSubtle }]}>
          Browse {total_published} collections
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
        <Text
          style={[styles.cardDesc, { color: c.textMuted }]}
          numberOfLines={1}
        >
          {item.description}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        {item.owner_name ? (
          <>
            <Text style={[styles.metaText, { color: c.textSubtle }]}>
              {item.owner_name}
            </Text>
            <Text style={[styles.metaDot, { color: c.textSubtle }]}>
              {'·'}
            </Text>
          </>
        ) : null}
        <View style={[styles.typePill, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.typePillText, { color: c.accent }]}>
            {typeLabel}
          </Text>
        </View>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>
          {'·'}
        </Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>
          {'·'}
        </Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {showViews && item.view_count != null
            ? `${item.view_count} ${item.view_count === 1 ? 'view' : 'views'}`
            : formatRelativeTime(item.published_at)}
        </Text>
      </View>

      {item.preview_items.length > 0 && (
        <Text
          style={[styles.preview, { color: c.textSubtle }]}
          numberOfLines={1}
        >
          Contains: {item.preview_items.join(', ')}
        </Text>
      )}
      <TagChips tags={item.tags} max={2} linkPattern="browse" />
    </Pressable>
  );
}

/* ──────────────────────── Result card ──────────────────────── */

function ResultCard({
  item,
  colors: c,
}: {
  item: ShareSearchResult;
  colors: typeof Colors.light;
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
      style={({ pressed }) => [
        styles.card,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {/* Title */}
      <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>
        {item.name}
      </Text>

      {/* Description */}
      {item.description ? (
        <Text
          style={[styles.cardDesc, { color: c.textMuted }]}
          numberOfLines={1}
        >
          {item.description}
        </Text>
      ) : null}

      {/* Metadata row */}
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
          <Text style={[styles.typePillText, { color: c.accent }]}>
            {typeLabel}
          </Text>
        </View>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'·'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'·'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {formatRelativeTime(item.published_at)}
        </Text>
      </View>

      {/* Preview items */}
      {item.preview_items.length > 0 && (
        <Text
          style={[styles.preview, { color: c.textSubtle }]}
          numberOfLines={1}
        >
          Contains: {item.preview_items.join(', ')}
        </Text>
      )}
      <TagChips tags={item.tags} max={2} linkPattern="browse" />
    </Pressable>
  );
}

/* ──────────────────────── Styles ──────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  /* Search input */
  inputWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 12,
  },
  clearBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Filter pills */
  pillScroll: {
    flexGrow: 0,
  },
  pillRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* Empty / loading states */
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
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
    maxWidth: 320,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseAllBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  browseAllBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Initial-state prompt */
  initialPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  initialPromptText: {
    fontSize: 13,
  },
  initialPromptLink: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* Browse sections */
  browseContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  browseTotal: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },

  /* People block */
  peopleBlock: {
    marginBottom: Spacing.md,
  },
  peopleHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  peopleSeparator: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  personAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  personAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personInitials: {
    fontSize: 14,
    fontWeight: '700',
  },
  personName: {
    fontSize: 15,
    fontWeight: '600',
  },
  personMeta: {
    fontSize: 12,
    marginTop: 2,
  },

  /* Results list */
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  inlineEmpty: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  inlineEmptyFooter: {
    fontSize: 12,
    marginTop: Spacing.lg,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },

  /* Result card */
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
