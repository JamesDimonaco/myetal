/**
 * Add-paper modal. Three input modes:
 *   DOI    — paste a DOI or DOI URL; debounced lookup against Crossref
 *   Search — type ≥3 chars; debounced full-text search via OpenAlex
 *   Manual — escape hatch for grey literature; user fills the row themselves
 *
 * On confirm we drop the chosen Paper into a module-level outbox
 * (`setPendingPaper`) and pop the modal — the share editor picks it up via a
 * subscribe-on-mount listener. See `lib/pending-paper.ts`.
 *
 * Note on filename: the brief named this `_add-paper.tsx`, but expo-router
 * treats underscore-prefixed files as private (excluded from routes), so the
 * file lives at `add-paper.tsx`. The route is hidden from the tab bar via
 * `href: null` in `(authed)/_layout.tsx`.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Colors, Radius, Shadows, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { extractDoi, useLookupPaper, useSearchPapers } from '@/hooks/usePapers';
import { ApiError } from '@/lib/api';
import { setPendingPaper } from '@/lib/pending-paper';
import type { Paper, PaperSearchResult } from '@/types/paper';

type Mode = 'doi' | 'search' | 'manual';
const MODES: { id: Mode; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'Manual' },
];

const DEBOUNCE_MS = 300;

export default function AddPaperScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [mode, setMode] = useState<Mode>('doi');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: 'Add paper',
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />

      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        {/* Mode segmented control */}
        <View style={styles.segmentRow}>
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  haptics.selection();
                  setMode(m.id);
                }}
                style={({ pressed }) => [
                  styles.segment,
                  {
                    backgroundColor: active ? c.text : c.surface,
                    borderColor: active ? c.text : c.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: active ? c.background : c.text },
                  ]}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'doi' ? <DoiPane /> : null}
        {mode === 'search' ? <SearchPane /> : null}
        {mode === 'manual' ? <ManualPane /> : null}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

// ---------- shared pieces ----------

function PaperPreview({
  paper,
  onAdd,
  busy,
}: {
  paper: Paper;
  onAdd: () => void;
  busy?: boolean;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      style={[
        styles.previewCard,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
        },
        Shadows.sm,
      ]}
    >
      <Text style={[styles.previewTitle, { color: c.text }]} numberOfLines={3}>
        {paper.title}
      </Text>
      {paper.authors ? (
        <Text style={[styles.previewMeta, { color: c.textMuted }]} numberOfLines={2}>
          {paper.authors}
        </Text>
      ) : null}
      <View style={styles.previewMetaRow}>
        {paper.container ? (
          <Text style={[styles.previewMetaSmall, { color: c.textMuted }]} numberOfLines={1}>
            {paper.container}
          </Text>
        ) : null}
        {paper.year != null ? (
          <Text style={[styles.previewMetaSmall, { color: c.textMuted }]}>
            {paper.year}
          </Text>
        ) : null}
        <Text style={[styles.previewSourceTag, { color: c.accentText, backgroundColor: c.accentSoft }]}>
          {paper.source}
        </Text>
      </View>
      {paper.doi ? (
        <Text style={[styles.previewDoi, { color: c.textSubtle }]} numberOfLines={1}>
          {paper.doi}
        </Text>
      ) : null}
      <View style={{ height: Spacing.md }} />
      <Button label="Add to collection" icon="add" onPress={onAdd} loading={busy} />
    </Animated.View>
  );
}

function ErrorBanner({ error }: { error: unknown }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const { title, body, icon } = describeError(error);
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={[styles.errorCard, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
    >
      <Ionicons name={icon} size={22} color={c.text} style={{ marginRight: Spacing.sm }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.errorTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.errorBody, { color: c.textMuted }]}>{body}</Text>
      </View>
    </Animated.View>
  );
}

