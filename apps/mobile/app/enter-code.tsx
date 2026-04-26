import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function EnterCodeScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <Text style={[styles.placeholder, { color: c.textMuted }]}>Code entry — coming next</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  placeholder: { fontSize: 16 },
});
