// TODO: Web parity gaps:
//   - Web profile page shows "Active sessions" list with per-session revoke
//     (GET /auth/me/sessions, POST /auth/me/sessions/:id/revoke)

import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { useAuth } from '@/hooks/useAuth';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import { ApiError } from '@/lib/api';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// Format used by orcid.org and the backend (4 groups of 4, last char may be X).
const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export default function ProfileScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user, signOut, updateOrcidId } = useAuth();
  const { reset: resetAnalytics } = useAnalytics();
  const { reset: resetConsent } = useAnalyticsConsent();
  const { preference, setPreference } = useThemePreference();
  const [signingOut, setSigningOut] = useState(false);

  // ORCID iD entry/edit state. We seed from the loaded user and keep a local
  // draft so the Save button can detect changes vs the persisted value.
  const persistedOrcid = user?.orcid_id ?? null;
  const [orcidDraft, setOrcidDraft] = useState<string>(persistedOrcid ?? '');
  const [orcidSaving, setOrcidSaving] = useState(false);
  const [orcidError, setOrcidError] = useState<string | null>(null);
  // Tracks the last server value we seeded into the draft. Used to detect
  // whether the user has typed since the last seed — if they have, we leave
  // their input alone when /auth/me refetches in the background.
  const lastSeededOrcidRef = useRef<string>(persistedOrcid ?? '');

  // Re-seed only when the user hasn't diverged from the last-seeded value
  // (i.e. they're not actively editing). This prevents a background refetch
  // of /auth/me from clobbering in-progress input.
  useEffect(() => {
    const next = persistedOrcid ?? '';
    if (orcidDraft === lastSeededOrcidRef.current) {
      setOrcidDraft(next);
      setOrcidError(null);
      lastSeededOrcidRef.current = next;
    }
  }, [persistedOrcid, orcidDraft]);

  const trimmedOrcid = orcidDraft.trim().toUpperCase();
  const orcidChanged = trimmedOrcid !== (persistedOrcid ?? '');
  const orcidValidForSave = useMemo(() => {
    if (!orcidChanged) return false;
    if (trimmedOrcid === '') return persistedOrcid !== null; // clearing is fine
    return ORCID_REGEX.test(trimmedOrcid);
  }, [orcidChanged, trimmedOrcid, persistedOrcid]);

  // Single-button collapse logic (§2.2). At most one primary action visible:
  //   - 'save'   → input differs from saved (valid → enabled, invalid → disabled)
  //   - 'remove' → input matches saved (so editing is a no-op), OR input
  //                empty while a value is persisted
  //   - 'none'   → empty input + nothing saved
  // We never render Save and Remove simultaneously. We mirror the web flow
  // (orcid-section.tsx) which keeps a disabled Save visible while the user
  // is mid-typing an invalid replacement, rather than hiding the button — a
  // disappearing button reads as broken.
  type OrcidButtonMode = 'save' | 'remove' | 'none';
  const orcidButtonMode: OrcidButtonMode = (() => {
    if (orcidValidForSave && trimmedOrcid !== '') return 'save';
    if (persistedOrcid && trimmedOrcid === '') return 'remove';
    if (persistedOrcid && trimmedOrcid === persistedOrcid) return 'remove';
    // Non-empty but invalid (mid-typing a replacement): show a disabled Save
    // rather than hiding the button.
    if (trimmedOrcid !== '' && trimmedOrcid !== (persistedOrcid ?? '')) return 'save';
    return 'none';
  })();
  // Save is enabled only when the input is a valid, distinct iD. Otherwise
  // we still render the Save button (mode === 'save') but visually dim it
  // and skip the press handler.
  const orcidSaveDisabled = orcidButtonMode === 'save' && !orcidValidForSave;

  const handleOpenOrcidProfile = () => {
    if (!persistedOrcid) return;
    Linking.openURL(`https://orcid.org/${persistedOrcid}`).catch(() => {
      // ignore — best effort
    });
  };

  const handleOpenOrcidExplainer = () => {
    Linking.openURL('https://orcid.org').catch(() => {
      // ignore
    });
  };

  const handleSaveOrcid = async () => {
    setOrcidError(null);
    const next = trimmedOrcid === '' ? null : trimmedOrcid;
    if (next !== null && !ORCID_REGEX.test(next)) {
      setOrcidError(
        "That doesn't look like a valid ORCID iD. Use the format 0000-0000-0000-0000 (last digit may be X).",
      );
      return;
    }
    setOrcidSaving(true);
    try {
      const updated = await updateOrcidId(next);
      // Reflect the canonical server value (e.g. lowercase x → uppercase X)
      // and keep the "last seeded" ref in sync so the background-refetch
      // guard above doesn't mistake this for in-progress editing.
      const canonical = updated.orcid_id ?? '';
      setOrcidDraft(canonical);
      lastSeededOrcidRef.current = canonical;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setOrcidError('That ORCID iD is already linked to another account.');
        } else if (err.status === 422) {
          setOrcidError(
            "That doesn't look like a valid ORCID iD. Use the format 0000-0000-0000-0000 (last digit may be X).",
          );
        } else {
          setOrcidError('Could not save your ORCID iD.');
        }
      } else {
        setOrcidError('Could not save your ORCID iD.');
      }
    } finally {
      setOrcidSaving(false);
    }
  };

  const handleClearOrcid = () => {
    Alert.alert(
      'Remove ORCID iD?',
      'You can paste it back later from your profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setOrcidError(null);
            setOrcidSaving(true);
            try {
              await updateOrcidId(null);
              setOrcidDraft('');
              lastSeededOrcidRef.current = '';
            } catch {
              setOrcidError('Could not save your ORCID iD.');
            } finally {
              setOrcidSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleResetConsent = () => {
    resetAnalytics();
    resetConsent();
    Alert.alert(
      'Analytics consent reset',
      'The app will ask again on next launch.',
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to manage your shares.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.textMuted }]}>NAME</Text>
          <Text style={[styles.value, { color: c.text }]}>{user?.name ?? '—'}</Text>

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          <Text style={[styles.label, { color: c.textMuted }]}>EMAIL</Text>
          <Text style={[styles.value, { color: c.text }]}>{user?.email ?? '—'}</Text>
        </View>

        {/* ORCID iD entry — see docs/tickets/orcid-integration-and-account-linking.md
            (Part 4: manual entry rationale). The user can paste/edit/save their
            iD here even without going through the OAuth flow. */}
        <View>
          <Text style={[styles.prefsLabel, { color: c.textMuted }]}>ORCID iD</Text>
          <View style={[styles.prefsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.orcidHelp, { color: c.textMuted }]}>
              Add your ORCID iD to import your public works. We only read — we never write to your ORCID record.
            </Text>

            {persistedOrcid ? (
              <Pressable
                accessibilityRole="link"
                onPress={handleOpenOrcidProfile}
                style={({ pressed }) => [
                  styles.orcidLinkRow,
                  { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.orcidLinkText, { color: c.text }]}>
                  {persistedOrcid}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: 13 }}>Open {'↗'}</Text>
              </Pressable>
            ) : null}

            <TextInput
              value={orcidDraft}
              onChangeText={setOrcidDraft}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="0000-0000-0000-0000"
              placeholderTextColor={c.textMuted}
              maxLength={19}
              style={[
                styles.orcidInput,
                { color: c.text, borderColor: c.border, backgroundColor: c.background },
              ]}
            />

            {orcidError ? (
              <Text style={[styles.orcidError, { color: '#B00020' }]}>{orcidError}</Text>
            ) : null}

            {orcidButtonMode !== 'none' ? (
              <View style={styles.orcidButtonRow}>
                {orcidButtonMode === 'save' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={orcidSaveDisabled ? undefined : handleSaveOrcid}
                    disabled={orcidSaving || orcidSaveDisabled}
                    style={({ pressed }) => [
                      styles.orcidSave,
                      {
                        backgroundColor: c.text,
                        opacity: orcidSaving
                          ? 0.4
                          : orcidSaveDisabled
                            ? 0.55
                            : pressed
                              ? 0.85
                              : 1,
                      },
                    ]}
                  >
                    {orcidSaving ? (
                      <ActivityIndicator color={c.background} />
                    ) : (
                      <Text style={[styles.orcidSaveText, { color: c.background }]}>
                        Save
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleClearOrcid}
                    disabled={orcidSaving}
                    style={({ pressed }) => [
                      styles.orcidSave,
                      {
                        backgroundColor: '#B00020',
                        opacity: orcidSaving ? 0.4 : pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    {orcidSaving ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={[styles.orcidSaveText, { color: '#FFFFFF' }]}>
                        Remove
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="link"
              onPress={handleOpenOrcidExplainer}
              hitSlop={8}
            >
              <Text style={[styles.orcidExplainer, { color: c.textMuted }]}>
                What&apos;s an ORCID iD? {'↗'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Preferences */}
      <View style={styles.prefsSection}>
        <Text style={[styles.prefsLabel, { color: c.textMuted }]}>PREFERENCES</Text>
        <View style={[styles.prefsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.prefsTitle, { color: c.text }]}>Appearance</Text>
          <View style={styles.themePillRow}>
            {THEME_OPTIONS.map((opt) => {
              const active = preference === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setPreference(opt.value)}
                  style={({ pressed }) => [
                    styles.themePill,
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
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/feedback')}
        style={({ pressed }) => [
          styles.feedbackRow,
          { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.feedbackText, { color: c.text }]}>Send feedback</Text>
        <Text style={{ color: c.textMuted, fontSize: 18 }}>{'\u203A'}</Text>
      </Pressable>

      <Pressable
        onPress={handleResetConsent}
        style={({ pressed }) => [
          styles.feedbackRow,
          { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.feedbackText, { color: c.text }]}>Reset analytics consent</Text>
        <Text style={{ color: c.textMuted, fontSize: 18 }}>{'\u203A'}</Text>
      </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOut,
            { borderColor: c.text, opacity: signingOut ? 0.6 : pressed ? 0.7 : 1 },
          ]}
        >
          {signingOut ? (
            <ActivityIndicator color={c.text} />
          ) : (
            <Text style={[styles.signOutText, { color: c.text }]}>Sign out</Text>
          )}
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  flex: { flex: 1 },
  scroll: { paddingTop: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.xs },
  value: { fontSize: 17, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.md },

  orcidHelp: { fontSize: 13, lineHeight: 18, marginBottom: Spacing.sm },
  orcidLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  orcidLinkText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  orcidInput: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  orcidError: { fontSize: 13, marginTop: Spacing.xs },
  orcidButtonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  orcidSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  orcidSaveText: { fontSize: 15, fontWeight: '600' },
  orcidRemove: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  orcidRemoveText: { fontSize: 15, fontWeight: '500' },
  orcidExplainer: { fontSize: 13, marginTop: Spacing.sm },

  prefsSection: { marginBottom: Spacing.md },
  prefsLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.sm },
  prefsCard: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  prefsTitle: { fontSize: 15, fontWeight: '600', marginBottom: Spacing.sm },
  themePillRow: { flexDirection: 'row', gap: Spacing.xs },
  themePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },

  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
  },
  feedbackText: { fontSize: 16, fontWeight: '500' },

  signOut: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  signOutText: { fontSize: 16, fontWeight: '600' },
});
