import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';

const VALID_CODE_REGEX = /^[A-Za-z0-9]{4,16}$/;

export default function EnterCodeScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const lastLenRef = useRef(0);
  const shake = useSharedValue(0);

  const trimmed = code.trim();
  const canSubmit = VALID_CODE_REGEX.test(trimmed);

  // Subtle haptic blip on each typed character — OTP-style satisfaction
  useEffect(() => {
    const len = trimmed.length;
    if (len > lastLenRef.current) haptics.selection();
    lastLenRef.current = len;
  }, [trimmed, haptics]);

  // Auto-focus on mount so the keyboard slides in immediately
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, []);

  const handleOpen = () => {
    if (!canSubmit) {
      // Shake the input + warning haptic when user pokes the disabled CTA
      haptics.warn();
      cancelAnimation(shake);
      shake.value = withSequence(
        withTiming(-8, { duration: 60, easing: Easing.out(Easing.quad) }),
        withTiming(8, { duration: 60 }),
        withTiming(-6, { duration: 60 }),
        withTiming(6, { duration: 60 }),
        withTiming(0, { duration: 60 }),
      );
      return;
    }
    haptics.success();
    router.push(`/c/${trimmed}`);
  };

  const inputAnim = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

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
          <Animated.View
            entering={FadeInUp.duration(360)}
            style={[styles.iconWrap, { backgroundColor: c.accentSoft }]}
          >
            <Ionicons name="keypad-outline" size={26} color={c.accent} />
          </Animated.View>

          <Animated.Text
            entering={FadeInUp.duration(360).delay(60)}
            style={[styles.heading, { color: c.text }]}
          >
            Enter a collection code
          </Animated.Text>

          <Animated.Text
            entering={FadeInUp.duration(360).delay(120)}
            style={[styles.subhead, { color: c.textMuted }]}
          >
            Codes are 4–16 letters and numbers, like{' '}
            <Text style={{ fontWeight: '700', color: c.text }}>Kp7vRq</Text>.
          </Animated.Text>

          <Pressable onPress={() => inputRef.current?.focus()}>
            <Animated.View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: c.surface,
                  borderColor: trimmed.length > 0 ? c.accent : c.border,
                },
                inputAnim,
              ]}
            >
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={setCode}
                placeholder="······"
                placeholderTextColor={c.textSubtle}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                maxLength={16}
                returnKeyType="go"
                onSubmitEditing={handleOpen}
                style={[styles.input, { color: c.text }]}
                accessibilityLabel="Collection code"
              />
            </Animated.View>
          </Pressable>

          <View style={styles.helperRow}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={c.textSubtle}
            />
            <Text style={[styles.helper, { color: c.textSubtle }]}>
              Codes are case-sensitive.
            </Text>
          </View>
        </View>

        <View style={styles.ctaWrap}>
          <Button
            label="Open collection"
            icon="arrow-forward"
            iconPosition="trailing"
            disabled={!canSubmit}
            onPress={handleOpen}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  body: { flex: 1, paddingTop: Spacing.lg },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 33,
  },
  subhead: {
    fontSize: 15,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  inputWrap: {
    marginTop: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    paddingVertical: Spacing.lg - 2,
    paddingHorizontal: Spacing.md,
  },
  input: {
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  helper: {
    fontSize: 12,
    fontWeight: '500',
  },
  ctaWrap: {
    paddingTop: Spacing.md,
  },
});
