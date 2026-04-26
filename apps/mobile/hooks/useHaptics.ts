/**
 * Centralised haptics vocabulary. Returned as a stable object so callers can
 * destructure once and call free-standing in handlers.
 *
 *   tap()       — secondary buttons, list-item taps (light impact)
 *   tapStrong() — primary CTA presses (medium impact)
 *   selection() — chip / picker / character entry — very subtle
 *   success()   — QR scan landed, code accepted, share completed
 *   warn()      — invalid input, soft errors
 *   error()     — hard failures (rare)
 *
 * No-ops on web. All calls are fire-and-forget; promise rejection is swallowed
 * so a denied permission or unsupported device never throws.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

const noop = () => {};

const impl = enabled
  ? {
      tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop),
      tapStrong: () =>
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(noop),
      selection: () => Haptics.selectionAsync().catch(noop),
      success: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          noop,
        ),
      warn: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          noop,
        ),
      error: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          noop,
        ),
    }
  : {
      tap: noop,
      tapStrong: noop,
      selection: noop,
      success: noop,
      warn: noop,
      error: noop,
    };

export function useHaptics() {
  return impl;
}
