/**
 * Camera viewfinder reticle. Four corner brackets + a sweeping scan line
 * — the scan line loops slowly while idle and locks/glows on detect.
 *
 * Pure presentational; the parent owns barcode handling and tells us
 * whether to render in `idle` or `locked` state.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';

interface Props {
  size?: number;
  state?: 'idle' | 'locked';
}

const STROKE = 3;
const CORNER = 28;

export function ScanReticle({ size = 240, state = 'idle' }: Props) {
  const sweep = useSharedValue(0);
  const lock = useSharedValue(0);

  useEffect(() => {
    if (state === 'locked') {
      cancelAnimation(sweep);
      lock.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      return;
    }
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    lock.value = withTiming(0, { duration: 200 });
    return () => {
      cancelAnimation(sweep);
    };
  }, [state, sweep, lock]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(sweep.value, [0, 1], [0, size - STROKE]) },
    ],
    opacity: interpolate(lock.value, [0, 1], [1, 0]),
  }));

  const frameStyle = useAnimatedStyle(() => {
    const lockColor = `rgba(125, 201, 205, ${interpolate(lock.value, [0, 1], [0, 1])})`;
    const idleColor = `rgba(255, 255, 255, ${interpolate(lock.value, [0, 1], [0.85, 0])})`;
    return {
      borderColor: lock.value > 0.5 ? lockColor : idleColor,
    };
  });

  // Corner brackets are absolutely positioned and inherit `frameStyle.borderColor`
  // by reading the same shared value via individual styles.
  const cornerColor = useAnimatedStyle(() => {
    const lockColor = `rgba(125, 201, 205, ${interpolate(lock.value, [0, 1], [0.95, 1])})`;
    const idleColor = `rgba(255, 255, 255, ${interpolate(lock.value, [0, 1], [0.95, 0])})`;
    return {
      borderColor: lock.value > 0.5 ? lockColor : idleColor,
    };
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      {/* The frame itself is invisible-bordered; the corners do the heavy lifting */}
      <Animated.View style={[styles.frame, { borderRadius: Radius.lg }, frameStyle]} />

      {/* Four corner brackets */}
      <Animated.View style={[styles.corner, styles.tl, cornerColor]} />
      <Animated.View style={[styles.corner, styles.tr, cornerColor]} />
      <Animated.View style={[styles.corner, styles.bl, cornerColor]} />
      <Animated.View style={[styles.corner, styles.br, cornerColor]} />

      {/* Sweeping scan line */}
      <Animated.View
        style={[
          styles.scanLine,
          { width: size - 16 },
          lineStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: STROKE,
    borderLeftWidth: STROKE,
    borderTopLeftRadius: Radius.md,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: STROKE,
    borderRightWidth: STROKE,
    borderTopRightRadius: Radius.md,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: STROKE,
    borderLeftWidth: STROKE,
    borderBottomLeftRadius: Radius.md,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: STROKE,
    borderRightWidth: STROKE,
    borderBottomRightRadius: Radius.md,
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 8,
    height: 2,
    backgroundColor: 'rgba(125, 201, 205, 0.85)',
    shadowColor: '#7DC9CD',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
