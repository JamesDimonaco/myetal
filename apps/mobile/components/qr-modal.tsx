import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Wordmark } from '@/components/wordmark';
import { Colors, Motion, Radius, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { API_BASE_URL } from '@/lib/api';

interface Props {
  visible: boolean;
  onClose: () => void;
  shortCode: string;
  collectionName: string;
}

/**
 * Full-screen modal that shows the public QR for a collection. The image is
 * served by the backend at /public/c/{code}/qr.png and embeds the canonical
 * https://ceteris.app/c/{code} URL — so when someone scans this with another
 * phone, Universal Links bounce them straight into the app.
 *
 * Vibe: celebratory. The card scales in with a soft spring, the QR sits
 * inside a rounded "paper" tile with a subtle teal halo that pulses once,
 * and the dismiss/share/copy actions live below as a real action row.
 */
export function QrModal({ visible, onClose, shortCode, collectionName }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const qrUrl = `${API_BASE_URL}/public/c/${shortCode}/qr.png`;
  const shareUrl = `https://ceteris.app/c/${shortCode}`;

  const cardScale = useSharedValue(0.92);
  const cardOpacity = useSharedValue(0);
  const halo = useSharedValue(0);

  // Drive enter / exit animation on `visible` toggle
  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, Motion.spring);
      cardOpacity.value = withTiming(1, Motion.base);

      // Halo: pulse once on open, then settle
      halo.value = 0;
      halo.value = withDelay(
        180,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }),
            withTiming(0.4, { duration: 900, easing: Easing.in(Easing.quad) }),
          ),
          -1,
          false,
        ),
      );
    } else {
      cardScale.value = withTiming(0.95, Motion.fast);
      cardOpacity.value = withTiming(0, Motion.fast);
      cancelAnimation(halo);
      halo.value = 0;
    }
  }, [visible, cardScale, cardOpacity, halo]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + halo.value * 0.32,
    transform: [{ scale: 1 + halo.value * 0.04 }],
  }));

  const handleShare = async () => {
    haptics.tapStrong();
    await Share.share({ message: shareUrl, title: collectionName });
  };

  const handleClose = () => {
    haptics.tap();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={handleClose}
      animationType="none"
      transparent
      statusBarTranslucent
    >
      {visible ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(180)}
          style={[styles.backdrop, { backgroundColor: c.overlay }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss QR code"
            onPress={handleClose}
            style={StyleSheet.absoluteFill}
          />

          <Animated.View
            style={[
              styles.card,
              { backgroundColor: c.surface },
              Shadows.xl,
              cardStyle,
            ]}
          >
            {/* Eyebrow */}
            <View style={styles.eyebrowRow}>
              <Wordmark size="sm" />
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={[styles.closeBtn, { backgroundColor: c.surfaceSunken }]}
              >
                <Ionicons name="close" size={18} color={c.text} />
              </Pressable>
            </View>

            <Text
              style={[styles.title, { color: c.text }]}
              numberOfLines={2}
            >
              {collectionName}
            </Text>
            <Text style={[styles.subtitle, { color: c.textMuted }]}>
              Anyone with a phone can scan this.
            </Text>

            {/* QR with halo */}
            <View style={styles.qrStack}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.halo,
                  { backgroundColor: c.accent },
                  haloStyle,
                ]}
              />
              <View
                style={[
                  styles.qrTile,
                  {
                    backgroundColor: '#FFFFFF',
                    borderColor: c.border,
                  },
                ]}
              >
                <Image
                  source={{ uri: qrUrl }}
                  style={styles.qr}
                  contentFit="contain"
                  accessibilityLabel="QR code linking to this collection"
                />
              </View>
            </View>

            {/* Code chip — visual reference for the destination URL */}
            <View
              style={[
                styles.codeChip,
                {
                  backgroundColor: c.surfaceSunken,
                  borderColor: c.border,
                },
              ]}
            >
              <Ionicons name="link" size={14} color={c.textMuted} />
              <Text style={[styles.codeChipText, { color: c.text }]}>
                ceteris.app/c/{shortCode}
              </Text>
            </View>

            {/* Action row */}
            <View style={styles.actions}>
              <Button
                label="Share link"
                icon="share-outline"
                variant="primary"
                onPress={handleShare}
              />
              <Button
                label="Done"
                variant="secondary"
                onPress={handleClose}
              />
            </View>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const QR_SIZE = 240;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg + 6,
    padding: Spacing.lg,
    alignItems: 'stretch',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 27,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },

  qrStack: {
    alignSelf: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    width: QR_SIZE + 24,
    height: QR_SIZE + 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: QR_SIZE + 36,
    height: QR_SIZE + 36,
    borderRadius: Radius.lg + 12,
    opacity: 0.2,
  },
  qrTile: {
    width: QR_SIZE + 16,
    height: QR_SIZE + 16,
    padding: Spacing.sm + 2,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qr: {
    width: QR_SIZE - 8,
    height: QR_SIZE - 8,
  },

  codeChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  codeChipText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },

  actions: {
    gap: Spacing.sm,
  },
});
