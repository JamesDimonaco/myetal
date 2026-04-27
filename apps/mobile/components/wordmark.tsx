/**
 * The MyEtAl wordmark. Serif type ("ui-serif" on iOS, Georgia on web,
 * platform serif on Android) with a hairline italic "paribus." underneath
 * to nod at *myetal paribus* — the academic shibboleth the brand is
 * named for. Tagline is optional; on the landing it gets the marker,
 * elsewhere (e.g. modals) we hide it.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
  size?: 'lg' | 'md' | 'sm';
  showTagline?: boolean;
  align?: 'left' | 'center';
}

export function Wordmark({ size = 'lg', showTagline = false, align = 'left' }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  const sz = SIZE[size];

  return (
    <View style={[styles.wrap, align === 'center' && styles.center]}>
      <Text
        style={[
          styles.mark,
          {
            color: c.text,
            fontFamily: Fonts.serif,
            fontSize: sz.mark,
            lineHeight: sz.mark * 1.02,
          },
        ]}
      >
        MyEtAl
      </Text>
      {showTagline ? (
        <Text
          style={[
            styles.paribus,
            {
              color: c.textMuted,
              fontFamily: Fonts.serif,
              fontSize: sz.paribus,
            },
          ]}
        >
          paribus.
        </Text>
      ) : null}
    </View>
  );
}

const SIZE = {
  lg: { mark: 64, paribus: 18 },
  md: { mark: 40, paribus: 14 },
  sm: { mark: 24, paribus: 11 },
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'column',
  },
  center: {
    alignItems: 'center',
  },
  mark: {
    fontWeight: '500',
    letterSpacing: -2,
  },
  paribus: {
    fontStyle: 'italic',
    fontWeight: '400',
    letterSpacing: 0,
    marginTop: -Spacing.xs,
    marginLeft: Spacing.xs,
  },
});
