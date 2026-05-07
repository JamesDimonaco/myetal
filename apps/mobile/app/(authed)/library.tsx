import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { OrcidIcon } from '@/components/orcid-icon';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';
import {
  useAddWork,
  useHideWork,
  useRestoreWork,
  useSyncOrcid,
  useWorks,
  type OrcidSyncResult,
} from '@/hooks/useWorks';
import { ApiError } from '@/lib/api';
import type { WorkResponse } from '@/types/works';

export default function LibraryScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch, isRefetching } = useWorks();
  const addWork = useAddWork();
  const hideWork = useHideWork();
  const restoreWork = useRestoreWork();
  const syncOrcid = useSyncOrcid();

  const [doi, setDoi] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Single-fire guard for the "auto-import on first visit" behavior. We can't
  // rely solely on `last_orcid_sync_at == null` because between the success
  // callback firing and the me-query refetch settling there's a window where
  // the field is still null in cache — without this ref strict-mode's double
  // mount or a transient cache state could re-fire the mutation. Once we've
  // launched once for this user, never re-launch within the screen's lifetime.
  const autoFiredForUserRef = useRef<string | null>(null);

  const orcidId = user?.orcid_id ?? null;
  const lastSyncAt = user?.last_orcid_sync_at ?? null;
  const userId = user?.id ?? null;

  const runSync = (opts: { source: 'auto' | 'manual' }) => {
    // Don't stack concurrent runs — auto-fire and manual press share one
    // mutation. If the user taps the row mid-auto-import we no-op.
    if (syncOrcid.isPending) return;
    syncOrcid.mutate(undefined, {
      onSuccess: (result: OrcidSyncResult) => {
        Alert.alert(
          'Imported from ORCID',
          `Imported ${result.added} new. ${result.updated} updated, ${result.unchanged} already in your library, ${result.skipped} skipped.`,
        );
      },
      onError: (err) => {
        if (err instanceof ApiError) {
          if (err.status === 400) {
            Alert.alert(
              'Add your ORCID iD on your profile first',
              undefined,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Go to profile',
                  onPress: () => router.push('/(authed)/profile'),
                },
              ],
            );
            return;
          }
          if (err.status === 503) {
            Alert.alert(
              'ORCID is unavailable right now. Try again in a minute.',
            );
            return;
          }
          if (err.status === 429) {
            Alert.alert('Slow down — try again in a minute.');
            return;
          }
        }
        // Auto-fire shouldn't surface generic alerts (less surprising on first
        // visit). Manual press always surfaces something so the user gets feedback.
        if (opts.source === 'manual') {
          const detail =
            err instanceof Error ? err.message : 'Could not import from ORCID.';
          Alert.alert("Couldn't import from ORCID. Try again in a minute.", detail);
        }
      },
    });
  };

  // Auto-fire on first mount when the user has set an ORCID iD but never
  // synced. The ref guard handles strict-mode double mount. We key the guard
  // by user id so signing in as someone else still triggers their first sync.
  useEffect(() => {
    if (!userId) return;
    if (!orcidId || lastSyncAt) return;
    if (autoFiredForUserRef.current === userId) return;
    if (syncOrcid.isPending) return;
    autoFiredForUserRef.current = userId;
    runSync({ source: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, orcidId, lastSyncAt]);

  const handleAdd = () => {
    const trimmed = doi.trim();
    if (!trimmed) return;
    setAddError(null);
    addWork.mutate(trimmed, {
      onSuccess: () => setDoi(''),
      onError: (err) =>
        setAddError(err instanceof Error ? err.message : 'Failed to add paper'),
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: c.background, padding: Spacing.lg }]}>
        <Text style={[styles.errorTitle, { color: c.text }]}>
          Couldn&apos;t load your library
        </Text>
        <Text style={[styles.errorBody, { color: c.textMuted }]}>
          {error instanceof Error ? error.message : 'Unknown error'}
        </Text>
        <Pressable
          onPress={() => refetch()}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.primaryText, { color: c.background }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const works = data ?? [];
  const orcidDisabled = !orcidId;
  const orcidLabel = lastSyncAt ? 'Re-sync from ORCID' : 'Import from ORCID';

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* ORCID re-sync row — sits above the manual add form. Disabled with a
          hint when the user hasn't set an orcid_id yet. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => runSync({ source: 'manual' })}
        disabled={orcidDisabled || syncOrcid.isPending}
        style={({ pressed }) => [
          styles.orcidRow,
          {
            borderBottomColor: c.border,
            opacity:
              orcidDisabled ? 0.5 : syncOrcid.isPending ? 0.7 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <OrcidIcon size={20} />
        <View style={styles.orcidRowText}>
          <Text style={[styles.orcidRowLabel, { color: c.text }]}>
            {orcidLabel}
          </Text>
          {orcidDisabled ? (
            <Text style={[styles.orcidRowSub, { color: c.textMuted }]}>
              Add your ORCID iD on your profile first
            </Text>
          ) : null}
        </View>
        {syncOrcid.isPending ? (
          <ActivityIndicator size="small" color={c.text} />
        ) : (
          <Ionicons name="refresh" size={18} color={c.textMuted} />
        )}
      </Pressable>

      {/* Add by DOI */}
      <View style={[styles.addRow, { borderBottomColor: c.border }]}>
        <TextInput
          value={doi}
          onChangeText={setDoi}
          placeholder="Paste a DOI (e.g. 10.1234/example)"
          placeholderTextColor={c.textSubtle}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              color: c.text,
            },
          ]}
        />
        <Pressable
          onPress={handleAdd}
          disabled={addWork.isPending || !doi.trim()}
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: c.text,
              opacity: addWork.isPending || !doi.trim() ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {addWork.isPending ? (
            <ActivityIndicator size="small" color={c.background} />
          ) : (
            <Ionicons name="add" size={20} color={c.background} />
          )}
        </Pressable>
      </View>
      {addError ? (
        <View style={styles.errorRow}>
          <Text style={[styles.errorSmall, { color: '#B23A3A' }]}>{addError}</Text>
        </View>
      ) : null}

      <FlatList
        data={works}
        keyExtractor={(w) => w.paper.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.text} />
        }
        ListHeaderComponent={
          syncOrcid.isPending ? (
            <View
              style={[
                styles.syncBanner,
                { borderColor: c.border, backgroundColor: c.surface },
              ]}
            >
              <ActivityIndicator size="small" color={c.text} />
              <Text style={[styles.syncBannerText, { color: c.textMuted }]}>
                Importing your works from ORCID…
              </Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: c.border }]} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="library-outline" size={40} color={c.textSubtle} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>
              Your library is empty
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              Paste a DOI above to add your first paper.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <WorkRow
            work={item}
            colors={c}
            onHide={() => hideWork.mutate(item.paper.id)}
            onRestore={() => restoreWork.mutate(item.paper.id)}
          />
        )}
      />
    </View>
  );
}

