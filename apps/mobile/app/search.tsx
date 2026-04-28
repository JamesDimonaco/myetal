import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useShareSearch } from '@/hooks/useShareSearch';
import { formatRelativeTime } from '@/lib/time';
import type { ShareSearchResult, ShareType } from '@/types/share';

const TYPE_FILTERS: { label: string; value: ShareType }[] = [
  { label: 'Paper', value: 'paper' },
  { label: 'Collection', value: 'collection' },
  { label: 'Poster', value: 'poster' },
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

  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length >= 2;

  // Client-side type filter
  const filteredResults =
    data?.results && activeTypes.size > 0
      ? data.results.filter((r) => activeTypes.has(r.type))
      : data?.results ?? [];

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
              placeholder="Search by title, author, or topic..."
              placeholderTextColor={c.textSubtle}
              style={[styles.input, { color: c.text }]}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityRole="search"
              accessibilityLabel="Search published collections"
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

        {/* Type filter pills — shown when there are results */}
        {hasQuery && data?.results && data.results.length > 0 && (
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
          /* Empty state — before the user types */
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
              Discover collections
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              Search for published collections by title, author, or topic.
            </Text>
          </Animated.View>
        ) : isLoading || isFetching ? (
          /* Loading */
          <View style={styles.centered}>
            <ActivityIndicator color={c.accent} size="small" />
          </View>
        ) : filteredResults.length === 0 ? (
          /* No results */
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
              No collections matched
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              Try different keywords, check for typos, or search for an author
              name.
            </Text>
          </Animated.View>
        ) : (
          /* Results list */
          <FlatList
            data={filteredResults}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: c.border }]} />
            )}
          />
        )}
      </View>
    </>
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
            <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
          </>
        ) : null}
        <View style={[styles.typePill, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.typePillText, { color: c.accent }]}>
            {typeLabel}
          </Text>
        </View>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
        <Text style={[styles.metaText, { color: c.textSubtle }]}>
          {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.metaDot, { color: c.textSubtle }]}>{'\u00B7'}</Text>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Results list */
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
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
