import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { QrModal } from '@/components/qr-modal';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useCreateShare,
  useDeleteShare,
  usePublishShare,
  useShare,
  useShareAnalytics,
  useUnpublishShare,
  useUpdateShare,
} from '@/hooks/useShares';
import { ApiError } from '@/lib/api';
import {
  consumePendingPaper,
  subscribePendingPaper,
} from '@/lib/pending-paper';
import type { Paper } from '@/types/paper';
import type {
  ShareCreateInput,
  ShareItemInput,
  ShareItemKind,
  ShareResponse,
  ShareType,
} from '@/types/share';

const SHARE_TYPES: ShareType[] = ['paper', 'collection', 'poster', 'grant', 'project'];

const itemSchema = z.object({
  kind: z.enum(['paper', 'repo', 'link']).optional(),
  title: z.string().trim().min(1, 'Item title required').max(500),
  scholar_url: z.string().trim().url('Invalid URL').max(2000).optional().or(z.literal('')),
  doi: z.string().trim().max(255).optional().or(z.literal('')),
  authors: z.string().trim().optional().or(z.literal('')),
  year: z
    .union([z.string().regex(/^\d{4}$/, '4-digit year'), z.literal('')])
    .optional(),
  notes: z.string().trim().optional().or(z.literal('')),
  url: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
});

const shareSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(200),
  description: z.string().trim().optional().or(z.literal('')),
  type: z.enum(['paper', 'collection', 'poster', 'grant', 'project']),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
});

interface DraftItem {
  // Local-only key so reorders don't lose focus on the wrong row.
  _key: string;
  // Mobile editor v1 only creates 'paper' rows. Non-paper rows loaded from
  // the server are preserved verbatim so a Save round-trip doesn't drop
  // their kind-specific fields — they render read-only in the form.
  kind: ShareItemKind;
  title: string;
  scholar_url: string;
  doi: string;
  authors: string;
  year: string;
  notes: string;
  // Carried for non-paper kinds; ignored for 'paper'.
  url: string | null;
  subtitle: string | null;
  image_url: string | null;
}

let _itemKeySeed = 0;
const newKey = () => `item_${++_itemKeySeed}_${Date.now()}`;

const emptyItem = (): DraftItem => ({
  _key: newKey(),
  kind: 'paper',
  title: '',
  scholar_url: '',
  doi: '',
  authors: '',
  year: '',
  notes: '',
  url: null,
  subtitle: null,
  image_url: null,
});

const fromResponseItem = (it: ShareResponse['items'][number]): DraftItem => ({
  _key: newKey(),
  kind: it.kind ?? 'paper',
  title: it.title,
  scholar_url: it.scholar_url ?? '',
  doi: it.doi ?? '',
  authors: it.authors ?? '',
  year: it.year != null ? String(it.year) : '',
  notes: it.notes ?? '',
  url: it.url ?? null,
  subtitle: it.subtitle ?? null,
  image_url: it.image_url ?? null,
});

const fromPaper = (p: Paper): DraftItem => ({
  _key: newKey(),
  kind: 'paper',
  title: p.title,
  scholar_url: p.scholar_url ?? '',
  doi: p.doi ?? '',
  authors: p.authors ?? '',
  year: p.year != null ? String(p.year) : '',
  notes: '',
  url: null,
  subtitle: null,
  image_url: null,
});

/**
 * Create / edit share. `id === 'new'` puts the screen in create mode; any
 * other value loads the existing share. After save we surface the QR via the
 * shared <QrModal>.
 *
 * Form state is plain useState + zod (per the brief — no react-hook-form).
 * Items live in a local draft array so reorder/remove don't round-trip the
 * server until the user taps Save.
 */
