import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ScanReticle } from '@/components/scan-reticle';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHaptics } from '@/hooks/useHaptics';
import { extractShortCode } from '@/lib/short-code';

export default function ScanScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const haptics = useHaptics();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  // The barcode-scanned callback can fire many times in quick succession
  // before the screen unmounts; this ref ensures we navigate at most once.
  const handledRef = useRef(false);

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      if (handledRef.current) return;
      const code = extractShortCode(data);
      if (!code) return;
      handledRef.current = true;
      setLocked(true);
      haptics.success();
      // Slight delay so the user perceives the lock animation + buzz
      setTimeout(() => router.replace(`/c/${code}`), 280);
    },
    [haptics],
  );

  if (!permission) {
    // First render before the permission state has been resolved
    return <View style={[styles.fill, { backgroundColor: c.background }]} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
        <View style={styles.permissionBody}>
          <View
            style={[
              styles.permissionIconWrap,
              { backgroundColor: c.accentSoft },
            ]}
          >
            <Ionicons name="camera-outline" size={28} color={c.accent} />
          </View>
          <Text style={[styles.permissionTitle, { color: c.text }]}>
            Camera access needed
          </Text>
          <Text style={[styles.permissionBodyText, { color: c.textMuted }]}>
            MyEtAl uses the camera only to scan QR codes from posters and slides.
            Nothing is recorded, nothing leaves your device.
          </Text>
        </View>
        <View style={styles.permissionActions}>
          {permission.canAskAgain ? (
            <Button
              label="Allow camera"
              icon="camera"
              variant="primary"
              onPress={async () => {
                haptics.tap();
                await requestPermission();
              }}
            />
          ) : (
            <Button
              label="Open Settings"
              icon="settings-outline"
              variant="primary"
              onPress={() => {
                haptics.tap();
                Linking.openSettings();
              }}
            />
          )}

          <Link href="/enter-code" asChild>
            <Button label="Enter a code instead" icon="keypad-outline" variant="secondary" />
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={locked ? undefined : handleScanned}
      />

      {/* Vignette helps the reticle pop out of busy real-world backgrounds */}
      <View pointerEvents="none" style={styles.vignette} />

      {/* Reticle + hint overlay */}
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.reticleSpacer} />

        <Animated.View entering={FadeIn.duration(300)}>
          <ScanReticle size={260} state={locked ? 'locked' : 'idle'} />
        </Animated.View>

        <Animated.Text
          entering={FadeIn.duration(400).delay(120)}
          style={styles.hint}
        >
          {locked ? 'Got it — opening' : 'Point at a MyEtAl QR'}
        </Animated.Text>

        <View style={styles.fallbackWrap}>
          <Link href="/enter-code" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Enter code instead"
              hitSlop={12}
              onPress={() => haptics.tap()}
              style={({ pressed }) => [
                styles.fallbackChip,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="keypad-outline" size={16} color="rgba(255,255,255,0.95)" />
              <Text style={styles.fallbackChipText}>Enter code instead</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },

  // ---- permission UI
  permissionBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  permissionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  permissionTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: Spacing.sm,
  },
  permissionBodyText: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 360,
  },
  permissionActions: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // ---- camera overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // Subtle radial dim — RN can't do real radial gradients without a lib,
    // so we cheat with a translucent black + the reticle stroke does the work.
    // Keep this in case we add expo-linear-gradient later.
  },
  reticleSpacer: { flex: 1 },
  hint: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    marginTop: Spacing.lg,
    fontWeight: '500',
    letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  fallbackWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xxl,
  },
  fallbackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  fallbackChipText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
