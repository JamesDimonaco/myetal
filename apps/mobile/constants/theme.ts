/**
 * Ceteris design tokens. Paper-and-ink palette: warm off-white surface,
 * dark ink text, single deep teal accent. Iterate freely; everything is
 * consumed via the `Colors` object so changes here propagate.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1A1A1A',
    textMuted: '#666666',
    background: '#FAFAF7',
    surface: '#FFFFFF',
    border: '#E5E5E0',
    tint: '#1A1A1A',
    accent: '#0E4145',
    icon: '#666666',
  },
  dark: {
    text: '#F5F5F2',
    textMuted: '#A0A0A0',
    background: '#0F0F10',
    surface: '#1C1C1E',
    border: '#2A2A2C',
    tint: '#F5F5F2',
    accent: '#5BAEB3',
    icon: '#A0A0A0',
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
});
