import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { GitHubIcon } from '@/components/github-icon';
import { GoogleIcon } from '@/components/google-icon';
import { OrcidIcon } from '@/components/orcid-icon';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

type Mode = 'signin' | 'signup';

/**
 * Map raw error codes / messages to a friendly sentence — mirrors
 * ``apps/web/src/app/sign-in/page.tsx::describeError`` so the sign-in
 * UX is consistent across web and mobile. Unknown codes fall through
 * to the raw message (better than silent).
 *
 * Sources of error strings we encounter:
 * * ``ApiError.detail`` from ``readBetterAuthError`` (BA REST body
 *   ``message``/``code``) — see ``hooks/useAuth.ts``.
 * * ``Error.message`` thrown from ``runOAuthFlow`` for OAuth flows;
 *   the bounce page passes ``?error=<code>`` through which becomes
 *   the message.
 */
const ORCID_HIJACK_ERROR_CODES = new Set([
  'orcid_already_linked',
  'OrcidIdAlreadyLinkedError',
]);

function describeAuthError(raw: string): string {
  const code = raw.trim();
  if (!code) return 'Something went wrong — try again.';
  if (ORCID_HIJACK_ERROR_CODES.has(code)) {
    return 'This ORCID iD is already linked to another account. Sign in with that account instead.';
  }
  switch (code) {
    case 'invalid_credentials':
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Email or password is incorrect.';
    case 'user_already_exists':
    case 'USER_ALREADY_EXISTS':
    case 'email_already_exists':
      return 'An account with that email already exists.';
    case 'account_not_linked':
    case 'ACCOUNT_NOT_LINKED':
      return 'That email is already in use under a different sign-in method.';
    case 'no_session':
      return "We couldn't complete sign-in — please try again.";
    case 'jwt_unavailable':
      return 'Sign-in succeeded but the session token was unavailable. Try again.';
    case 'unknown_error':
      return 'Something went wrong — try again.';
    default:
      // BA's snake_case codes read poorly raw; humanise lightly.
      // Anything that already looks like a sentence (has a space)
      // passes through untouched.
      return code.includes(' ') ? code : code.replace(/_/g, ' ');
  }
}

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password required'),
});

const signUpSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters').max(128),
  name: z.string().trim().max(120).optional(),
});

/**
 * Sign-in / sign-up screen — Better Auth REST endpoints (Phase 4 cutover).
 *
 * OAuth uses ``WebBrowser.openAuthSessionAsync`` against the web app's
 * ``/auth/mobile-bounce`` page, which receives the BA session, fetches a
 * JWT, and deep-links back to ``myetal://auth/callback?token=...``. The
 * legacy "manual paste" dev-only JSON fallback is gone — it was a workaround
 * for the previous custom OAuth handler that didn't deep-link reliably.
 */
