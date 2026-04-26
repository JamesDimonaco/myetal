import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
 */
export function QrModal({ visible, onClose, shortCode, collectionName }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const qrUrl = `${API_BASE_URL}/public/c/${shortCode}/qr.png`;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss QR code"
        onPress={onClose}
        style={styles.backdrop}
      >
        {/* Stop propagation: tapping the card itself shouldn't dismiss */}
        <Pressable
          accessibilityRole="none"
          onPress={(e) => e.stopPropagation()}
          style={[styles.card, { backgroundColor: c.surface }]}
        >
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {collectionName}
          </Text>

          <View style={styles.qrWrap}>
            <Image
              source={{ uri: qrUrl }}
              style={styles.qr}
              contentFit="contain"
              accessibilityLabel="QR code linking to this collection"
            />
          </View>

          <Text style={[styles.code, { color: c.textMuted }]}>{shortCode}</Text>
          <Text style={[styles.hint, { color: c.textMuted }]}>
            Show this to anyone with the Ceteris app — or any QR scanner.
          </Text>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.dismiss,
              { borderColor: c.text, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.dismissText, { color: c.text }]}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  qrWrap: {
    width: 240,
    height: 240,
    backgroundColor: '#FFFFFF',
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  qr: {
    width: '100%',
    height: '100%',
  },
  code: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: Spacing.lg,
  },
  dismiss: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 4,
  },
  dismissText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
