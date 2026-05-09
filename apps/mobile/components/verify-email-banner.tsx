import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';

const DISMISS_KEY = 'myetal.verify-email-banner.dismissed-for-email';

/**
 * Soft email-verification reminder (Phase 4 Better Auth cutover).
 *
 * Renders a non-blocking banner when the signed-in user's
 * ``email_verified`` flag is ``false``. Dismissable per-email — once a
 * user taps the close button we remember the dismissal until the user
 * either verifies the email (banner disappears for real) or signs in
 * with a different email. We deliberately don't persist forever: a fresh
 * verify-link tap clears `email_verified` to true on the server side and
 * the banner naturally vanishes on the next ``refreshUser`` call.
 *
 * Tapping "Resend" hits Better Auth's
 * ``/api/auth/send-verification-email`` endpoint with the current Bearer
 * token (BA requires an authenticated session — Bearer is accepted via the
 * JWT plugin). Failure surfaces as a non-blocking error message.
 */
export function VerifyEmailBanner() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user, refreshUser } = useAuth();
  const [dismissed, setDismissed] = useState<boolean>(true); // start hidden until we read storage
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<null | 'sent' | 'error'>(null);

  // Read the per-email dismissal flag from AsyncStorage on mount / when the
  // signed-in email changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const email = user?.email ?? '';
      if (!email) {
        if (!cancelled) setDismissed(true);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(DISMISS_KEY);
        const dismissedEmail = raw ?? '';
        if (!cancelled) setDismissed(dismissedEmail === email);
      } catch {
        if (!cancelled) setDismissed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const handleDismiss = useCallback(async () => {
    setDismissed(true);
    try {
      if (user?.email) await AsyncStorage.setItem(DISMISS_KEY, user.email);
    } catch {
      // best-effort; in-memory dismissal still applies for this session.
    }
  }, [user?.email]);

  const handleResend = useCallback(async () => {
    if (!user?.email) return;
    setResending(true);
    setResendStatus(null);
    try {
      const { WEB_BASE_URL } = await import('@/lib/api');
      const { getAccessToken } = await import('@/lib/auth-storage');
      const token = await getAccessToken();
      if (!token) {
        setResendStatus('error');
        return;
      }
      const response = await fetch(
        `${WEB_BASE_URL}/api/auth/send-verification-email`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: user.email }),
        },
      );
      setResendStatus(response.ok ? 'sent' : 'error');
      // The user might have just verified in another tab — refetch.
      await refreshUser();
    } catch {
      setResendStatus('error');
    } finally {
      setResending(false);
    }
  }, [user?.email, refreshUser]);

  // Don't render until we know whether to. ``email_verified`` is the soft
  // gate per Phase 4 — show the banner if it's literally false.
  if (!user || user.email_verified !== false) return null;
  if (dismissed) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { borderColor: c.border, backgroundColor: c.surfaceSunken ?? c.surface },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: c.text }]}>Verify your email</Text>
          <Text style={[styles.body, { color: c.textMuted }]}>
            We sent a verification link to {user.email}. You can keep using
            MyEtAl while you wait.
          </Text>
          {resendStatus === 'sent' ? (
            <Text style={[styles.statusGood, { color: c.text }]}>
              Verification email sent.
            </Text>
          ) : null}
          {resendStatus === 'error' ? (
            <Text style={[styles.statusBad, { color: '#B00020' }]}>
              Couldn&apos;t resend right now — try again later.
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss verify email banner"
          onPress={handleDismiss}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="close" size={18} color={c.textMuted} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={handleResend}
          disabled={resending}
          style={({ pressed }) => [
            styles.resendBtn,
            {
              borderColor: c.border,
              opacity: resending ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.resendText, { color: c.text }]}>
            {resending ? 'Sending…' : 'Resend email'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 18 },
  statusGood: { fontSize: 12, marginTop: 4 },
  statusBad: { fontSize: 12, marginTop: 4 },
  closeBtn: { padding: 4 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  resendBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resendText: { fontSize: 13, fontWeight: '500' },
});
