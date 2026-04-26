import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const VALID_CODE_REGEX = /^[A-Za-z0-9]{4,16}$/;

export default function EnterCodeScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const [code, setCode] = useState('');

  const trimmed = code.trim();
  const canSubmit = VALID_CODE_REGEX.test(trimmed);

  const handleOpen = () => {
    if (!canSubmit) return;
    router.push(`/c/${trimmed}`);
  };

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <Text style={[styles.heading, { color: c.text }]}>Enter a collection code</Text>
          <Text style={[styles.subhead, { color: c.textMuted }]}>
            Codes are 6 characters long, e.g. <Text style={{ fontWeight: '600' }}>Kp7vRq</Text>.
          </Text>

          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Code"
            placeholderTextColor={c.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            returnKeyType="go"
            onSubmitEditing={handleOpen}
            style={[
              styles.input,
              {
                color: c.text,
                backgroundColor: c.surface,
                borderColor: c.border,
              },
            ]}
            accessibilityLabel="Collection code"
          />
        </View>

        <Pressable
          onPress={handleOpen}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: canSubmit ? c.text : c.border,
              opacity: pressed && canSubmit ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.ctaText,
              { color: canSubmit ? c.background : c.textMuted },
            ]}
          >
            Open
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  body: { flex: 1, paddingTop: Spacing.lg },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subhead: {
    fontSize: 15,
    marginTop: Spacing.sm,
    lineHeight: 21,
  },
  input: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: 4,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    textAlign: 'center',
  },
  cta: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
