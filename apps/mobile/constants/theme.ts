/**
 * Ceteris design tokens. Paper-and-ink palette: warm off-white surface,
 * dark ink text, single deep teal accent. Iterate freely; everything is
 * consumed via the `Colors` object so changes here propagate.
 */

import { Platform, type ViewStyle } from 'react-native';

export const Colors = {
  light: {
    text: '#1A1A1A',
    textMuted: '#666666',
    textSubtle: '#8A8A85',
    background: '#FAFAF7',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSunken: '#F2F2EC',
    border: '#E5E5E0',
    borderStrong: '#CFCFC8',
    tint: '#1A1A1A',
    accent: '#0E4145',
    accentSoft: '#E2EEEF',
    accentText: '#0E4145',
    icon: '#666666',
    success: '#2F7D52',
    overlay: 'rgba(20, 20, 18, 0.55)',
  },
  dark: {
    text: '#F5F5F2',
    textMuted: '#A0A0A0',
    textSubtle: '#7A7A75',
    background: '#0F0F10',
    surface: '#1C1C1E',
    surfaceElevated: '#26262A',
    surfaceSunken: '#141416',
    border: '#2A2A2C',
    borderStrong: '#3A3A3E',
    tint: '#F5F5F2',
    accent: '#5BAEB3',
    accentSoft: '#1A2E30',
    accentText: '#7DC9CD',
    icon: '#A0A0A0',
    success: '#5FBF85',
    overlay: 'rgba(0, 0, 0, 0.7)',
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans:
      "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  },
})!;

/**
 * Type ramp — kept small, scholarly, with a serif option for the wordmark
 * and any "display" voice on hero copy.
 */
export const Type = {
  // Display serif — used for the Ceteris wordmark and large hero text
  display: {
    fontFamily: Fonts.serif,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -2,
    fontWeight: '500' as const,
  },
  hero: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1,
    fontWeight: '500' as const,
  },
  h1: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.5,
    fontWeight: '700' as const,
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    fontWeight: '700' as const,
  },
};

/**
 * Native shadows — pre-built so callers don't have to remember the
 * (iOS shadowColor + Android elevation) split. Spread into a style.
 */
type Shadow = Pick<
  ViewStyle,
  | 'shadowColor'
  | 'shadowOpacity'
  | 'shadowOffset'
  | 'shadowRadius'
  | 'elevation'
>;

const shadow = (
  opacity: number,
  radius: number,
  offsetY: number,
  elevation: number,
): Shadow => ({
  shadowColor: '#000000',
  shadowOpacity: opacity,
  shadowOffset: { width: 0, height: offsetY },
  shadowRadius: radius,
  elevation,
});

export const Shadows = {
  // Whisper — for resting cards on paper
  sm: shadow(0.05, 6, 1, 1),
  // Subtle lift — recently-viewed cards, share-item cards
  md: shadow(0.08, 12, 3, 3),
  // Floating — primary CTA, modal cards
  lg: shadow(0.18, 24, 8, 8),
  // Hero element — QR card in the modal
  xl: shadow(0.28, 36, 14, 14),
};

/**
 * Motion — single source of truth for animation feel. Reanimated reads
 * these via `withTiming(value, Motion.fast)` etc.
 */
export const Motion = {
  fast: { duration: 150 },
  base: { duration: 240 },
  slow: { duration: 380 },
  // For entrance animations — gentle ease-out
  enter: { duration: 320 },
  spring: { damping: 14, stiffness: 180, mass: 0.6 },
  springSnappy: { damping: 18, stiffness: 260, mass: 0.5 },
  springGentle: { damping: 20, stiffness: 120, mass: 0.8 },
};
