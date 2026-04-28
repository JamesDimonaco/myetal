import { router } from 'expo-router';
import { useState } from 'react';
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

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

type Mode = 'signin' | 'signup';

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
 * Real sign-in screen. Toggles between Sign In and Register, handles email +
 * password (zod-validated), and offers GitHub and Google OAuth. ORCID is
 * visible but disabled with a "Coming soon" subtitle.
 *
 * OAuth flow (dev): see useAuth.signInWithGitHub / signInWithGoogle for the
 * rationale. Backend lacks Universal Links wiring, so we open the browser to
 * platform=devjson and the user pastes the resulting JSON into the debug
 * input below the OAuth button. This shortcut goes away once the EAS
 * dev-build agent ships the /auth/mobile-finish deep-link handler.
 */
export default function SignInScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { signIn, signUp, signInWithGitHub, signInWithGoogle, consumeDevJsonTokens } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub devjson manual-paste UI
  const [showGithubPaste, setShowGithubPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

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
        setError(err.detail);
      } else {
        setError('Network error — try again');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGithub = async () => {
    setError(null);
    try {
      await signInWithGitHub();
      goToDashboard();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub sign-in failed';
      if (msg.startsWith('github_devjson_manual')) {
        // Expected: the in-app browser landed on the JSON page. Surface the
        // paste UI so the user can complete the flow.
        setShowGithubPaste(true);
      } else if (msg === 'github_oauth_cancel' || msg === 'github_oauth_dismiss') {
        // user backed out — silent
      } else {
        setError(msg);
      }
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await signInWithGoogle();
      goToDashboard();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      if (msg.startsWith('google_devjson_manual')) {
        setShowGithubPaste(true);
      } else if (msg === 'google_oauth_cancel' || msg === 'google_oauth_dismiss') {
        // user backed out — silent
      } else {
        setError(msg);
      }
    }
  };

  const handleConsumePaste = async () => {
    setPasteError(null);
    try {
      await consumeDevJsonTokens(pasteValue);
      goToDashboard();
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Could not parse');
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
              onPress={handleGoogle}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.providerText, { color: c.text }]}>
                Continue with Google
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleGithub}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.providerText, { color: c.text }]}>
                Continue with GitHub
              </Text>
            </Pressable>

            <View
              style={[
                styles.providerButton,
                {
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  opacity: 0.55,
                },
              ]}
            >
              <Text style={[styles.providerText, { color: c.text }]}>
                Continue with ORCID
              </Text>
              <Text style={[styles.providerSub, { color: c.textMuted }]}>
                Coming soon
              </Text>
            </View>
          </View>

          {showGithubPaste ? (
            <View style={[styles.pasteBox, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Text style={[styles.pasteTitle, { color: c.text }]}>Finish GitHub sign-in</Text>
              <Text style={[styles.pasteHint, { color: c.textMuted }]}>
                The browser is showing a JSON response. Copy the entire body and
                paste it here. (Dev shortcut — Universal Links land soon.)
              </Text>
              <TextInput
                value={pasteValue}
                onChangeText={setPasteValue}
                placeholder='{"access_token":"...","refresh_token":"..."}'
                placeholderTextColor={c.textMuted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.pasteInput,
                  { color: c.text, borderColor: c.border, backgroundColor: c.background },
                ]}
              />
              {pasteError ? (
                <Text style={[styles.error, { color: '#B00020' }]}>{pasteError}</Text>
              ) : null}
              <Pressable
                onPress={handleConsumePaste}
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.primaryText, { color: c.background }]}>
                  Use these tokens
                </Text>
              </Pressable>
            </View>
          ) : null}

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
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@university.edu"
              placeholderTextColor={c.textMuted}
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.textMuted }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
              placeholderTextColor={c.textMuted}
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
  providerSub: { fontSize: 12, marginTop: 2 },

  pasteBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  pasteTitle: { fontSize: 15, fontWeight: '600' },
  pasteHint: { fontSize: 13, lineHeight: 18 },
  pasteInput: {
    minHeight: 90,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
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
