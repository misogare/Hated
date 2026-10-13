import { useEffect, useId, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Glow } from '@/components/Glow';
import { NATIVE_DRIVER, useReducedMotion } from '@/motion';
import { night } from '@/theme';

const WIDTH = 96;
const HEIGHT = 236;
const BODY_WIDTH = 44;
const PLATE = 6;
/** The candle at the start of the week, and the stub it burns down to. */
const TALLEST = 190;
const SHORTEST = 40;

/**
 * Home's candle: it burns down over the week, so its height is how long is
 * left until the round closes (`left`, from 1 to 0). The flame flickers unless
 * the person has asked for less motion.
 */
export function Candle({ left }: { left: number }) {
  const ids = useId().replace(/[^A-Za-z0-9]/g, '');
  const reduced = useReducedMotion();
  const flicker = useState(() => new Animated.Value(0))[0];
  const breathe = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (reduced) return;
    const flame = Animated.loop(Animated.timing(flicker, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(breathe, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    flame.start();
    glow.start();
    return () => {
      flame.stop();
      glow.stop();
    };
  }, [reduced, flicker, breathe]);

  const height = Math.round(SHORTEST + (TALLEST - SHORTEST) * Math.min(1, Math.max(0, left)));
  const wickBottom = PLATE + height;
  const steps = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View style={styles.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.glow, { bottom: wickBottom - 70, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }]}>
        <Glow color={night.glow} opacity={0.5} width={210} height={210} />
      </Animated.View>

      <View style={styles.plate} />
      <Svg width={BODY_WIDTH} height={height} style={[styles.body, { bottom: PLATE }]}>
        <Defs>
          <LinearGradient id={`wax${ids}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#D9BFA8" />
            <Stop offset="0.42" stopColor="#FBEFE8" />
            <Stop offset="0.7" stopColor="#EAD6C4" />
            <Stop offset="1" stopColor="#CDB29C" />
          </LinearGradient>
        </Defs>
        <Rect width={BODY_WIDTH} height={height} rx={9} fill={`url(#wax${ids})`} />
        <Rect x={28} y={0} width={9} height={18} rx={4.5} fill="#F3E3D4" />
      </Svg>
      <View style={[styles.wick, { bottom: wickBottom - 1 }]} />

      <Animated.View
        style={[
          styles.flame,
          {
            bottom: wickBottom + 5,
            transform: [
              { scaleX: flicker.interpolate({ inputRange: steps, outputRange: [1, 0.94, 1.04, 0.97, 1] }) },
              { scaleY: flicker.interpolate({ inputRange: steps, outputRange: [1, 1.06, 0.96, 1.04, 1] }) },
              { rotate: flicker.interpolate({ inputRange: steps, outputRange: ['-1deg', '1.5deg', '-1.5deg', '1deg', '-1deg'] }) },
            ],
          },
        ]}
      >
        <Svg width={20} height={32} viewBox="0 0 18 30">
          <Defs>
            <RadialGradient id={`flame${ids}`} cx="50%" cy="72%" rx="55%" ry="60%">
              <Stop offset="0" stopColor="#FFF8E8" />
              <Stop offset="0.4" stopColor="#F9D27E" />
              <Stop offset="0.8" stopColor="#EE9A45" />
              <Stop offset="1" stopColor="#EE9A45" stopOpacity={0.2} />
            </RadialGradient>
          </Defs>
          <Path d="M9 0 C12 7 18 13 18 20 C18 25.5 14 30 9 30 C4 30 0 25.5 0 20 C0 13 6 7 9 0 Z" fill={`url(#flame${ids})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: WIDTH, height: HEIGHT },
  glow: { position: 'absolute', left: (WIDTH - 210) / 2 },
  plate: {
    position: 'absolute',
    bottom: 0,
    left: (WIDTH - 92) / 2,
    width: 92,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4A2B3B',
    transform: [{ scaleY: 0.9 }],
  },
  body: { position: 'absolute', left: (WIDTH - BODY_WIDTH) / 2 },
  wick: { position: 'absolute', left: WIDTH / 2 - 1, width: 2, height: 9, borderRadius: 1, backgroundColor: night.bg },
  flame: { position: 'absolute', left: WIDTH / 2 - 10, width: 20, height: 32, transformOrigin: 'bottom' },
});
