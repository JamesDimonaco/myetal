import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Non-blocking bottom sheet consent modal shown on first launch.
 * The app is visible behind the semi-transparent overlay.
 */
export function AnalyticsConsent({ onAccept, onDecline }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
          },
          Shadows.lg,
        ]}
      >
        <View style={styles.header}>
          <Ionicons name="analytics-outline" size={24} color={c.accent} />
          <Text style={[styles.title, { color: c.text }]}>
            Help improve MyEtAl
          </Text>
        </View>

        <Text style={[styles.body, { color: c.textMuted }]}>
          We use anonymous analytics and error tracking to improve the app. No
          personal data is shared with third parties.
        </Text>

        <View style={styles.buttons}>
          <Pressable
            onPress={onDecline}
            style={({ pressed }) => [
              styles.button,
              styles.declineButton,
              {
                borderColor: c.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Decline analytics"
          >
            <Text style={[styles.declineText, { color: c.textMuted }]}>
              No thanks
            </Text>
          </Pressable>

          <Pressable
            onPress={onAccept}
            style={({ pressed }) => [
              styles.button,
              styles.acceptButton,
              {
                backgroundColor: c.text,
                opacity: pressed ? 0.7 : 1,
              },
              Shadows.sm,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Accept analytics"
          >
            <Text style={[styles.acceptText, { color: c.background }]}>
              Accept
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    zIndex: 9999,
  },
  sheet: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xxl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  declineText: {
    fontSize: 16,
    fontWeight: '500',
  },
  acceptButton: {},
  acceptText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
