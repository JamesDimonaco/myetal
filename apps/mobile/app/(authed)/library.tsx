import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
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
import { useShares } from '@/hooks/useShares';
import {
  useAddWork,
  useHideWork,
  useRestoreWork,
  useSyncOrcid,
  useWorks,
  type OrcidSyncResult,
} from '@/hooks/useWorks';
import { api, ApiError } from '@/lib/api';
import type { ShareItemInput, ShareResponse } from '@/types/share';
import type { WorkResponse } from '@/types/works';

export default function LibraryScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch, isRefetching } = useWorks();
  const addWork = useAddWork();
  const hideWork = useHideWork();
  const restoreWork = useRestoreWork();
  const syncOrcid = useSyncOrcid();
  const sharesQuery = useShares();
  const queryClient = useQueryClient();

  const [doi, setDoi] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Single-fire guard for the "auto-import on first visit" behavior. We can't
  // rely solely on `last_orcid_sync_at == null` because between the success
  // callback firing and the me-query refetch settling there's a window where
  // the field is still null in cache — without this ref strict-mode's double
  // mount or a transient cache state could re-fire the mutation.
  //
  // The key is composite (`${userId}:${orcid_id ?? 'none'}`) so that when the
  // user changes their orcid_id on the profile tab — which resets
  // `last_orcid_sync_at = NULL` server-side — returning to this tab re-arms
  // the auto-fire for the new iD. Tab screens persist across navigations in
  // Expo Router, so without this re-keying the auto-import would never fire
  // for the new ORCID.
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
          `Imported ${result.added} new, ${result.updated} updated, ${result.unchanged} already in your library, ${result.skipped} skipped.`,
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
  // by `${userId}:${orcidId ?? 'none'}` so signing in as someone else, OR the
  // current user changing their orcid_id (which resets last_orcid_sync_at on
  // the server), re-arms the auto-fire for the new composite identity.
  useEffect(() => {
    if (!userId) return;
    if (!orcidId || lastSyncAt) return;
    const key = `${userId}:${orcidId ?? 'none'}`;
    if (autoFiredForUserRef.current === key) return;
    if (syncOrcid.isPending) return;
    autoFiredForUserRef.current = key;
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

  /**
   * Append a library work as a new ShareItem on the chosen share. The backend
   * has no /shares/{id}/items endpoint, so we PATCH the share with its
   * existing items + the new one. On success we invalidate ['shares'] so the
   * dashboard reflects the new count.
   */
  const appendWorkToShare = async (work: WorkResponse, share: ShareResponse) => {
    const { paper } = work;
    const newItem: ShareItemInput = {
      kind: 'paper',
      title: paper.title,
      doi: paper.doi ?? null,
      authors: paper.authors ?? null,
      year: paper.year ?? null,
      url: paper.url ?? null,
      subtitle: paper.subtitle ?? null,
      image_url: paper.image_url ?? null,
    };

    // Round-trip every existing item verbatim so we don't drop kind-specific
    // fields (repo / link). Strip the server-only `id`/`position` fields.
    const existingItems: ShareItemInput[] = share.items.map((it) => ({
      kind: it.kind,
      title: it.title,
      url: it.url,
      subtitle: it.subtitle,
      image_url: it.image_url,
      scholar_url: it.scholar_url,
      doi: it.doi,
      authors: it.authors,
      year: it.year,
      notes: it.notes,
    }));

    try {
      await api<ShareResponse>(`/shares/${share.id}`, {
        method: 'PATCH',
        json: { items: [...existingItems, newItem] },
      });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      Alert.alert(`Added to '${share.name}'.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : 'Failed to add';
      Alert.alert("Couldn't add to share", msg);
    }
  };

  const handleAddToShare = (work: WorkResponse) => {
    const shares = sharesQuery.data ?? [];
    const liveShares = shares.filter((s) => s.deleted_at === null);

    const newShareLabel = '+ New share with this paper';
    // Stash the work id in a closure value used on selection.
    const titles = liveShares.map((s) => s.name);
    const options = [...titles, newShareLabel, 'Cancel'];

    const handleSelection = (idx: number) => {
      if (idx === options.length - 1) return; // Cancel
      if (idx === options.length - 2) {
        // New share — navigate to the editor. Inline create-with-paper isn't
        // supported (requires schema work); user adds it on the new-share screen.
        router.push('/(authed)/share/new');
        return;
      }
      const picked = liveShares[idx];
      if (picked) appendWorkToShare(work, picked);
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          title: 'Add to share',
        },
        handleSelection,
      );
      return;
    }

    // Cross-platform fallback: Alert.alert with up to 3 buttons. If the user
    // has more than two shares we can't list them all in one alert (RN caps
    // android buttons at 3) — punt to a "pick a share" navigation in that
    // case. For now: list the first two shares + a "+ New / more" entry.
    if (liveShares.length === 0) {
      Alert.alert(
        'No shares yet',
        'Create a share first, then add this paper to it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'New share',
            onPress: () => router.push('/(authed)/share/new'),
          },
        ],
      );
      return;
    }

    if (liveShares.length <= 2) {
      Alert.alert('Add to share', undefined, [
        ...liveShares.map((s) => ({
          text: s.name,
          onPress: () => appendWorkToShare(work, s),
        })),
        {
          text: 'New share',
          onPress: () => router.push('/(authed)/share/new'),
        },
        { text: 'Cancel', style: 'cancel' as const },
      ]);
      return;
    }

    // Too many shares for a 3-button Alert — bounce to dashboard so the user
    // can navigate to the right share. Documented in the report.
    Alert.alert(
      'Add to share',
      'Open a share and use the editor to add this paper.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New share',
          onPress: () => router.push('/(authed)/share/new'),
        },
      ],
    );
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
          ) : works.length === 0 && syncOrcid.isError ? (
            // E8 — ORCID auto-import network failure on a fresh sign-in.
            <View
              style={[
                styles.syncBanner,
                { borderColor: '#B0002040', backgroundColor: '#B0002010' },
              ]}
            >
              <Ionicons name="warning-outline" size={18} color="#B00020" />
              <Text style={[styles.syncBannerText, { color: '#B00020' }]}>
                We couldn&apos;t reach ORCID. Pull down to retry, or paste a DOI to add a paper manually.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => runSync({ source: 'manual' })}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.retryBtn,
                  { borderColor: '#B00020', opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.retryBtnText, { color: '#B00020' }]}>
                  Retry
                </Text>
              </Pressable>
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
              {!orcidId
                ? // E1 — library no-ORCID prompt
                  'Your library is where your papers live. Add your ORCID iD on your profile to auto-import them, or paste a DOI above to add one manually.'
                : lastSyncAt
                ? // E2 — ORCID synced but no works.
                  "We synced your ORCID record but didn't find any works yet. Add your first paper at orcid.org, or paste a DOI here to get started."
                : 'Paste a DOI above to add your first paper.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <WorkRow
            work={item}
            colors={c}
            userOrcidId={orcidId}
            onHide={() => hideWork.mutate(item.paper.id)}
            onRestore={() => restoreWork.mutate(item.paper.id)}
            onAddToShare={() => handleAddToShare(item)}
          />
        )}
      />
    </View>
  );
}

function WorkRow({
  work,
  colors: c,
  userOrcidId,
  onHide,
  onRestore,
  onAddToShare,
}: {
  work: WorkResponse;
  colors: (typeof Colors)['light'];
  userOrcidId: string | null;
  onHide: () => void;
  onRestore: () => void;
  onAddToShare: () => void;
}) {
  const { paper } = work;
  const isHidden = work.hidden_at !== null;
  const isFromOrcid = work.added_via === 'orcid';

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

  const handleOpenOrcid = () => {
    if (userOrcidId) {
      Linking.openURL(`https://orcid.org/${userOrcidId}`);
    }
  };

  return (
    <View style={[styles.workRow, isHidden && { opacity: 0.5 }]}>
      <View style={styles.workContent}>
        <Pressable
          onPress={handleOpenDoi}
          disabled={!paper.doi && !paper.url}
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
        </Pressable>

        {isFromOrcid && userOrcidId ? (
          <Pressable
            accessibilityRole="link"
            onPress={handleOpenOrcid}
            hitSlop={6}
            style={({ pressed }) => [styles.orcidBadgeRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.orcidBadgeText, { color: c.textMuted }]}>
              Imported from ORCID ↗
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.workVia, { color: c.textSubtle }]}>
            Added via {work.added_via}
          </Text>
        )}

        {!isHidden ? (
          <Pressable
            onPress={onAddToShare}
            hitSlop={4}
            style={({ pressed }) => [styles.addToShareBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="add-circle-outline" size={14} color={c.text} />
            <Text style={[styles.addToShareText, { color: c.text }]}>
              Add to share...
            </Text>
          </Pressable>
        ) : null}
      </View>

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

  retryBtn: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryBtnText: { fontSize: 12, fontWeight: '600' },

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
  orcidBadgeRow: { marginTop: 4, alignSelf: 'flex-start' },
  orcidBadgeText: { fontSize: 11 },
  addToShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  addToShareText: { fontSize: 13, fontWeight: '500' },

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