export default function ShareEditorScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const existing = useShare(isNew ? undefined : id);
  const analytics = useShareAnalytics(isNew ? undefined : id);
  const createMutation = useCreateShare();
  const updateMutation = useUpdateShare(id ?? '');
  const deleteMutation = useDeleteShare();
  const publishMutation = usePublishShare(id ?? '');
  const unpublishMutation = useUnpublishShare(id ?? '');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shareType, setShareType] = useState<ShareType>('paper');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedShare, setSavedShare] = useState<ShareResponse | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Hydrate the form once the existing share loads.
  useEffect(() => {
    if (!existing.data) return;
    setName(existing.data.name);
    setDescription(existing.data.description ?? '');
    setShareType(existing.data.type);
    setPublishedAt(existing.data.published_at ?? null);
    setItems(
      existing.data.items.length
        ? existing.data.items.map(fromResponseItem)
        : [emptyItem()],
    );
  }, [existing.data]);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  };

  /**
   * Append a paper from the add-paper modal. If the only existing row is the
   * blank seed (no title typed), replace it — that keeps the count honest for
   * a fresh share where the user hadn't manually filled the empty row yet.
   */
  const appendPaper = (paper: Paper) => {
    setItems((prev) => {
      const draft = fromPaper(paper);
      const onlySeedRow =
        prev.length === 1 &&
        !prev[0].title.trim() &&
        !prev[0].doi.trim() &&
        !prev[0].scholar_url.trim() &&
        !prev[0].authors.trim();
      return onlySeedRow ? [draft] : [...prev, draft];
    });
  };

  // Pick up papers handed off by the add-paper modal. Both the immediate sync
  // (subscribe fires before back-nav settles) and the focus-time consume cover
  // the case where the screen unmounts/remounts during the modal lifecycle.
  useEffect(() => {
    const queued = consumePendingPaper();
    if (queued) appendPaper(queued);
    return subscribePendingPaper((p) => appendPaper(p));
  }, []);

  const openAddPaper = () => {
    router.push('/(authed)/share/add-paper');
  };

  const removeItem = (key: string) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it._key !== key)));
  };

  const moveItem = (key: string, direction: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it._key === key);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);

    const parsed = shareSchema.safeParse({
      name,
      description,
      type: shareType,
      items,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    // Convert empty strings → null for the API. Non-paper kinds round-trip
    // their server-owned fields verbatim — the mobile editor doesn't expose
    // edit UI for them in v1.
    const apiItems: ShareItemInput[] = parsed.data.items.map((it) => ({
      kind: it.kind ?? 'paper',
      title: it.title,
      scholar_url: it.scholar_url ? it.scholar_url : null,
      doi: it.doi ? it.doi : null,
      authors: it.authors ? it.authors : null,
      year: it.year ? Number(it.year) : null,
      notes: it.notes ? it.notes : null,
      url: it.url ?? null,
      subtitle: it.subtitle ?? null,
      image_url: it.image_url ?? null,
    }));

    const payload: ShareCreateInput = {
      name: parsed.data.name,
      description: parsed.data.description ? parsed.data.description : null,
      type: parsed.data.type,
      items: apiItems,
    };

    setSubmitting(true);
    try {
      const saved = isNew
        ? await createMutation.mutateAsync(payload)
        : await updateMutation.mutateAsync(payload);
      setSavedShare(saved);
      setShowQr(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (!id || isNew) return;
    Alert.alert(
      'Delete share?',
      `"${name}" will be permanently removed. The QR code will stop working immediately. This cannot be undone.`,
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMutation.mutateAsync(id);
            router.back();
          } catch (err) {
            setError(err instanceof ApiError ? err.detail : 'Delete failed');
          }
        },
      },
    ]);
  };

  const closeQrAndExit = () => {
    setShowQr(false);
    router.back();
  };

  if (!isNew && existing.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (!isNew && existing.isError) {
    return (
      <View style={[styles.center, { backgroundColor: c.background, padding: Spacing.lg }]}>
        <Text style={[styles.errorTitle, { color: c.text }]}>Couldn&apos;t load share</Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.primary, { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.primaryText, { color: c.background }]}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: isNew ? 'New share' : 'Edit share',
          headerShown: true,
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />

      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: c.textMuted }]}>Name</Text>
              <Text style={[styles.charCount, { color: c.textSubtle }]}>
                {name.length}/200
              </Text>
            </View>
            <TextInput
              value={name}
              onChangeText={(v) => setName(v.slice(0, 200))}
              placeholder="e.g. My ASMS 2026 poster"
              placeholderTextColor={c.textMuted}
              maxLength={200}
              style={[
                styles.input,
                { color: c.text, borderColor: c.border, backgroundColor: c.surface },
              ]}
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Description (optional)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Briefly describe what people will find when they scan your QR code"
              placeholderTextColor={c.textMuted}
              multiline
              style={[
                styles.input,
                styles.multiline,
                { color: c.text, borderColor: c.border, backgroundColor: c.surface },
              ]}
            />
          </View>

          {/* Type */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Type</Text>
            <View style={styles.pillRow}>
              {SHARE_TYPES.map((t) => {
                const active = shareType === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setShareType(t)}
                    style={({ pressed }) => [
                      styles.pill,
                      {
                        borderColor: active ? c.text : c.border,
                        backgroundColor: active ? c.text : c.surface,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? c.background : c.text,
                        fontSize: 13,
                        fontWeight: '500',
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Publish to discovery toggle — only for existing shares */}
          {!isNew ? (
            <View style={[styles.field, styles.row]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.text }]}>
                  Publish to discovery
                </Text>
                <Text style={[styles.rowSub, { color: c.textMuted }]}>
                  Make this share discoverable in search, similar shares, and
                  trending.
                </Text>
              </View>
              <Switch
                value={publishedAt !== null}
                disabled={
                  publishMutation.isPending || unpublishMutation.isPending
                }
                onValueChange={async (value) => {
                  try {
                    if (value) {
                      const updated = await publishMutation.mutateAsync();
                      setPublishedAt(updated.published_at);
                    } else {
                      const updated = await unpublishMutation.mutateAsync();
                      setPublishedAt(updated.published_at);
                    }
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.detail
                        : 'Failed to update discovery status',
                    );
                  }
                }}
              />
            </View>
          ) : null}

          {/* Items */}
          <View style={styles.itemsHeader}>
            <View>
              <Text style={[styles.sectionLabel, { color: c.textMuted }]}>ITEMS</Text>
              <Text style={[styles.itemsCountHint, { color: c.textSubtle }]}>
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </Text>
            </View>
            <Pressable
              onPress={openAddPaper}
              hitSlop={8}
              style={({ pressed }) => [
                styles.addItemBtn,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="add" size={18} color={c.text} />
              <Text style={[styles.addText, { color: c.text }]}>Add paper</Text>
            </Pressable>
          </View>

          {items.map((it, idx) => (
            <View
              key={it._key}
              style={[styles.itemCard, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <View style={styles.itemHeader}>
                <Text style={[styles.itemIndex, { color: c.textMuted }]}>#{idx + 1}</Text>
                <View style={styles.itemHeaderActions}>
                  <Pressable
                    accessibilityLabel="Move up"
                    hitSlop={8}
                    disabled={idx === 0}
                    onPress={() => moveItem(it._key, -1)}
                    style={({ pressed }) => ({ opacity: idx === 0 ? 0.3 : pressed ? 0.6 : 1, padding: 4 })}
                  >
                    <Ionicons name="chevron-up" size={18} color={c.text} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Move down"
                    hitSlop={8}
                    disabled={idx === items.length - 1}
                    onPress={() => moveItem(it._key, 1)}
                    style={({ pressed }) => ({
                      opacity: idx === items.length - 1 ? 0.3 : pressed ? 0.6 : 1,
                      padding: 4,
                    })}
                  >
                    <Ionicons name="chevron-down" size={18} color={c.text} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Remove item"
                    hitSlop={8}
                    disabled={items.length === 1}
                    onPress={() => removeItem(it._key)}
                    style={({ pressed }) => ({
                      opacity: items.length === 1 ? 0.3 : pressed ? 0.6 : 1,
                      padding: 4,
                    })}
                  >
                    <Ionicons name="trash-outline" size={18} color={c.text} />
                  </Pressable>
                </View>
              </View>

              {it.kind !== 'paper' ? (
                // Non-paper kinds (repo / link) are read-only on mobile in v1.
                // Reorder + remove still work above; field edits happen on web.
                <View>
                  <View style={styles.readOnlyKindRow}>
                    <Ionicons
                      name={it.kind === 'repo' ? 'logo-github' : 'link'}
                      size={14}
                      color={c.textMuted}
                    />
                    <Text style={[styles.readOnlyKindLabel, { color: c.textMuted }]}>
                      {it.kind === 'repo' ? 'REPO' : 'LINK'}
                    </Text>
                  </View>
                  <Text style={[styles.readOnlyTitle, { color: c.text }]}>
                    {it.title}
                  </Text>
                  {it.subtitle ? (
                    <Text style={[styles.readOnlySub, { color: c.textMuted }]}>
                      {it.subtitle}
                    </Text>
                  ) : null}
                  {it.url ? (
                    <Text
                      style={[styles.readOnlySub, { color: c.textSubtle }]}
                      numberOfLines={1}
                    >
                      {it.url}
                    </Text>
                  ) : null}
                  <Text style={[styles.readOnlyHint, { color: c.textMuted }]}>
                    Edit this item on the web app.
                  </Text>
                </View>
              ) : (
                <>
              <ItemField
                label="Title"
                value={it.title}
                onChangeText={(v) => updateItem(it._key, { title: v })}
                placeholder="Paper title"
                c={c}
              />
              <ItemField
                label="Scholar URL"
                value={it.scholar_url}
                onChangeText={(v) => updateItem(it._key, { scholar_url: v })}
                placeholder="https://scholar.google.com/..."
                autoCapitalize="none"
                keyboardType="url"
                c={c}
              />
              <ItemField
                label="DOI"
                value={it.doi}
                onChangeText={(v) => updateItem(it._key, { doi: v })}
                placeholder="10.1000/xyz123"
                autoCapitalize="none"
                c={c}
              />
              <ItemField
                label="Authors"
                value={it.authors}
                onChangeText={(v) => updateItem(it._key, { authors: v })}
                placeholder="Lovelace A, Babbage C"
                c={c}
              />
              <ItemField
                label="Year"
                value={it.year}
                onChangeText={(v) => updateItem(it._key, { year: v.replace(/[^0-9]/g, '').slice(0, 4) })}
                placeholder="2026"
                keyboardType="number-pad"
                c={c}
              />
              <ItemField
                label="Notes"
                value={it.notes}
                onChangeText={(v) => updateItem(it._key, { notes: v })}
                placeholder="Why this matters"
                multiline
                c={c}
              />
                </>
              )}
            </View>
          ))}

          {/* Analytics section (edit mode only) */}
          {!isNew && analytics.data ? (
            <View style={[styles.analyticsSection, { borderColor: c.border }]}>
              <Text style={[styles.sectionLabel, { color: c.textMuted }]}>ANALYTICS</Text>
              <View style={styles.analyticsRow}>
                <View style={[styles.analyticsStat, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Text style={[styles.analyticsValue, { color: c.text }]}>
                    {analytics.data.total_views.toLocaleString()}
                  </Text>
                  <Text style={[styles.analyticsLabel, { color: c.textMuted }]}>
                    Total views
                  </Text>
                </View>
                <View style={[styles.analyticsStat, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Text style={[styles.analyticsValue, { color: c.text }]}>
                    {analytics.data.views_last_7d.toLocaleString()}
                  </Text>
                  <Text style={[styles.analyticsLabel, { color: c.textMuted }]}>
                    Last 7 days
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: '#B0002010', borderColor: '#B0002040' }]}>
              <Ionicons name="alert-circle-outline" size={18} color="#B00020" />
              <Text style={[styles.errorText, { color: '#B00020' }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleSave}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primary,
              {
                backgroundColor: c.text,
                opacity: submitting ? 0.6 : pressed ? 0.85 : 1,
                marginTop: Spacing.lg,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[styles.primaryText, { color: c.background }]}>
                {isNew ? 'Create share' : 'Save changes'}
              </Text>
            )}
          </Pressable>

          {!isNew ? (
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.deleteText, { color: '#B00020' }]}>Delete share</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {savedShare && showQr ? (
        <QrModal
          visible
          shortCode={savedShare.short_code}
          collectionName={savedShare.name}
          onClose={closeQrAndExit}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

interface ItemFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'number-pad' | 'url';
  c: (typeof Colors)['light'];
}

function ItemField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoCapitalize,
  keyboardType,
  c,
}: ItemFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        autoCorrect={!multiline && autoCapitalize !== 'none'}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          { color: c.text, borderColor: c.border, backgroundColor: c.background },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  field: { marginBottom: Spacing.md },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.xs,
  },
  charCount: { fontSize: 11, fontVariant: ['tabular-nums'] as const },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: Spacing.xs },
  input: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2, lineHeight: 18 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  addText: { fontSize: 14, fontWeight: '500' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  itemsCountHint: { fontSize: 11, marginTop: 2 },

  itemCard: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  itemIndex: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  itemHeaderActions: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { fontSize: 14, flex: 1, lineHeight: 20 },

  primary: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600' },

  deleteBtn: { paddingVertical: Spacing.lg, alignItems: 'center' },
  deleteText: { fontSize: 14, fontWeight: '500' },

  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.md },

  readOnlyKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Spacing.xs,
  },
  readOnlyKindLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  readOnlyTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  readOnlySub: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.xs,
  },
  readOnlyHint: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },

  analyticsSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  analyticsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  analyticsStat: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
  },
  analyticsValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  analyticsLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },
});
