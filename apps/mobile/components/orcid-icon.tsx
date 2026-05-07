/**
 * ORCID iD logo for React Native.
 *
 * NOTE: Web parity originally targeted `react-native-svg` so we could mirror
 * the official SVG path data exactly (the version after the `v48.4` removal,
 * with the white rectangle at `M86.3,186.2H70.9V79.1h15.4V186.2z`). That dep
 * is not currently installed in apps/mobile — the import-and-polish PR's
 * scope rule disallows adding new deps. Until SVG support lands we render an
 * approximation using pure RN primitives: ORCID brand green (#A6CE39) circle,
 * white "iD" text in a sans-serif, plus the small white dot above the "i".
 *
 * The colour tokens match the web component exactly so swapping in the real
 * SVG later is purely cosmetic (no caller changes needed). When `react-native-svg`
 * is added, replace the body of this component with the path data from
 * apps/web/src/components/orcid-icon.tsx.
 */
import { StyleSheet, Text, View } from 'react-native';

interface OrcidIconProps {
  size?: number;
}

export function OrcidIcon({ size = 16 }: OrcidIconProps) {
  // Inner type sized relative to the disc so the glyph reads at any size.
  const fontSize = Math.round(size * 0.6);
  const dotSize = Math.max(2, Math.round(size * 0.1));
  const dotOffset = Math.round(size * 0.14);

  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* The dot of the lower-case "i". Approximates the white circle in the
          official mark (path: M88.7,56.8 …). */}
      <View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            top: dotOffset,
            // Nudge left of centre to sit above the rendered "i".
            left: size / 2 - dotSize - Math.round(size * 0.08),
          },
        ]}
      />
      <Text
        style={[
          styles.label,
          {
            fontSize,
            lineHeight: fontSize * 1.05,
          },
        ]}
        allowFontScaling={false}
      >
        iD
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    backgroundColor: '#A6CE39',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '700',
    // Sans-serif to read like the geometric "iD" of the brand mark.
    includeFontPadding: false,
  },
});
