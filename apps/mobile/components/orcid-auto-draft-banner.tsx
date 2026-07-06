import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ShareResponse } from '@/types/share';

/**
 * Dashboard onboarding banner — mobile port of the web
 * `OrcidAutoDraftBanner` (apps/web/src/app/dashboard/orcid-auto-draft-banner.tsx).
 *
 * Surfaces when the ORCID first-sign-in auto-sync pre-built a draft
 * "Publications" share on the user's behalf. Tone: inviting, not pushy.
 *
 * Detection (derived from the dashboard's `/shares` fetch — same
 * predicate as web):
 *   - name === "Publications"
 *   - published_at === null  (still a draft)
 *   - deleted_at === null    (not tombstoned)
 *   - items.length > 0       (something to publish)
 *
 * Once the user publishes or deletes the share the predicate stops
 * matching and the banner disappears on its own — no server state.
 *
 * Dismissal: AsyncStorage keyed by share id (the web version uses
 * localStorage the same way), so "I've seen it" never leaks across
 * shares or accounts. Soft signal only — deliberately not persisted
 * on the user row.
 */

const DISMISS_STORAGE_PREFIX = 'orcid-auto-draft-dismissed:';

function findAutoDraft(shares: ShareResponse[]): ShareResponse | null {
  return (
    shares.find(
      (s) =>
        s.name === 'Publications' &&
        s.published_at === null &&
        s.deleted_at === null &&
        s.items.length > 0,
    ) ?? null
  );
}

function dismissKey(shareId: string): string {
  return DISMISS_STORAGE_PREFIX + shareId;
}

export function OrcidAutoDraftBanner({ shares }: { shares: ShareResponse[] }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const autoDraft = findAutoDraft(shares);
  const autoDraftId = autoDraft?.id ?? null;

  // null = still reading storage. Render nothing until resolved so the
  // banner never flashes in and out for users who already dismissed it.
  const [storedDismissed, setStoredDismissed] = useState<boolean | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!autoDraftId) {
      setStoredDismissed(null);
      return;
    }
    AsyncStorage.getItem(dismissKey(autoDraftId))
      .then((v) => {
        if (!cancelled) setStoredDismissed(v === '1');
      })
      .catch(() => {
        // Storage unavailable — treat as not dismissed (matches web's
        // private-mode fallback).
        if (!cancelled) setStoredDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoDraftId]);

  if (!autoDraft || storedDismissed !== false || sessionDismissed) return null;

  const paperCount = autoDraft.items.length;
  const paperWord = paperCount === 1 ? 'paper' : 'papers';

  const handleDismiss = () => {
    // Session state flips immediately so dismissal works even if the
    // storage write fails.
    setSessionDismissed(true);
    AsyncStorage.setItem(dismissKey(autoDraft.id), '1').catch(() => {});
  };

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: c.accentSoft, borderColor: c.accent },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: c.text }]}>
          Your publications, ready to share.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={handleDismiss}
          hitSlop={10}
        >
          <Ionicons name="close" size={18} color={c.textMuted} />
        </Pressable>
      </View>
      <Text style={[styles.body, { color: c.textMuted }]}>
        We imported {paperCount} {paperWord} from ORCID and prepared a draft
        share for you. Have a look — when it&apos;s right, publish in one tap.
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/(authed)/share/${autoDraft.id}`)}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.btnText, { color: c.background }]}>
            Review draft
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleDismiss}
          style={({ pressed }) => [
            styles.ghostBtn,
            { borderColor: c.accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.btnText, { color: c.accent }]}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 21,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
  },
  ghostBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
