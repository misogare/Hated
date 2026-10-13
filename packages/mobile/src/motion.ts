/**
 * Motion helpers. HateD animates a few big moments (the seal breaking, two
 * people meeting, a candle burning) and nothing else, and none of it runs for
 * someone who has asked their device for less motion.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Animated's native driver doesn't exist on the web build. */
export const NATIVE_DRIVER = Platform.OS !== 'web';

/** True when the person has turned on "reduce motion" (on the web, prefers-reduced-motion). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active) setReduced(value);
      },
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