function WorkRow({
  work,
  colors: c,
  onHide,
  onRestore,
}: {
  work: WorkResponse;
  colors: (typeof Colors)['light'];
  onHide: () => void;
  onRestore: () => void;
}) {
  const { paper } = work;
  const isHidden = work.hidden_at !== null;

  const meta = [paper.authors, paper.year ? String(paper.year) : null, paper.venue]
    .filter(Boolean)
    .join(' · ');

  const handleOpenDoi = () => {
    if (paper.doi) {
      Linking.openURL(`https://doi.org/${paper.doi}`);
    } else if (paper.url) {
      Linking.openURL(paper.url);
    }
  };

  return (
    <View style={[styles.workRow, isHidden && { opacity: 0.5 }]}>
      <Pressable
        onPress={handleOpenDoi}
        disabled={!paper.doi && !paper.url}
        style={styles.workContent}
      >
        <Text style={[styles.workTitle, { color: c.text }]} numberOfLines={2}>
          {paper.title}
        </Text>
        {meta ? (
          <Text style={[styles.workMeta, { color: c.textMuted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {paper.doi ? (
          <Text style={[styles.workDoi, { color: c.textSubtle }]}>
            DOI {paper.doi}
          </Text>
        ) : null}
        <Text style={[styles.workVia, { color: c.textSubtle }]}>
          Added via {work.added_via}
        </Text>
      </Pressable>

      <Pressable
        onPress={isHidden ? onRestore : onHide}
        hitSlop={8}
        style={({ pressed }) => [
          styles.hideBtn,
          { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons
          name={isHidden ? 'arrow-undo-outline' : 'eye-off-outline'}
          size={16}
          color={c.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  orcidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  orcidRowText: { flex: 1 },
  orcidRowLabel: { fontSize: 15, fontWeight: '600' },
  orcidRowSub: { fontSize: 12, marginTop: 2 },

  addRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: 14,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  errorSmall: { fontSize: 13 },

  list: { paddingHorizontal: Spacing.lg, flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth },

  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  syncBannerText: { fontSize: 13, flex: 1 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl * 2,
    gap: Spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyBody: { fontSize: 14, textAlign: 'center' },

  workRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  workContent: { flex: 1 },
  workTitle: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  workMeta: { fontSize: 13, marginTop: 2 },
  workDoi: { fontSize: 11, marginTop: 2 },
  workVia: { fontSize: 11, marginTop: 2 },

  hideBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.sm },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: Spacing.md },

  primary: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600' },
});
