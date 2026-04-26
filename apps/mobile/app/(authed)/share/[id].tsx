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
  useShare,
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
  ShareResponse,
  ShareType,
} from '@/types/share';

const SHARE_TYPES: ShareType[] = ['paper', 'collection', 'poster', 'grant'];

const itemSchema = z.object({
  title: z.string().trim().min(1, 'Item title required').max(500),
  scholar_url: z.string().trim().url('Invalid URL').max(2000).optional().or(z.literal('')),
  doi: z.string().trim().max(255).optional().or(z.literal('')),
  authors: z.string().trim().optional().or(z.literal('')),
  year: z
    .union([z.string().regex(/^\d{4}$/, '4-digit year'), z.literal('')])
    .optional(),
  notes: z.string().trim().optional().or(z.literal('')),
});

const shareSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(200),
  description: z.string().trim().optional().or(z.literal('')),
  type: z.enum(['paper', 'collection', 'poster', 'grant']),
  is_public: z.boolean(),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
});

interface DraftItem {
  // Local-only key so reorders don't lose focus on the wrong row.
  _key: string;
  title: string;
  scholar_url: string;
  doi: string;
  authors: string;
  year: string;
  notes: string;
}

let _itemKeySeed = 0;
const newKey = () => `item_${++_itemKeySeed}_${Date.now()}`;

const emptyItem = (): DraftItem => ({
  _key: newKey(),
  title: '',
  scholar_url: '',
  doi: '',
  authors: '',
  year: '',
  notes: '',
});

const fromResponseItem = (it: ShareResponse['items'][number]): DraftItem => ({
  _key: newKey(),
  title: it.title,
  scholar_url: it.scholar_url ?? '',
  doi: it.doi ?? '',
  authors: it.authors ?? '',
  year: it.year != null ? String(it.year) : '',
  notes: it.notes ?? '',
});

const fromPaper = (p: Paper): DraftItem => ({
  _key: newKey(),
  title: p.title,
  scholar_url: p.scholar_url ?? '',
  doi: p.doi ?? '',
  authors: p.authors ?? '',
  year: p.year != null ? String(p.year) : '',
  notes: '',
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
  const createMutation = useCreateShare();
  const updateMutation = useUpdateShare(id ?? '');
  const deleteMutation = useDeleteShare();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shareType, setShareType] = useState<ShareType>('paper');
  const [isPublic, setIsPublic] = useState(true);
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
    setIsPublic(existing.data.is_public);
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
      is_public: isPublic,
      items,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    // Convert empty strings → null for the API.
    const apiItems: ShareItemInput[] = parsed.data.items.map((it) => ({
      title: it.title,
      scholar_url: it.scholar_url ? it.scholar_url : null,
      doi: it.doi ? it.doi : null,
      authors: it.authors ? it.authors : null,
      year: it.year ? Number(it.year) : null,
      notes: it.notes ? it.notes : null,
    }));

    const payload: ShareCreateInput = {
      name: parsed.data.name,
      description: parsed.data.description ? parsed.data.description : null,
      type: parsed.data.type,
      is_public: parsed.data.is_public,
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
    Alert.alert('Delete share?', 'This cannot be undone.', [
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
            <Text style={[styles.label, { color: c.textMuted }]}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="My ASMS poster"
              placeholderTextColor={c.textMuted}
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
              placeholder="Briefly describe what people will find"
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

          {/* Public toggle */}
          <View style={[styles.field, styles.row]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Public</Text>
              <Text style={[styles.rowSub, { color: c.textMuted }]}>
                Anyone with the QR can view this collection.
              </Text>
            </View>
            <Switch value={isPublic} onValueChange={setIsPublic} />
          </View>

          {/* Items */}
          <View style={styles.itemsHeader}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>ITEMS</Text>
            <Pressable
              onPress={openAddPaper}
              hitSlop={8}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="add-circle-outline" size={20} color={c.text} />
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
            </View>
          ))}

          {error ? <Text style={[styles.error, { color: '#B00020' }]}>{error}</Text> : null}

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
  addText: { fontSize: 14, fontWeight: '500', marginLeft: 4 },

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

  error: { fontSize: 14, marginTop: Spacing.sm },

  primary: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600' },

  deleteBtn: { paddingVertical: Spacing.lg, alignItems: 'center' },
  deleteText: { fontSize: 14, fontWeight: '500' },

  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.md },
});
