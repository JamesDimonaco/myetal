import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link, router } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { extractShortCode } from '@/lib/short-code';

export default function ScanScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const [permission, requestPermission] = useCameraPermissions();

  // The barcode-scanned callback can fire many times in quick succession
  // before the screen unmounts; this ref ensures we navigate at most once.
  const handledRef = useRef(false);

  const handleScanned = useCallback(({ data }: { data: string }) => {
    if (handledRef.current) return;
    const code = extractShortCode(data);
    if (!code) return;
    handledRef.current = true;
    router.replace(`/c/${code}`);
  }, []);

  if (!permission) {
    // First render before the permission state has been resolved
    return <View style={[styles.fill, { backgroundColor: c.background }]} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
        <View style={styles.permissionBody}>
          <Text style={[styles.permissionTitle, { color: c.text }]}>
            Camera access needed
          </Text>
          <Text style={[styles.permissionBodyText, { color: c.textMuted }]}>
            Ceteris uses the camera only to scan QR codes from posters and slides.
            Nothing is recorded.
          </Text>
        </View>
        <View style={styles.permissionActions}>
          {permission.canAskAgain ? (
            <Pressable
              onPress={requestPermission}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: c.background }]}>
                Allow camera
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: c.background }]}>
                Open Settings
              </Text>
            </Pressable>
          )}

          <Link href="/enter-code" asChild>
            <Pressable
              style={({ pressed }) => [
                styles.secondary,
                { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: c.text }]}>
                Enter a code instead
              </Text>
            </Pressable>
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
        onBarcodeScanned={handleScanned}
      />

      {/* Reticle + hint overlay; pointerEvents="box-none" so taps pass through */}
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.reticleSpacer} />
        <View style={styles.reticle} />
        <Text style={styles.hint}>Point at a Ceteris QR</Text>
        <View style={styles.fallbackWrap}>
          <Link href="/enter-code" asChild>
            <Pressable hitSlop={12}>
              <Text style={styles.fallbackText}>Enter code instead</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

const RETICLE_SIZE = 240;

const styles = StyleSheet.create({
  fill: { flex: 1 },

  // ---- permission UI
  permissionBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: Spacing.sm,
  },
  permissionBodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  permissionActions: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  primary: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '600' },
  secondary: {
    paddingVertical: 18,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 17, fontWeight: '600' },

  // ---- camera overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  reticleSpacer: { flex: 1 },
  reticle: {
    width: RETICLE_SIZE,
    height: RETICLE_SIZE,
    borderRadius: Radius.lg,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  hint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    marginTop: Spacing.md,
    fontWeight: '500',
  },
  fallbackWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xxl,
  },
  fallbackText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
