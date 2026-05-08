/**
 * Add-item modal. Top-level kind picker: Paper / Repo / Link.
 *
 *   Paper -- three sub-modes: DOI, Search, Manual (original flow)
 *   Repo  -- paste a GitHub URL, fetch metadata, edit, add
 *   Link  -- manual form: URL, title, description, image
 *
 * On confirm we drop the chosen item into a module-level outbox
 * (`setPendingItem`) and pop the modal -- the share editor picks it up via a
 * subscribe-on-mount listener. See `lib/pending-item.ts`.
 *
 * Lives at the root Stack level as a modal (`app/add-item.tsx`) so the
 * share editor stays mounted underneath and retains form state.
 */

import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
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
import { api, ApiError } from '@/lib/api';
import {
  PDF_COPYRIGHT_LABEL,
  PDF_TOO_LARGE_MSG,
  PDF_TRUST_NOTE,
} from '@/lib/pdf-copy';
import {
  formatFileSize,
  PDF_MAX_BYTES,
  runPdfUpload,
  type UploadHandle,
  type UploadProgress,
} from '@/lib/pdf-upload';
import { setPendingItem, type PendingItem } from '@/lib/pending-item';
import {
  clearPendingShareDraft,
  peekPendingShareDraft,
  setShareCreatedFromDraft,
} from '@/lib/pending-share-draft';
import type { Paper, PaperSearchResult } from '@/types/paper';
import type { ShareResponse } from '@/types/share';

// =========================================================================
// Top-level kind picker
// =========================================================================

type ItemKind = 'paper' | 'repo' | 'link' | 'pdf';
const KINDS: { id: ItemKind; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'repo', label: 'Repo' },
  { id: 'link', label: 'Link' },
  { id: 'pdf', label: 'PDF' },
];

type PaperMode = 'doi' | 'search' | 'manual';
const PAPER_MODES: { id: PaperMode; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'search', label: 'Search' },
  { id: 'manual', label: 'Manual' },
];

const DEBOUNCE_MS = 300;

