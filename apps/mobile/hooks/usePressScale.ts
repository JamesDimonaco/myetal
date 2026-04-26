/**
 * Spring-driven press scale for any Pressable. Returns:
 *   - `style` to spread on an Animated.View
 *   - `onPressIn` / `onPressOut` handlers to wire onto the Pressable
 *
 * Usage:
 *   const press = usePressScale();
 *   <Pressable onPressIn={press.onPressIn} onPressOut={press.onPressOut} ...>
 *     <Animated.View style={[styles.btn, press.style]}>...</Animated.View>
 *   </Pressable>
 *
 * Set `to` to control how far it shrinks. Default 0.97 reads as a confident
 * tactile press without feeling sluggish.
 */
import { useCallback } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

export function usePressScale(to = 0.97) {
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    scale.value = withSpring(to, Motion.springSnappy);
  }, [scale, to]);

  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, Motion.spring);
  }, [scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { style, onPressIn, onPressOut };
}