export default function SignInScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { signIn, signUp, signInWithGitHub, signInWithGoogle, signInWithOrcid } =
    useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks which OAuth provider is currently in-flight so we can
  // disable the others and show "Redirecting…" copy. Mirrors the web
  // pattern in apps/web/src/app/sign-in/oauth-buttons.tsx.
  const [pendingProvider, setPendingProvider] = useState<
    'google' | 'github' | 'orcid' | null
  >(null);

  // Refs for chaining returnKey from email → password → submit, so users
  // can complete the form without lifting their thumb to "Done"/"Submit".
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const goToDashboard = () => {
    // Dismiss the sign-in modal. The (authed) layout detects isAuthed
    // and renders the tab shell automatically — we don't need to navigate
    // to it explicitly. dismissAll() clears the modal stack so the user
    // can't swipe back to the sign-in page.
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace('/(authed)/dashboard');
  };

  const handleSubmit = async () => {
    setError(null);
    const schema = mode === 'signin' ? signInSchema : signUpSchema;
    const parsed = schema.safeParse(
      mode === 'signin'
        ? { email, password }
        : { email, password, name: name.trim() || undefined },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(parsed.data as { email: string; password: string });
      } else {
        await signUp(parsed.data as { email: string; password: string; name?: string });
      }
      goToDashboard();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(describeAuthError(err.detail));
      } else {
        setError('Network error — try again');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleProvider = async (
    fn: () => Promise<unknown>,
    providerLabel: 'google' | 'github' | 'orcid',
  ) => {
    setError(null);
    setPendingProvider(providerLabel);
    try {
      await fn();
      goToDashboard();
    } catch (err) {
      const msg = err instanceof Error ? err.message : `${providerLabel} sign-in failed`;
      // Cancel/dismiss is intentional user action — stay quiet.
      if (msg.endsWith('_oauth_cancel') || msg.endsWith('_oauth_dismiss')) return;
      setError(describeAuthError(msg));
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.heading, { color: c.text }]}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={[styles.subhead, { color: c.textMuted }]}>
            {mode === 'signin'
              ? 'Sign in to publish papers and generate QR codes.'
              : 'Register to start sharing your work via QR.'}
          </Text>

          {/* OAuth providers */}
          <View style={styles.providerStack}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pendingProvider !== null }}
              onPress={() => handleProvider(signInWithGoogle, 'google')}
              disabled={pendingProvider !== null}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity:
                    pendingProvider !== null && pendingProvider !== 'google'
                      ? 0.5
                      : pressed
                        ? 0.7
                        : 1,
                },
              ]}
            >
              <View style={styles.providerRow}>
                <GoogleIcon size={18} />
                <Text style={[styles.providerText, { color: c.text }]}>
                  {pendingProvider === 'google' ? 'Redirecting…' : 'Continue with Google'}
                </Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pendingProvider !== null }}
              onPress={() => handleProvider(signInWithGitHub, 'github')}
              disabled={pendingProvider !== null}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity:
                    pendingProvider !== null && pendingProvider !== 'github'
                      ? 0.5
                      : pressed
                        ? 0.7
                        : 1,
                },
              ]}
            >
              <View style={styles.providerRow}>
                <GitHubIcon size={18} color={c.text} />
                <Text style={[styles.providerText, { color: c.text }]}>
                  {pendingProvider === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
                </Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pendingProvider !== null }}
              onPress={() => handleProvider(signInWithOrcid, 'orcid')}
              disabled={pendingProvider !== null}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity:
                    pendingProvider !== null && pendingProvider !== 'orcid'
                      ? 0.5
                      : pressed
                        ? 0.7
                        : 1,
                },
              ]}
            >
              <View style={styles.providerRow}>
                <OrcidIcon size={18} />
                <Text style={[styles.providerText, { color: c.text }]}>
                  {pendingProvider === 'orcid' ? 'Redirecting…' : 'Continue with ORCID'}
                </Text>
              </View>
            </Pressable>
            <Text style={[styles.providerCaption, { color: c.textMuted }]}>
              Already signed up with Google or GitHub? Add your ORCID iD on
              your profile instead — signing in with ORCID will create a
              separate account.
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          {/* Email/password form */}
          {mode === 'signup' ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: c.textMuted }]}>Name (optional)</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                placeholder="Ada Lovelace"
                placeholderTextColor={c.textMuted}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                submitBehavior="submit"
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Email</Text>
            <TextInput
              ref={emailRef}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@university.edu"
              placeholderTextColor={c.textMuted}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Password</Text>
            <TextInput
              ref={passwordRef}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
              placeholderTextColor={c.textMuted}
              returnKeyType={mode === 'signin' ? 'go' : 'done'}
              onSubmitEditing={() => {
                if (!submitting) handleSubmit();
              }}
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            />
          </View>

          {error ? <Text style={[styles.error, { color: '#B00020' }]}>{error}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primary,
              {
                backgroundColor: c.text,
                opacity: submitting ? 0.6 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[styles.primaryText, { color: c.background }]}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
            }}
            hitSlop={12}
            style={styles.toggle}
          >
            <Text style={[styles.toggleText, { color: c.textMuted }]}>
              {mode === 'signin'
                ? "Don't have an account? Register"
                : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </ScrollView>

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.dismissText, { color: c.textMuted }]}>Back</Text>
        </Pressable>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.lg },
  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  subhead: { fontSize: 15, marginTop: Spacing.sm, lineHeight: 22 },

  providerStack: { gap: Spacing.sm, marginTop: Spacing.xl },
  providerButton: {
    paddingVertical: 16,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  providerText: { fontSize: 16, fontWeight: '500' },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  providerCaption: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.lg,
  },

  field: { marginBottom: Spacing.md },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: Spacing.xs },
  input: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },

  error: { fontSize: 14, marginBottom: Spacing.sm },

  primary: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  primaryText: { fontSize: 16, fontWeight: '600' },

  toggle: { paddingVertical: Spacing.md, alignItems: 'center' },
  toggleText: { fontSize: 14 },

  dismiss: { alignItems: 'center', paddingVertical: Spacing.md },
  dismissText: { fontSize: 14 },
});