export default function AddItemScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  // Optional `shareId` query param — only set when the modal was opened from
  // an existing share (not when creating). Required for PDF uploads (the
  // R2 presign endpoint is share-scoped); the PDF pane gates on it.
  const { shareId: shareIdParam } = useLocalSearchParams<{ shareId?: string }>();
  const shareId = typeof shareIdParam === 'string' && shareIdParam.length > 0 ? shareIdParam : null;

  const [kind, setKind] = useState<ItemKind>('paper');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: 'Add item',
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingRight: Spacing.sm })}
            >
              <Ionicons name="close" size={24} color={c.text} />
            </Pressable>
          ),
        }}
      />

      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        {/* Top-level kind picker */}
        <View style={styles.kindRow}>
          {KINDS.map((k) => {
            const active = kind === k.id;
            return (
              <Pressable
                key={k.id}
                onPress={() => {
                  haptics.selection();
                  setKind(k.id);
                }}
                style={({ pressed }) => [
                  styles.kindPill,
                  {
                    backgroundColor: active ? c.text : c.surface,
                    borderColor: active ? c.text : c.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kindPillLabel,
                    { color: active ? c.background : c.text },
                  ]}
                >
                  {k.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {kind === 'paper' ? <PaperKindPane /> : null}
        {kind === 'repo' ? <RepoKindPane /> : null}
        {kind === 'link' ? <LinkKindPane /> : null}
        {kind === 'pdf' ? <PdfKindPane shareId={shareId} /> : null}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

// =========================================================================
// Paper kind (existing DOI / Search / Manual)
// =========================================================================

function PaperKindPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [mode, setMode] = useState<PaperMode>('doi');

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.segmentRow}>
        {PAPER_MODES.map((m) => {
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
    </View>
  );
}

// ---------- shared pieces ----------

function PaperPreview({
  paper,
  onAdd,
  busy,
  added,
}: {
  paper: Paper;
  onAdd: () => void;
  busy?: boolean;
  added?: boolean;
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
      <Button
        label={added ? 'Added!' : 'Add to share'}
        icon={added ? 'checkmark' : 'add'}
        onPress={onAdd}
        loading={busy}
        disabled={added}
      />
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
        body: "Crossref doesn't know that DOI. Double-check it, or fall back to Manual.",
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

function commitPaper(paper: Paper, haptics: ReturnType<typeof useHaptics>): void {
  haptics.success();
  setPendingItem({ kind: 'paper', paper });
}

function commitPaperAndNav(paper: Paper, haptics: ReturnType<typeof useHaptics>): void {
  haptics.success();
  setPendingItem({ kind: 'paper', paper });
  router.back();
}

function commitItem(item: PendingItem, haptics: ReturnType<typeof useHaptics>): void {
  haptics.success();
  setPendingItem(item);
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
            body="As soon as we recognise one, we'll fetch the metadata."
          />
        ) : lookup.isLoading || lookup.isFetching ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={c.text} />
            <Text style={[styles.loadingText, { color: c.textMuted }]}>
              Looking up {parsedDoi}...
            </Text>
          </View>
        ) : lookup.isError ? (
          <ErrorBanner error={lookup.error} />
        ) : lookup.data ? (
          <PaperPreview paper={lookup.data} onAdd={() => commitPaperAndNav(lookup.data!, haptics)} />
        ) : null}
      </View>
    </ScrollView>
  );
}

// ---------- Search mode ----------

/** Format a publication date nicely: "15 Jun 2023" or fall back to year. */
function formatPubDate(dateStr: string | null | undefined, year: number | null): string | null {
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch {
      // fall through
    }
  }
  return year != null ? String(year) : null;
}

/** OA status colour -- green for gold/green, bronze tint for bronze, grey fallback. */
function oaColor(status: string | null): string {
  switch (status) {
    case 'gold':
      return '#D4A017';
    case 'green':
      return '#2F7D52';
    case 'bronze':
      return '#B87333';
    case 'hybrid':
      return '#4A90D9';
    default:
      return '#2F7D52';
  }
}

function SearchResultCard({
  result,
  onPick,
  c,
}: {
  result: PaperSearchResult;
  onPick: () => void;
  c: (typeof Colors)['light'];
}) {
  const dateLabel = formatPubDate(result.publication_date, result.year);

  return (
    <Pressable
      onPress={onPick}
      style={({ pressed }) => [
        styles.resultCard,
        {
          backgroundColor: c.surface,
          borderColor: result.is_retracted ? '#D32F2F' : c.border,
          borderWidth: result.is_retracted ? 1.5 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.85 : 1,
        },
        Shadows.sm,
      ]}
    >
      {/* Retraction warning */}
      {result.is_retracted ? (
        <View style={styles.retractionBanner}>
          <Ionicons name="warning" size={14} color="#FFFFFF" />
          <Text style={styles.retractionText}>Retracted</Text>
        </View>
      ) : null}

      {/* Title */}
      <Text
        style={[styles.resultTitle, { color: c.text }]}
        numberOfLines={2}
      >
        {result.title}
      </Text>

      {/* Authors */}
      {result.authors ? (
        <Text
          style={[styles.resultMeta, { color: c.textMuted }]}
          numberOfLines={1}
        >
          {result.authors}
        </Text>
      ) : null}

      {/* Badge row: OA, type, citations, PDF */}
      <View style={styles.badgeRow}>
        {result.open_access?.is_oa ? (
          <View style={[styles.badge, { backgroundColor: oaColor(result.open_access.oa_status) + '20' }]}>
            <Ionicons name="lock-open-outline" size={10} color={oaColor(result.open_access.oa_status)} />
            <Text style={[styles.badgeText, { color: oaColor(result.open_access.oa_status) }]}>
              OA{result.open_access.oa_status ? ` \u00b7 ${result.open_access.oa_status}` : ''}
            </Text>
          </View>
        ) : null}

        {result.type ? (
          <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
            <Text style={[styles.badgeText, { color: c.accentText }]}>
              {result.type.replace(/-/g, ' ')}
            </Text>
          </View>
        ) : null}

        {result.cited_by_count > 0 ? (
          <View style={styles.citationChip}>
            <Ionicons name="chatbubble-outline" size={10} color={c.textMuted} />
            <Text style={[styles.citationText, { color: c.textMuted }]}>
              {result.cited_by_count.toLocaleString()} citation{result.cited_by_count === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}

        {result.pdf_url ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              Linking.openURL(result.pdf_url!);
            }}
            hitSlop={4}
            style={({ pressed }) => [
              styles.badge,
              { backgroundColor: '#D32F2F18', opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="document-text-outline" size={10} color="#D32F2F" />
            <Text style={[styles.badgeText, { color: '#D32F2F' }]}>PDF</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Keywords */}
      {result.keywords && result.keywords.length > 0 ? (
        <View style={styles.keywordRow}>
          {result.keywords.slice(0, 4).map((kw) => (
            <View key={kw} style={[styles.keywordChip, { backgroundColor: c.surfaceSunken }]}>
              <Text style={[styles.keywordText, { color: c.textMuted }]} numberOfLines={1}>
                {kw}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Bottom meta row: container, date */}
      <View style={styles.resultMetaRow}>
        {result.container ? (
          <Text
            style={[styles.resultMetaSmall, { color: c.textMuted, flex: 1 }]}
            numberOfLines={1}
          >
            {result.container}
          </Text>
        ) : null}
        {dateLabel ? (
          <Text style={[styles.resultMetaSmall, { color: c.textMuted }]}>
            {dateLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SearchPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<PaperSearchResult | null>(null);
  const [added, setAdded] = useState(false);

  const debounced = useDebouncedValue(input, DEBOUNCE_MS);
  const search = useSearchPapers(debounced);

  // Reset picked when the user types again -- they're refining the search.
  useEffect(() => {
    setPicked(null);
    setAdded(false);
  }, [debounced]);

  const handleAdd = useCallback(() => {
    if (!picked || added) return;
    commitPaper(picked, haptics);
    setAdded(true);
    // Brief success flash, then navigate back
    setTimeout(() => router.back(), 500);
  }, [picked, added, haptics]);

  const trimmed = input.trim();

  // Build the body content depending on state
  const renderBody = () => {
    if (picked) {
      return (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.paneBody}>
            <PaperPreview paper={picked} onAdd={handleAdd} added={added} />
          </View>
        </ScrollView>
      );
    }
    if (trimmed.length < 3) {
      return (
        <View style={[styles.paneBody, { paddingHorizontal: Spacing.lg }]}>
          <EmptyHint
            icon="search-outline"
            title="Type at least 3 characters"
            body="Search runs as soon as you've typed enough to be meaningful."
          />
        </View>
      );
    }
    if (search.isLoading || search.isFetching) {
      return (
        <View style={[styles.paneBody, { paddingHorizontal: Spacing.lg }]}>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={c.text} />
            <Text style={[styles.loadingText, { color: c.textMuted }]}>Searching...</Text>
          </View>
        </View>
      );
    }
    if (search.isError) {
      return (
        <View style={[styles.paneBody, { paddingHorizontal: Spacing.lg }]}>
          <ErrorBanner error={search.error} />
        </View>
      );
    }
    if (search.data && search.data.results.length === 0) {
      return (
        <View style={[styles.paneBody, { paddingHorizontal: Spacing.lg }]}>
          <EmptyHint
            icon="help-buoy-outline"
            title="Nothing matched"
            body="Try a different phrasing or fall back to Manual."
          />
        </View>
      );
    }
    if (search.data) {
      return (
        <FlatList
          data={search.data.results}
          keyExtractor={(r, idx) => `${r.doi ?? r.title}-${idx}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingTop: Spacing.lg,
            paddingBottom: Spacing.xxl,
            gap: Spacing.sm,
          }}
          renderItem={({ item }) => (
            <SearchResultCard
              result={item}
              onPick={() => {
                haptics.tap();
                setPicked(item);
              }}
              c={c}
            />
          )}
        />
      );
    }
    return null;
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Pinned search input */}
      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm }}>
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
      </View>

      {/* Scrollable results */}
      {renderBody()}
    </View>
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
    commitPaperAndNav(paper, haptics);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.helperText, { color: c.textSubtle, marginBottom: Spacing.md }]}>
        For preprints, posters, grey literature -- anything not in Crossref / OpenAlex.
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
        label="Add to share"
        icon="add"
        onPress={handleAdd}
        disabled={!canSave}
      />
    </ScrollView>
  );
}

// =========================================================================
// Repo kind
// =========================================================================

/** Parse a GitHub URL into owner/repo. Returns null for non-GitHub URLs. */
function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
  if (!owner || !repo) return null;

  return { owner, repo };
}

interface RepoInfo {
  fullName: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  language: string | null;
  license: string | null;
  avatarUrl: string | null;
}

function RepoKindPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable buffer the user can tweak before saving.
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [url, setUrl] = useState('');

  const handleFetch = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const parsed = parseGithubUrl(trimmed);
    if (!parsed) {
      setError("That doesn't look like a GitHub repo URL.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
      const res = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'MyEtAl-Mobile/0.1',
        },
      });

      if (!res.ok) {
        if (res.status === 404) {
          setError("GitHub doesn't know that repo, or it's private.");
        } else if (res.status === 403) {
          setError('Rate limited by GitHub. Wait a minute and try again.');
        } else {
          setError('Lookup failed. Try again, or fill the fields manually.');
        }
        return;
      }

      const data = await res.json() as Record<string, unknown>;
      const repoInfo: RepoInfo = {
        fullName: (typeof data.full_name === 'string' ? data.full_name : `${parsed.owner}/${parsed.repo}`),
        description: typeof data.description === 'string' ? data.description : null,
        htmlUrl: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${parsed.owner}/${parsed.repo}`,
        stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : 0,
        language: typeof data.language === 'string' ? data.language : null,
        license: (() => {
          const lic = data.license as Record<string, unknown> | null | undefined;
          if (!lic) return null;
          if (typeof lic.spdx_id === 'string' && lic.spdx_id.length > 0) return lic.spdx_id;
          if (typeof lic.name === 'string' && lic.name.length > 0) return lic.name;
          return null;
        })(),
        avatarUrl: (() => {
          const owner = data.owner as Record<string, unknown> | null | undefined;
          if (!owner) return null;
          return typeof owner.avatar_url === 'string' ? owner.avatar_url : null;
        })(),
      };

      setInfo(repoInfo);
      setTitle(repoInfo.fullName);
      setSubtitle(repoInfo.description ?? '');
      setImageUrl(repoInfo.avatarUrl ?? '');
      setUrl(repoInfo.htmlUrl);
    } catch {
      setError('Network blip. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const canSave = title.trim().length > 0 && url.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) {
      haptics.warn();
      return;
    }
    commitItem(
      {
        kind: 'repo',
        url: url.trim(),
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        image_url: imageUrl.trim() || null,
      },
      haptics,
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>GitHub URL</Text>
      <View style={styles.fetchRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="https://github.com/owner/repo"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleFetch}
          style={[
            styles.input,
            {
              flex: 1,
              color: c.text,
              backgroundColor: c.surface,
              borderColor: c.border,
            },
          ]}
        />
        <Pressable
          onPress={handleFetch}
          disabled={loading || !input.trim()}
          style={({ pressed }) => [
            styles.fetchBtn,
            {
              backgroundColor: c.text,
              opacity: loading || !input.trim() ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={c.background} />
          ) : (
            <Text style={[styles.fetchBtnLabel, { color: c.background }]}>Fetch</Text>
          )}
        </Pressable>
      </View>
      <Text style={[styles.helperText, { color: c.textSubtle }]}>
        We pull the description, stars, language, and license from GitHub.
      </Text>

      {error ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={[styles.errorCard, { backgroundColor: c.surfaceSunken, borderColor: c.border, marginTop: Spacing.md }]}
        >
          <Ionicons name="alert-circle-outline" size={22} color={c.text} style={{ marginRight: Spacing.sm }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.errorTitle, { color: c.text }]}>Couldn&apos;t fetch</Text>
            <Text style={[styles.errorBody, { color: c.textMuted }]}>{error}</Text>
          </View>
        </Animated.View>
      ) : null}

      {info || title || url ? (
        <Animated.View
          entering={FadeInUp.duration(220)}
          style={[styles.repoPreviewCard, { backgroundColor: c.surface, borderColor: c.border, marginTop: Spacing.lg }, Shadows.sm]}
        >
          {info ? (
            <View style={styles.repoMetaRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.previewTitle, { color: c.text }]} numberOfLines={1}>
                  {info.fullName}
                </Text>
                <Text style={[styles.previewMeta, { color: c.textMuted }]} numberOfLines={1}>
                  {'★ ' + info.stars.toLocaleString()}
                  {info.language ? ` \u00b7 ${info.language}` : ''}
                  {info.license ? ` \u00b7 ${info.license}` : ''}
                </Text>
              </View>
            </View>
          ) : null}

          <ManualField label="Title" value={title} onChangeText={setTitle} c={c} />
          <ManualField label="Description" value={subtitle} onChangeText={setSubtitle} c={c} placeholder="Optional" />
          <ManualField label="URL" value={url} onChangeText={setUrl} c={c} placeholder="https://github.com/owner/repo" autoCapitalize="none" keyboardType="url" />
          <ManualField label="Image URL" value={imageUrl} onChangeText={setImageUrl} c={c} placeholder="https://avatars.githubusercontent.com/..." autoCapitalize="none" keyboardType="url" />

          <View style={{ height: Spacing.sm }} />
          <Button label="Add to share" icon="add" onPress={handleAdd} disabled={!canSave} />
        </Animated.View>
      ) : (
        <View style={styles.paneBody}>
          <EmptyHint
            icon="logo-github"
            title="Paste a GitHub repo URL"
            body="We'll fetch the description and metadata."
          />
        </View>
      )}
    </ScrollView>
  );
}

// =========================================================================
// Link kind
// =========================================================================

function LinkKindPane() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const canSave = url.trim().length > 0 && title.trim().length > 0;

  const handleAdd = () => {
    if (!canSave) {
      haptics.warn();
      return;
    }
    commitItem(
      {
        kind: 'link',
        url: url.trim(),
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        image_url: imageUrl.trim() || null,
      },
      haptics,
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.helperText, { color: c.textSubtle, marginBottom: Spacing.md }]}>
        For blog posts, slides, lab pages, datasets -- anything with a URL.
      </Text>

      <ManualField
        label="URL (required)"
        value={url}
        onChangeText={setUrl}
        placeholder="https://..."
        autoCapitalize="none"
        keyboardType="url"
        c={c}
      />
      <ManualField
        label="Title (required)"
        value={title}
        onChangeText={setTitle}
        c={c}
      />
      <ManualField
        label="Description"
        value={subtitle}
        onChangeText={setSubtitle}
        placeholder="Optional one-liner"
        c={c}
      />
      <ManualField
        label="Image URL"
        value={imageUrl}
        onChangeText={setImageUrl}
        placeholder="https://..."
        autoCapitalize="none"
        keyboardType="url"
        c={c}
      />

      <View style={{ height: Spacing.lg }} />
      <Button
        label="Add to share"
        icon="add"
        onPress={handleAdd}
        disabled={!canSave}
      />
    </ScrollView>
  );
}

// =========================================================================
// PDF kind (PR-C — file picker → R2 presigned upload → record)
// =========================================================================

interface PickedDoc {
  uri: string;
  name: string;
  size: number;
  mimeType: string | null;
}

/**
 * Default-title heuristic. Filenames like `final_v3_Smith_2024.pdf` are
 * almost always file-system clutter, not the public-facing title — return
 * '' for those so the placeholder kicks in. Mirrors web (M2).
 */
function deriveDefaultTitle(filename: string): string {
  const stripped = filename.replace(/\.pdf$/i, '');
  const isJunky =
    /_v\d+/i.test(stripped) ||
    /\b(final|draft|copy)\b/i.test(stripped);
  return isJunky ? '' : stripped;
}

function PdfKindPane({ shareId: initialShareId }: { shareId: string | null }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();

  // Local copy of shareId so we can flip from null → newly-created-id once
  // the auto-save POST /shares completes (M1). The route param is updated
  // alongside via router.setParams so a re-render of the modal observes the
  // same value.
  const [shareId, setShareId] = useState<string | null>(initialShareId);

  // Auto-save lifecycle for the "open PDF tab from a brand-new share" path.
  // 'idle' before the user opens the tab; 'saving' while the POST is in
  // flight; 'error' if it failed (with a Retry button); once we have a
  // shareId we render the picker normally.
  type DraftSaveState =
    | { status: 'idle' }
    | { status: 'saving' }
    | { status: 'error'; message: string };
  const [draftSave, setDraftSave] = useState<DraftSaveState>({ status: 'idle' });

  const [picked, setPicked] = useState<PickedDoc | null>(null);
  const [title, setTitle] = useState('');
  const [copyrightAck, setCopyrightAck] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>({ status: 'idle' });
  const handleRef = useRef<UploadHandle | null>(null);

  // Local validation: file size (mirrors the server-enforced 25 MB cap).
  const sizeError =
    picked && picked.size > PDF_MAX_BYTES ? PDF_TOO_LARGE_MSG(picked.size) : null;

  const titleError =
    picked && title.trim().length === 0 ? 'Add a title.' : null;

  const canUpload =
    Boolean(picked) &&
    !sizeError &&
    !titleError &&
    copyrightAck &&
    progress.status !== 'uploading' &&
    progress.status !== 'requesting-presign' &&
    progress.status !== 'recording';

  const isBusy =
    progress.status === 'uploading' ||
    progress.status === 'requesting-presign' ||
    progress.status === 'recording';

  // Pick a PDF. expo-document-picker's iOS UTI for PDF is `com.adobe.pdf`;
  // Android uses the MIME `application/pdf`. The picker library accepts the
  // MIME on both platforms (it handles the iOS UTI translation internally).
  const handlePick = async () => {
    haptics.tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;

      const next: PickedDoc = {
        uri: asset.uri,
        name: asset.name,
        // Some platforms occasionally return null/undefined size for
        // cloud-provider URIs; default to 0 and let the pre-upload guard
        // catch it (size ≤ 25 MB always passes for 0, but the server-side
        // recheck rejects empty files at record time).
        size: typeof asset.size === 'number' ? asset.size : 0,
        mimeType: asset.mimeType ?? null,
      };
      setPicked(next);
      // M2: heuristic skips junky filenames like `final_v3_Smith_2024.pdf`.
      // When it returns '' the placeholder takes over and the user is
      // gently nudged to type a public-facing title.
      setTitle((prev) => {
        if (prev.trim()) return prev;
        const heuristic = deriveDefaultTitle(next.name);
        return heuristic || '';
      });
      // Reset upload state if the user re-picks after a previous failure.
      setProgress({ status: 'idle' });
    } catch (err) {
      setProgress({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not open the picker',
      });
    }
  };

  const handleRemove = () => {
    haptics.tap();
    setPicked(null);
    setTitle('');
    setCopyrightAck(false);
    setProgress({ status: 'idle' });
  };

  const handleUpload = async () => {
    if (!shareId || !picked || !canUpload) return;
    haptics.tap();
    setProgress({ status: 'requesting-presign' });

    const { promise, handle } = runPdfUpload({
      shareId,
      fileUri: picked.uri,
      filename: picked.name,
      sizeBytes: picked.size,
      title: title.trim(),
      onProgress: (p) => setProgress(p),
    });
    handleRef.current = handle;

    const final = await promise;
    handleRef.current = null;

    if (final.status === 'done' && final.item) {
      haptics.success();
      // Hand the new item off via the same outbox the URL/DOI flows use,
      // then dismiss back to the editor.
      setPendingItem({ kind: 'pdf', item: final.item });
      router.back();
    } else if (final.status === 'error') {
      haptics.warn();
      // State already set by the runPdfUpload progress callback — keep the
      // picked file so the user can retry without re-picking (M6).
    }
  };

  const handleCancel = async () => {
    haptics.tap();
    await handleRef.current?.cancel();
    handleRef.current = null;
    // Cancel may not fully short-circuit a background iOS upload, but flip
    // local state so the UI unblocks immediately.
    setProgress({ status: 'idle' });
  };

  // M1: auto-save the editor's draft when the user opens the PDF tab from a
  // brand-new share. Backend now allows empty `items: []` so we can POST the
  // current draft (name/description/type/tags) immediately and reuse the new
  // shareId for presign. We only fire once per modal lifetime.
  const autoSaveAttemptedRef = useRef(false);

  const runAutoSave = useCallback(async () => {
    autoSaveAttemptedRef.current = true;
    const draft = peekPendingShareDraft();
    if (!draft) {
      // No draft staged — fall back to a minimally-valid skeleton so the
      // POST still succeeds. The editor will replace these fields on the
      // user's next save anyway.
      setDraftSave({
        status: 'error',
        message: "Couldn't start your share — try again",
      });
      return;
    }
    setDraftSave({ status: 'saving' });
    try {
      const created = await api<ShareResponse>('/shares', {
        method: 'POST',
        json: draft,
      });
      // Tell the editor about the new share so it can router.replace from
      // /share/new → /share/{id} when the modal closes.
      setShareCreatedFromDraft(created);
      clearPendingShareDraft();
      // Flip the route param so a remount of this modal sees the new id.
      try {
        router.setParams({ shareId: created.id });
      } catch {
        // setParams is best-effort; local state is the source of truth.
      }
      setShareId(created.id);
      setDraftSave({ status: 'idle' });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.detail
          : "Couldn't start your share — try again";
      setDraftSave({ status: 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    if (shareId) return;
    if (autoSaveAttemptedRef.current) return;
    void runAutoSave();
  }, [shareId, runAutoSave]);

  // Until we have a shareId, render the auto-save status — picker stays
  // hidden so the user can't pick a file before we have somewhere to put it.
  if (!shareId) {
    return (
      <ScrollView
        contentContainerStyle={styles.paneScroll}
        keyboardShouldPersistTaps="handled"
      >
        {draftSave.status === 'error' ? (
          <View style={styles.paneBody}>
            <View
              style={[
                styles.errorCard,
                { backgroundColor: c.surfaceSunken, borderColor: c.border },
              ]}
            >
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color={c.text}
                style={{ marginRight: Spacing.sm }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.errorTitle, { color: c.text }]}>
                  Couldn&apos;t start your share — try again
                </Text>
                <Text style={[styles.errorBody, { color: c.textMuted }]}>
                  {draftSave.message}
                </Text>
              </View>
            </View>
            <View style={{ height: Spacing.md }} />
            <Button
              label="Retry"
              icon="refresh"
              onPress={() => {
                autoSaveAttemptedRef.current = false;
                void runAutoSave();
              }}
            />
          </View>
        ) : (
          <View style={styles.paneBody}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color={c.text} />
              <Text style={[styles.loadingText, { color: c.textMuted }]}>
                Saving draft…
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.paneScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.helperText, { color: c.textSubtle, marginBottom: Spacing.md }]}>
        Upload a poster, slide deck, or paper PDF — anything up to 25 MB.
      </Text>
      {!picked ? (
        <Text style={[styles.helperText, { color: c.textSubtle, marginBottom: Spacing.md }]}>
          {PDF_TRUST_NOTE}
        </Text>
      ) : null}

      {!picked ? (
        <Pressable
          onPress={handlePick}
          style={({ pressed }) => [
            styles.pdfPickCard,
            {
              borderColor: c.border,
              backgroundColor: c.surfaceSunken,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="cloud-upload-outline" size={32} color={c.text} />
          <Text style={[styles.pdfPickTitle, { color: c.text }]}>Choose a PDF</Text>
          <Text style={[styles.pdfPickHint, { color: c.textMuted }]}>
            Up to 25 MB. PDF only.
          </Text>
        </Pressable>
      ) : (
        <Animated.View
          entering={FadeInUp.duration(180)}
          style={[
            styles.pdfFileCard,
            { backgroundColor: c.surface, borderColor: c.border },
            Shadows.sm,
          ]}
        >
          <View style={styles.pdfFileRow}>
            <View style={[styles.pdfFileIcon, { backgroundColor: c.surfaceSunken }]}>
              <Ionicons name="document-text" size={20} color={c.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pdfFileName, { color: c.text }]} numberOfLines={1}>
                {picked.name}
              </Text>
              <Text style={[styles.pdfFileMeta, { color: c.textMuted }]}>
                {picked.size > 0 ? formatFileSize(picked.size) : 'Size unknown'}
              </Text>
            </View>
            <Pressable
              onPress={handleRemove}
              hitSlop={8}
              disabled={isBusy}
              style={({ pressed }) => ({
                opacity: isBusy ? 0.4 : pressed ? 0.6 : 1,
                padding: 4,
              })}
              accessibilityLabel="Remove file"
            >
              <Ionicons name="close-circle" size={22} color={c.textMuted} />
            </Pressable>
          </View>

          {sizeError ? (
            <Text style={[styles.pdfInlineError, { color: '#B00020' }]}>
              {sizeError}
            </Text>
          ) : null}
        </Animated.View>
      )}

      {picked && !sizeError ? (
        <>
          <View style={[styles.field, { marginTop: Spacing.md }]}>
            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={
                picked && deriveDefaultTitle(picked.name) === ''
                  ? 'e.g. Smith et al. 2024 — ICML poster'
                  : "Title as it'll appear on the share"
              }
              placeholderTextColor={c.textMuted}
              editable={!isBusy}
              maxLength={500}
              style={[
                styles.input,
                {
                  color: c.text,
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  opacity: isBusy ? 0.6 : 1,
                },
              ]}
            />
          </View>

          {/* Copyright acknowledgement — gates the upload button. */}
          <Pressable
            onPress={() => {
              if (isBusy) return;
              haptics.selection();
              setCopyrightAck((v) => !v);
            }}
            style={({ pressed }) => [
              styles.copyrightRow,
              {
                borderColor: copyrightAck ? c.text : c.border,
                backgroundColor: c.surface,
                opacity: pressed && !isBusy ? 0.85 : 1,
              },
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: copyrightAck, disabled: isBusy }}
          >
            <View
              style={[
                styles.copyrightCheckbox,
                {
                  backgroundColor: copyrightAck ? c.text : 'transparent',
                  borderColor: copyrightAck ? c.text : c.border,
                },
              ]}
            >
              {copyrightAck ? (
                <Ionicons name="checkmark" size={14} color={c.background} />
              ) : null}
            </View>
            <Text style={[styles.copyrightLabel, { color: c.text }]}>
              {PDF_COPYRIGHT_LABEL}
            </Text>
          </Pressable>
        </>
      ) : null}

      {/* Progress / status. The state machine: idle → requesting-presign →
          uploading → recording → done | error. We render a single inline
          card and swap the contents based on status — keeps the layout
          stable so the upload button doesn't jump around. */}
      {progress.status !== 'idle' && progress.status !== 'done' ? (
        <View
          style={[
            styles.progressCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {progress.status === 'requesting-presign' ? (
            <View style={styles.progressRow}>
              <ActivityIndicator color={c.text} />
              <Text style={[styles.progressText, { color: c.textMuted }]}>
                Preparing upload…
              </Text>
            </View>
          ) : null}

          {progress.status === 'uploading' ? (
            <>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressText, { color: c.text }]}>
                  Uploading {Math.round((progress.uploadFraction ?? 0) * 100)}%
                </Text>
                <Pressable onPress={handleCancel} hitSlop={8}>
                  <Text style={[styles.progressCancel, { color: c.textMuted }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: c.surfaceSunken }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: c.text,
                      width: `${Math.round((progress.uploadFraction ?? 0) * 100)}%`,
                    },
                  ]}
                />
              </View>
              {progress.bytesSent != null && progress.bytesTotal ? (
                <Text style={[styles.progressBytes, { color: c.textSubtle }]}>
                  {formatFileSize(progress.bytesSent)} of {formatFileSize(progress.bytesTotal)}
                </Text>
              ) : null}
            </>
          ) : null}

          {progress.status === 'recording' ? (
            <View style={styles.progressRow}>
              <ActivityIndicator color={c.text} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.progressText, { color: c.text }]}>
                  Finishing up…
                </Text>
                <Text style={[styles.progressBytes, { color: c.textSubtle }]}>
                  (this can take a few seconds)
                </Text>
              </View>
            </View>
          ) : null}

          {progress.status === 'error' ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Ionicons
                name="alert-circle-outline"
                size={20}
                color="#B00020"
                style={{ marginRight: Spacing.sm }}
              />
              <Text style={[styles.progressText, { color: '#B00020', flex: 1 }]}>
                {progress.error ?? 'Upload failed'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ height: Spacing.md }} />
      <Button
        label={progress.status === 'error' ? 'Try again' : 'Upload PDF'}
        icon="cloud-upload"
        onPress={handleUpload}
        disabled={!canUpload}
        loading={isBusy}
      />
    </ScrollView>
  );
}

// =========================================================================
// Shared components
// =========================================================================

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

// =========================================================================
// Styles
// =========================================================================

const styles = StyleSheet.create({
  // Top-level kind picker
  kindRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  kindPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  kindPillLabel: { fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },

  // Paper sub-mode segmented control
  segmentRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  segmentLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },

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

  // Fetch row (repo)
  fetchRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  fetchBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  fetchBtnLabel: {
    fontSize: 14,
    fontWeight: '600',
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

  // Repo preview card
  repoPreviewCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  repoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },

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
    marginTop: 6,
    alignItems: 'center',
  },
  resultMetaSmall: { fontSize: 12 },

  // Retraction banner
  retractionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D32F2F',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
    alignSelf: 'flex-start',
  },
  retractionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Badges (OA, type, PDF)
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  citationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  citationText: {
    fontSize: 10,
    fontWeight: '500',
  },

  // Keyword chips
  keywordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  keywordChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  keywordText: {
    fontSize: 10,
    fontWeight: '500',
  },

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

  // PDF pane (PR-C)
  pdfPickCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  pdfPickTitle: { fontSize: 15, fontWeight: '600' },
  pdfPickHint: { fontSize: 12 },
  pdfFileCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pdfFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pdfFileIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfFileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  pdfFileMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  pdfInlineError: {
    fontSize: 13,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  copyrightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.md,
  },
  copyrightCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyrightLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  progressCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  progressText: { fontSize: 13, fontWeight: '500' },
  progressCancel: { fontSize: 13, fontWeight: '600' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressBytes: {
    fontSize: 11,
    marginTop: Spacing.xs,
    fontVariant: ['tabular-nums'] as const,
  },
});
