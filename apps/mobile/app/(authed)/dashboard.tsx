// TODO: Web parity gaps:
//   - Share cards on web have "Copy link" and "Open in new tab" actions (mobile only has QR + Edit)
//   - Web shows a kind-aware summary (e.g. "2 papers, 1 repo") per card; mobile just shows item count
//   - Web allows delete directly from the dashboard card; mobile requires opening the editor

import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { QrModal } from '@/components/qr-modal';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useShares } from '@/hooks/useShares';
import type { ShareResponse } from '@/types/share';

/**
 * Owner dashboard — lists every share the user has created. Header "+" jumps
 * to the editor in create-mode; each row exposes a QR button (opens the
 * existing QrModal) and an Edit button.
 */
export default function DashboardScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const navigation = useNavigation();
  const { data, isLoading, isError, error, refetch, isRefetching } = useShares();
  const [qrTarget, setQrTarget] = useState<ShareResponse | null>(null);

  // Wire up the header "+" via setOptions so it lives in the tab navigator's
  // own header (no need for a custom container).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New share"
          hitSlop={12}
          onPress={() => router.push('/(authed)/share/new')}
          style={({ pressed }) => ({
            paddingHorizontal: Spacing.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="add" size={28} color={c.text} />
        </Pressable>
      ),
    });
  }, [navigation, c.text]);

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
        <Text style={[styles.errorTitle, { color: c.text }]}>Couldn&apos;t load your shares</Text>
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

  const shares = data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={shares}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.text} />
        }
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>No shares yet</Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              Create your first share to generate a QR for posters, slides, and CV pages.
            </Text>
            <Pressable
              onPress={() => router.push('/(authed)/share/new')}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: c.background }]}>Create a share</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <View style={styles.cardBody}>
              <Text style={[styles.code, { color: c.textMuted }]}>{item.short_code}</Text>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {item.items.length} {item.items.length === 1 ? 'item' : 'items'}
                {item.is_public ? '' : ' · private'}
                {' · '}
                <Text style={styles.typeTag}>{item.type}</Text>
              </Text>
            </View>
            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show QR"
                onPress={() => setQrTarget(item)}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="qr-code-outline" size={18} color={c.text} />
                <Text style={[styles.actionText, { color: c.text }]}>QR</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View share"
                onPress={() => router.push(`/c/${item.short_code}`)}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="eye-outline" size={18} color={c.text} />
                <Text style={[styles.actionText, { color: c.text }]}>View</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit share"
                onPress={() => router.push(`/(authed)/share/${item.id}`)}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="create-outline" size={18} color={c.text} />
                <Text style={[styles.actionText, { color: c.text }]}>Edit</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      {qrTarget ? (
        <QrModal
          visible
          shortCode={qrTarget.short_code}
          collectionName={qrTarget.name}
          onClose={() => setQrTarget(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.lg, flexGrow: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: Spacing.md },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.sm },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: Spacing.md },

  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
  },
  cardBody: { marginBottom: Spacing.sm },
  code: { fontSize: 12, fontVariant: ['tabular-nums'], letterSpacing: 0.5, marginBottom: Spacing.xs },
  name: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
  meta: { fontSize: 13, marginTop: Spacing.xs },
  typeTag: { textTransform: 'capitalize' },

  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: { fontSize: 14, fontWeight: '500' },

  primary: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '600' },
});