function describeError(error: unknown): {
  title: string;
  body: string;
  icon: 'alert-circle-outline' | 'cloud-offline-outline' | 'help-buoy-outline';
} {
  if (error instanceof ApiError) {
    if (error.isNotFound) {
      return {
        title: 'Not found',
        body: 'Crossref doesn’t know that DOI. Double-check it, or fall back to Manual.',
        icon: 'help-buoy-outline',
      };
    }
    if (error.status >= 500) {
      return {
        title: 'Server hiccup',
        body: 'The metadata service is having a moment. Try again, or use Manual.',
        icon: 'alert-circle-outline',
      };
    }
    return {
      title: 'Something went wrong',
      body: error.detail,
      icon: 'alert-circle-outline',
    };
  }
  return {
    title: 'No connection',
    body: 'Check your network and try again.',
    icon: 'cloud-offline-outline',
  };
}

function commitPaper(paper: Paper, haptics: ReturnType<typeof useHaptics>) {
  haptics.success();
  setPendingPaper(paper);
  router.back();
}

// ---------- DOI mode ----------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function DoiPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [input, setInput] = useState('');
  const debounced = useDebouncedValue(input, DEBOUNCE_MS);

  const parsedDoi = useMemo(() => extractDoi(debounced), [debounced]);
  const lookup = useLookupPaper(debounced);

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>DOI</Text>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="10.1038/nature12373 or https://doi.org/..."
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: c.border,
          },
        ]}
      />
      <Text style={[styles.helperText, { color: c.textSubtle }]}>
        Paste a DOI from a paper, a doi.org URL, or arXiv.
      </Text>

      <View style={styles.paneBody}>
        {!parsedDoi ? (
          <EmptyHint
            icon="link-outline"
            title="Waiting for a DOI"
            body="As soon as we recognise one, we’ll fetch the metadata."
          />
        ) : lookup.isLoading || lookup.isFetching ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={c.text} />
            <Text style={[styles.loadingText, { color: c.textMuted }]}>
              Looking up {parsedDoi}…
            </Text>
          </View>
        ) : lookup.isError ? (
          <ErrorBanner error={lookup.error} />
        ) : lookup.data ? (
          <PaperPreview paper={lookup.data} onAdd={() => commitPaper(lookup.data!, haptics)} />
        ) : null}
      </View>
    </ScrollView>
  );
}

// ---------- Search mode ----------

function SearchPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<PaperSearchResult | null>(null);

  const debounced = useDebouncedValue(input, DEBOUNCE_MS);
  const search = useSearchPapers(debounced);

  // Reset picked when the user types again — they're refining the search.
  useEffect(() => {
    setPicked(null);
  }, [debounced]);

  const trimmed = input.trim();

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Search by title</Text>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="Attention is all you need"
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: c.border,
          },
        ]}
      />
      <Text style={[styles.helperText, { color: c.textSubtle }]}>
        Powered by OpenAlex. Best with title or first author + year.
      </Text>

      <View style={styles.paneBody}>
        {picked ? (
          <PaperPreview paper={picked} onAdd={() => commitPaper(picked, haptics)} />
        ) : trimmed.length < 3 ? (
          <EmptyHint
            icon="search-outline"
            title="Type at least 3 characters"
            body="Search runs as soon as you’ve typed enough to be meaningful."
          />
        ) : search.isLoading || search.isFetching ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={c.text} />
            <Text style={[styles.loadingText, { color: c.textMuted }]}>Searching…</Text>
          </View>
        ) : search.isError ? (
          <ErrorBanner error={search.error} />
        ) : search.data && search.data.results.length === 0 ? (
          <EmptyHint
            icon="help-buoy-outline"
            title="Nothing matched"
            body="Try a different phrasing or fall back to Manual."
          />
        ) : search.data ? (
          <View style={{ gap: Spacing.sm }}>
            {search.data.results.map((r, idx) => (
              <Animated.View
                key={`${r.doi ?? r.title}-${idx}`}
                entering={FadeInUp.duration(180).delay(idx * 25)}
              >
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    setPicked(r);
                  }}
                  style={({ pressed }) => [
                    styles.resultCard,
                    {
                      backgroundColor: c.surface,
                      borderColor: c.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                    Shadows.sm,
                  ]}
                >
                  <Text
                    style={[styles.resultTitle, { color: c.text }]}
                    numberOfLines={2}
                  >
                    {r.title}
                  </Text>
                  {r.authors ? (
                    <Text
                      style={[styles.resultMeta, { color: c.textMuted }]}
                      numberOfLines={1}
                    >
                      {r.authors}
                    </Text>
                  ) : null}
                  <View style={styles.resultMetaRow}>
                    {r.container ? (
                      <Text
                        style={[styles.resultMetaSmall, { color: c.textMuted }]}
                        numberOfLines={1}
                      >
                        {r.container}
                      </Text>
                    ) : null}
                    {r.year != null ? (
                      <Text style={[styles.resultMetaSmall, { color: c.textMuted }]}>
                        {r.year}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ---------- Manual mode ----------

function ManualPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [doi, setDoi] = useState('');
  const [scholarUrl, setScholarUrl] = useState('');

  const canSave = title.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) {
      haptics.warn();
      return;
    }
    const paper: Paper = {
      title: title.trim(),
      authors: authors.trim() || null,
      year: year.match(/^\d{4}$/) ? Number(year) : null,
      doi: doi.trim() || null,
      container: null,
      scholar_url: scholarUrl.trim() || null,
      source: 'crossref', // closest fit; manual entries don't have a real source
    };
    commitPaper(paper, haptics);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.helperText, { color: c.textSubtle, marginBottom: Spacing.md }]}>
        For preprints, posters, grey literature — anything not in Crossref / OpenAlex.
      </Text>

      <ManualField label="Title (required)" value={title} onChangeText={setTitle} c={c} />
      <ManualField
        label="Authors"
        value={authors}
        onChangeText={setAuthors}
        placeholder="Lovelace A, Babbage C"
        c={c}
      />
      <ManualField
        label="Year"
        value={year}
        onChangeText={(v) => setYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
        placeholder="2026"
        keyboardType="number-pad"
        c={c}
      />
      <ManualField
        label="DOI"
        value={doi}
        onChangeText={setDoi}
        placeholder="10.1000/xyz123"
        autoCapitalize="none"
        c={c}
      />
      <ManualField
        label="Scholar URL"
        value={scholarUrl}
        onChangeText={setScholarUrl}
        placeholder="https://scholar.google.com/..."
        autoCapitalize="none"
        keyboardType="url"
        c={c}
      />

      <View style={{ height: Spacing.lg }} />
      <Button
        label="Add to collection"
        icon="add"
        onPress={handleAdd}
        disabled={!canSave}
      />
    </ScrollView>
  );
}

function ManualField({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
  c,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'number-pad' | 'url';
  c: (typeof Colors)['light'];
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={autoCapitalize !== 'none'}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.border },
        ]}
      />
    </View>
  );
}

function EmptyHint({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.emptyHint}>
      <Ionicons name={icon} size={28} color={c.textSubtle} style={{ marginBottom: Spacing.sm }} />
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: c.textMuted }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segmentRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  segmentLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },

  paneScroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
  paneBody: { marginTop: Spacing.lg },

  field: { marginBottom: Spacing.md },
  fieldLabel: {
    ...Type.eyebrow,
    marginBottom: Spacing.xs,
  },
  helperText: { fontSize: 12, marginTop: Spacing.xs, lineHeight: 16 },

  input: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },

  // Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  loadingText: { fontSize: 14 },

  // Preview
  previewCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewTitle: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  previewMeta: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  previewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
    marginTop: Spacing.sm,
  },
  previewMetaSmall: { fontSize: 12 },
  previewSourceTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    textTransform: 'uppercase',
  },
  previewDoi: { fontSize: 12, marginTop: Spacing.sm },

  // Result list
  resultCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resultTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  resultMeta: { fontSize: 13, marginTop: 4 },
  resultMetaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  resultMetaSmall: { fontSize: 12 },

  // Error banner
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorTitle: { fontSize: 14, fontWeight: '600' },
  errorBody: { fontSize: 13, marginTop: 2, lineHeight: 18 },

  // Empty state
  emptyHint: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  emptyTitle: { fontSize: 14, fontWeight: '600' },
  emptyBody: { fontSize: 13, marginTop: 4, textAlign: 'center', lineHeight: 18 },
});
