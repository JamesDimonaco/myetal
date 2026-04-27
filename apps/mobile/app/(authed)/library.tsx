import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAddWork, useHideWork, useRestoreWork, useWorks } from '@/hooks/useWorks';
import type { WorkResponse } from '@/types/works';

export default function LibraryScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { data, isLoading, isError, error, refetch, isRefetching } = useWorks();
  const addWork = useAddWork();
  const hideWork = useHideWork();
  const restoreWork = useRestoreWork();

  const [doi, setDoi] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

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

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
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
