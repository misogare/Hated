import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { NATIVE_DRIVER, useReducedMotion } from '@/motion';
import { day, night, shadows } from '@/theme';

/** Where the circles overlap: peach and blush multiplied. */
const LENS = '#DF8A87';

interface MeetingCirclesProps {
  /** Diameter of each circle. */
  size: number;
  /**
   * `drift`: they lean toward each other and back, slowly (the welcome screen).
   * `meet`: they start apart and come together, then the spark lights (both said hello).
   */
  motion?: 'drift' | 'meet' | 'still';
  style?: StyleProp<ViewStyle>;
}

/**
 * The HateD mark: two people, overlapping, with a spark where they meet. The
 * overlap is drawn as its own shape (the right-hand circle clipped by the
 * left), because React Native can't blend colours the way CSS can.
 */
export function MeetingCircles({ size, motion = 'still', style }: MeetingCirclesProps) {
  const reduced = useReducedMotion();
  const animate = motion !== 'still' && !reduced;
  const apart = motion === 'meet' ? size * 0.42 : 14;
  const left = useState(() => new Animated.Value(animate ? -apart : 0))[0];
  const right = useState(() => new Animated.Value(animate ? apart : 0))[0];
  const spark = useState(() => new Animated.Value(animate && motion === 'meet' ? 0 : 1))[0];

  useEffect(() => {
    if (!animate) {
      left.setValue(0);
      right.setValue(0);
      spark.setValue(1);
      return;
    }
    const ease = { easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER };
    if (motion === 'drift') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(left, { toValue: 4, duration: 5500, ...ease }),
            Animated.timing(right, { toValue: -4, duration: 5500, ...ease }),
          ]),
          Animated.parallel([
            Animated.timing(left, { toValue: -14, duration: 5500, ...ease }),
            Animated.timing(right, { toValue: 14, duration: 5500, ...ease }),
          ]),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    const meet = Animated.sequence([
      Animated.parallel([
        Animated.timing(left, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(right, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }),
      ]),
      Animated.spring(spark, { toValue: 1, friction: 4, tension: 120, useNativeDriver: NATIVE_DRIVER }),
    ]);
    meet.start();
    return () => meet.stop();
  }, [animate, motion, left, right, spark]);

  const offset = size * 0.6;
  const sparkSize = Math.round(size * 0.15);
  const circle = { width: size, height: size, borderRadius: size / 2 };
  // The lens sits inside the left circle, offset by however far apart the two are now.
  const lensShift = Animated.add(Animated.subtract(right, left), offset);
  const middle = Animated.divide(Animated.add(left, right), 2);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size + offset, height: size }, style]}
    >
      <Animated.View style={[styles.absolute, circle, { backgroundColor: day.peach, transform: [{ translateX: left }] }]} />
      <Animated.View style={[styles.absolute, circle, { left: offset, backgroundColor: day.blush, transform: [{ translateX: right }] }]} />
      <Animated.View style={[styles.absolute, circle, styles.clip, { transform: [{ translateX: left }] }]}>
        <Animated.View style={[circle, { backgroundColor: LENS, transform: [{ translateX: lensShift }] }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.absolute,
          {
            left: size * 0.8 - sparkSize / 2,
            top: size / 2 - sparkSize / 2,
            width: sparkSize,
            height: sparkSize,
            borderRadius: sparkSize / 2,
            backgroundColor: night.honey,
            boxShadow: shadows.honey,
            opacity: spark,
            transform: [{ translateX: middle }, { scale: spark }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute', top: 0, left: 0 },
  clip: { overflow: 'hidden' },
});
