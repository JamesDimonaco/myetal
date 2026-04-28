import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
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
import { Colors, Fonts, Motion, Radius, Shadows, Spacing } from '@/constants/theme';
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
 * https://myetal.app/c/{code} URL — so when someone scans this with another
 * phone, Universal Links bounce them straight into the app.
 *
 * Vibe: celebratory. The card scales in with a soft spring, the QR sits
 * inside a rounded "paper" tile with a subtle teal halo that pulses,
 * and a Share / Done action row lives at the bottom.
 */
export function QrModal({ visible, onClose, shortCode, collectionName }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const qrUrl = `${API_BASE_URL}/public/c/${shortCode}/qr.png`;
  const shareUrl = `https://myetal.app/c/${shortCode}`;
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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

  const handleCopyCode = async () => {
    haptics.tap();
    await Clipboard.setStringAsync(shortCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleCopyLink = async () => {
    haptics.tap();
    await Clipboard.setStringAsync(shareUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

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

            {/* Short code + URL */}
            <View style={styles.codeSection}>
              <View style={styles.codeRow}>
                <Text
                  style={[
                    styles.shortCode,
                    { color: c.text, fontFamily: Fonts.mono },
                  ]}
                  selectable
                >
                  {shortCode}
                </Text>
                <Pressable
                  onPress={handleCopyCode}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Copy code"
                  style={({ pressed }) => [
                    styles.copyBtn,
                    {
                      backgroundColor: c.surfaceSunken,
                      borderColor: c.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={codeCopied ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color={codeCopied ? c.success : c.text}
                  />
                  <Text
                    style={[
                      styles.copyBtnText,
                      { color: codeCopied ? c.success : c.text },
                    ]}
                  >
                    {codeCopied ? 'Copied' : 'Copy code'}
                  </Text>
                </Pressable>
              </View>
              <Pressable onPress={handleCopyLink} hitSlop={4}>
                <View style={styles.urlRow}>
                  <Ionicons name="link" size={13} color={c.textMuted} />
                  <Text style={[styles.urlText, { color: c.textMuted }]}>
                    myetal.app/c/{shortCode}
                  </Text>
                  <Ionicons
                    name={linkCopied ? 'checkmark' : 'copy-outline'}
                    size={13}
                    color={linkCopied ? c.success : c.textSubtle}
                  />
                </View>
              </Pressable>
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

  codeSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  shortCode: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  urlText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },

  actions: {
    gap: Spacing.sm,
  },
});
