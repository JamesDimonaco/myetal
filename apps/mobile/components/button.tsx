/**
 * Pressable button with built-in:
 *   - Spring press-scale (usePressScale)
 *   - Haptic feedback (light for secondary, medium for primary)
 *   - Optional leading Ionicons icon
 *   - Loading state (replaces label with ActivityIndicator)
 *   - Native shadow (primary only)
 *
 * Three visual variants:
 *   primary    — filled with c.text on c.background, ink-on-paper
 *   secondary  — outlined, hairline-strong border
 *   ghost      — text-only with optional underline; for footer/links
 */
import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { usePressScale } from '@/hooks/usePressScale';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Props {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  hapticOnPress?: boolean;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconPosition = 'leading',
  disabled = false,
  loading = false,
  fullWidth = true,
  hapticOnPress = true,
  accessibilityLabel,
}: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(variant === 'ghost' ? 0.95 : 0.97);

  const inert = disabled || loading;

  const handlePress = () => {
    if (inert) return;
    if (hapticOnPress) {
      if (variant === 'primary') haptics.tapStrong();
      else haptics.tap();
    }
    onPress?.();
  };

  const palette = paletteFor(variant, c, inert);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={fullWidth ? undefined : styles.fitContent}
    >
      <Animated.View
        style={[
          styles.base,
          variant === 'ghost' ? styles.ghost : styles.padded,
          {
            backgroundColor: palette.bg,
            borderColor: palette.border,
            borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 4 : 0,
          },
          variant === 'primary' && !inert ? Shadows.md : null,
          press.style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <View style={styles.row}>
            {icon && iconPosition === 'leading' ? (
              <Ionicons
                name={icon}
                size={variant === 'ghost' ? 16 : 18}
                color={palette.fg}
                style={styles.leading}
              />
            ) : null}
            <Text
              style={[
                variant === 'ghost' ? styles.labelGhost : styles.label,
                { color: palette.fg },
              ]}
            >
              {label}
            </Text>
            {icon && iconPosition === 'trailing' ? (
              <Ionicons
                name={icon}
                size={variant === 'ghost' ? 16 : 18}
                color={palette.fg}
                style={styles.trailing}
              />
            ) : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

function paletteFor(
  variant: 'primary' | 'secondary' | 'ghost',
  c: typeof Colors.light,
  inert: boolean,
): { bg: string; fg: string; border: string } {
  if (variant === 'primary') {
    return {
      bg: inert ? c.border : c.text,
      fg: inert ? c.textSubtle : c.background,
      border: 'transparent',
    };
  }
  if (variant === 'secondary') {
    return {
      bg: 'transparent',
      fg: inert ? c.textSubtle : c.text,
      border: inert ? c.border : c.text,
    };
  }
  // ghost
  return {
    bg: 'transparent',
    fg: inert ? c.textSubtle : c.textMuted,
    border: 'transparent',
  };
}

/** Convenience: an icon-only round button. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'secondary',
  size = 44,
}: {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  variant?: 'primary' | 'secondary';
  size?: number;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const press = usePressScale(0.9);

  const palette = paletteFor(variant, c, false);

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: palette.bg,
            borderColor: palette.border,
            borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 3 : 0,
            alignItems: 'center',
            justifyContent: 'center',
          },
          variant === 'primary' ? Shadows.sm : null,
          press.style,
        ]}
      >
        <Ionicons name={icon} size={Math.round(size * 0.45)} color={palette.fg} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fitContent: { alignSelf: 'flex-start' },
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padded: {
    paddingVertical: 17,
    paddingHorizontal: Spacing.lg,
    minHeight: 56,
  },
  ghost: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  leading: {
    marginRight: 2,
  },
  trailing: {
    marginLeft: 2,
  },
  label: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  labelGhost: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0,
  },
});
