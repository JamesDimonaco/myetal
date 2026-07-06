// TODO: Web parity gaps:
//   - Web allows delete directly from the dashboard card; mobile requires
//     opening the editor (deliberate for now — destructive action stays
//     behind the editor until we design a confirm flow for the card).

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { OrcidAutoDraftBanner } from '@/components/orcid-auto-draft-banner';
import { QrModal } from '@/components/qr-modal';
import { TagChips } from '@/components/tag-chips';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';
import { useShares } from '@/hooks/useShares';
import { useWorks } from '@/hooks/useWorks';
import type { ShareItemKind, ShareResponse } from '@/types/share';

/**
 * Kind-aware item summary, mirroring the web dashboard cards:
 * "2 papers, 1 repo, 1 PDF" instead of a bare "4 items".
 */
const KIND_ORDER: ShareItemKind[] = ['paper', 'repo', 'link', 'pdf'];
const KIND_LABELS: Record<ShareItemKind, [singular: string, plural: string]> = {
  paper: ['paper', 'papers'],
  repo: ['repo', 'repos'],
  link: ['link', 'links'],
  pdf: ['PDF', 'PDFs'],
};

function summarizeItems(items: ShareResponse['items']): string {
  if (items.length === 0) return '0 items';
  const counts = new Map<ShareItemKind, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return KIND_ORDER.filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k)!;
      const [one, many] = KIND_LABELS[k];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

/**
 * Owner dashboard — lists every share the user has created. Header "+" jumps
 * to the editor in create-mode; each row exposes a QR button (opens the
 * existing QrModal) and an Edit button.
 */
export default function DashboardScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const navigation = useNavigation();
  const { data, isLoading, isError, error, refetch, isRefetching } = useShares();
  const { user } = useAuth();
  const worksQuery = useWorks();
  const libraryCount = worksQuery.data?.length ?? 0;
  const [qrTarget, setQrTarget] = useState<ShareResponse | null>(null);
  // "Copy link" feedback — one card at a time, resets after 2s.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyLink = async (share: ShareResponse) => {
    await Clipboard.setStringAsync(`https://myetal.app/c/${share.short_code}`);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopiedId(share.id);
    copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
  };

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

  const allShares = data ?? [];
  // M-FIX-5: hide item-less shares from the dashboard list. Brand-new shares
  // are auto-created by the PDF intent flow with `items: []` and remain in
  // limbo if the user backs out before adding anything. Filter them out
  // client-side so the dashboard stays a list of meaningful shares; if the
  // user comes back with the share's id we still load it in the editor.
  const shares = allShares.filter((s) => s.items.length > 0);
  const hasOnlyEmptyDrafts = allShares.length > 0 && shares.length === 0;
  const noOrcid = !user?.orcid_id;
  // E1 — brand-new user (no ORCID, no shares of any kind).
  const showWelcomeBanner = noOrcid && allShares.length === 0;
  // E3 — has papers, no shares (suppressed when E1 is showing or when the
  // only "shares" are item-less drafts that we've hidden).
  const showHasPapersHint =
    !showWelcomeBanner &&
    !hasOnlyEmptyDrafts &&
    shares.length === 0 &&
    libraryCount > 0;
  // E4 — drafts only banner above list when shares exist but none published.
  const allUnpublished =
    shares.length > 0 && shares.every((s) => s.published_at === null);

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
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            {/* Soft email-verification reminder. Self-gating; renders nothing
                when the user is verified or has dismissed it for this
                email — see VerifyEmailBanner for the gating logic. */}
            <VerifyEmailBanner />
            {/* ORCID first-sign-in auto-draft — web parity (dashboard
                banner). Uses allShares: the draft always has items so it
                survives the empty-draft filter, but don't depend on that. */}
            <OrcidAutoDraftBanner shares={allShares} />
            {showWelcomeBanner ? (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: c.accentSoft, borderColor: c.accent },
                ]}
              >
                <Text style={[styles.bannerText, { color: c.text }]}>
                  Welcome. Add your ORCID iD on your profile to auto-import your papers, or paste a DOI in your library to get started.
                </Text>
                <View style={styles.bannerActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/(authed)/profile')}
                    style={({ pressed }) => [
                      styles.bannerBtn,
                      {
                        backgroundColor: c.accent,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.bannerBtnText, { color: c.background }]}>
                      Add ORCID
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/(authed)/library')}
                    style={({ pressed }) => [
                      styles.bannerBtnGhost,
                      { borderColor: c.accent, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.bannerBtnText, { color: c.accent }]}>
                      Open library
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {allUnpublished ? (
              <View
                style={[
                  styles.draftsBanner,
                  { backgroundColor: c.surface, borderColor: c.border },
                ]}
              >
                <Text style={[styles.draftsBannerText, { color: c.textMuted }]}>
                  None of your shares are listed in discovery yet. Open one and toggle &apos;Publish&apos; to make it findable.
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          showHasPapersHint ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No shares yet</Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                You have {libraryCount} {libraryCount === 1 ? 'paper' : 'papers'} in your library. Tap any to add it to a new share — that&apos;s how you get a QR code.
              </Text>
              <Pressable
                onPress={() => router.push('/(authed)/library')}
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.primaryText, { color: c.background }]}>Open library</Text>
              </Pressable>
            </View>
          ) : hasOnlyEmptyDrafts ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No shares yet</Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                Drafts in progress will appear here once you add an item.
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
          ) : (
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
          )
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <View style={styles.cardBody}>
              <View style={styles.codeRow}>
                <Text style={[styles.code, { color: c.textMuted }]}>{item.short_code}</Text>
                {item.published_at === null ? (
                  <View
                    style={[
                      styles.draftBadge,
                      { backgroundColor: c.surfaceSunken, borderColor: c.border },
                    ]}
                  >
                    <Text style={[styles.draftBadgeText, { color: c.textMuted }]}>
                      Unlisted
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {summarizeItems(item.items)}
                {item.is_public ? '' : ' · private'}
                {' · '}
                <Text style={styles.typeTag}>{item.type}</Text>
              </Text>
              <TagChips tags={item.tags} max={2} linkPattern="browse" />
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
                accessibilityLabel="Copy link"
                onPress={() => handleCopyLink(item)}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons
                  name={copiedId === item.id ? 'checkmark' : 'link-outline'}
                  size={18}
                  color={copiedId === item.id ? c.success : c.text}
                />
                <Text
                  style={[
                    styles.actionText,
                    { color: copiedId === item.id ? c.success : c.text },
                  ]}
                >
                  {copiedId === item.id ? 'Copied' : 'Copy'}
                </Text>
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

  headerWrap: { gap: Spacing.sm, marginBottom: Spacing.sm },
  banner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  bannerText: { fontSize: 14, lineHeight: 20 },
  bannerActions: { flexDirection: 'row', gap: Spacing.sm },
  bannerBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
  },
  bannerBtnGhost: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerBtnText: { fontSize: 13, fontWeight: '600' },
  draftsBanner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  draftsBannerText: { fontSize: 13, lineHeight: 18 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  draftBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  draftBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

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
  // flex: 1 + centered content so four actions (QR / Copy / View / Edit)
  // share the row evenly on narrow screens.
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
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
