import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { api, API_BASE_URL } from '@/lib/api';

WebBrowser.maybeCompleteAuthSession();

interface MeResponse {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * Sign-in placeholder + a working "Sign in with GitHub (dev test)" button so
 * James can verify the OAuth pipeline end-to-end before the auth agent ships
 * the real flow. ORCID/Google/Email-password buttons stay disabled until
 * credentials land + the auth agent's branch merges.
 */
export default function SignInScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const [loading, setLoading] = useState(false);

  const handleGitHubTest = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const returnUrl = Linking.createURL('/auth-finish');
      const startUrl =
        `${API_BASE_URL}/auth/github/start` +
        `?platform=devjson` +
        `&mobile_redirect=${encodeURIComponent(returnUrl)}` +
        `&return_to=/`;

      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);

      if (result.type !== 'success') {
        // user cancelled or browser was dismissed
        return;
      }

      const url = new URL(result.url);
      const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
      const accessToken = fragment.get('access_token');
      if (!accessToken) {
        Alert.alert('Auth failed', 'No access_token in callback URL.');
        return;
      }

      const me = await api<MeResponse>('/auth/me', { auth: accessToken });
      Alert.alert(
        'Signed in!',
        `Hello ${me.name ?? me.email ?? 'researcher'}\n\n` +
          `id: ${me.id}\n\n` +
          `(This is a dev test — the auth agent's branch will replace this with persistent token storage + a real authed flow.)`,
      );
    } catch (e) {
      Alert.alert('Auth error', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.body}>
        <Text style={[styles.heading, { color: c.text }]}>Create your collection</Text>
        <Text style={[styles.subhead, { color: c.textMuted }]}>
          Sign in to publish your own papers and generate QR codes for posters,
          slides, and CV pages.
        </Text>

        <View style={styles.providerStack}>
          {/* Working dev-test button for GitHub */}
          <Pressable
            onPress={handleGitHubTest}
            disabled={loading}
            style={({ pressed }) => [
              styles.providerButton,
              {
                borderColor: c.text,
                backgroundColor: c.text,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[styles.providerText, { color: c.background }]}>
                Continue with GitHub  ·  dev test
              </Text>
            )}
          </Pressable>

          {/* Disabled placeholders */}
          {(['ORCID', 'Google'] as const).map((provider) => (
            <Pressable
              key={provider}
              disabled
              style={[
                styles.providerButton,
                { borderColor: c.border, backgroundColor: c.surface, opacity: 0.6 },
              ]}
            >
              <Text style={[styles.providerText, { color: c.text }]}>
                Continue with {provider}  ·  coming soon
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.disclosure, { color: c.textMuted }]}>
          GitHub is wired up for dev testing only — tokens land in an alert,
          they aren't persisted yet. The auth agent's branch will add proper
          token storage, refresh, and the dashboard. ORCID and Google land
          when their credentials do.
        </Text>
      </View>

      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.dismiss,
          { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.dismissText, { color: c.text }]}>Back</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  body: { flex: 1, paddingTop: Spacing.lg },
  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  subhead: { fontSize: 16, marginTop: Spacing.sm, lineHeight: 23 },
  providerStack: { gap: Spacing.sm, marginTop: Spacing.xl },
  providerButton: {
    paddingVertical: 16,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  providerText: { fontSize: 16, fontWeight: '500' },
  disclosure: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.xl,
  },
  dismiss: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
  },
  dismissText: { fontSize: 17, fontWeight: '600' },
});
