import { useEffect, useEffectEvent, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { NATIVE_DRIVER, useReducedMotion } from '@/motion';
import { fonts, night, shadows } from '@/theme';

const WIDTH = 304;
const HEIGHT = 300;
const FLAP = 156;
const SEAL = 92;

/**
 * The sealed match: an envelope with a wax seal stamped D. It floats while it
 * waits; once `opening`, the seal breaks and the flap lifts, then `onOpened`
 * runs. With reduced motion it opens straight away.
 */
export function Envelope({ opening, onOpened }: { opening: boolean; onOpened: () => void }) {
  const reduced = useReducedMotion();
  const float = useState(() => new Animated.Value(0))[0];
  const open = useState(() => new Animated.Value(0))[0];
  const opened = useEffectEvent(onOpened);

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(float, { toValue: 0, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, float]);

  useEffect(() => {
    if (!opening) return;
    if (reduced) {
      opened();
      return;
    }
    const animation = Animated.timing(open, { toValue: 1, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE_DRIVER });
    animation.start(({ finished }) => {
      if (finished) opened();
    });
    return () => animation.stop();
  }, [opening, reduced, open]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }]}
    >
      <View style={styles.card} />
      <Animated.View
        style={[
          styles.flap,
          { transform: [{ perspective: 900 }, { rotateX: open.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '178deg'] }) }] },
        ]}
      >
        <Svg width={WIDTH - 2} height={FLAP}>
          <Path d={`M0 0 H${WIDTH - 2} L${(WIDTH - 2) / 2} ${FLAP} Z`} fill="#45283A" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.seal,
          {
            opacity: open.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1, 0] }),
            transform: [
              { scale: open.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.12, 0.2] }) },
              { rotate: open.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '40deg'] }) },
            ],
          },
        ]}
      >
        <View style={styles.sealInner}>
          <Text style={styles.sealLetter}>D</Text>
        </View>
      </Animated.View>
      <Text style={styles.caption}>One person, chosen for you this round. Open it when you're ready.</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { width: WIDTH, height: HEIGHT, alignSelf: 'center' },
  card: {
    ...StyleSheet.absoluteFill,
    borderRadius: 28,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
    boxShadow: '0px 24px 50px rgba(10, 2, 6, 0.45)',
  },
  flap: { position: 'absolute', top: 1, left: 1, width: WIDTH - 2, height: FLAP, transformOrigin: 'top', borderTopLeftRadius: 27, borderTopRightRadius: 27, overflow: 'hidden' },
  seal: {
    position: 'absolute',
    top: 112,
    left: (WIDTH - SEAL) / 2,
    width: SEAL,
    height: SEAL,
    borderRadius: SEAL / 2,
    backgroundColor: night.wax,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0px 12px 30px rgba(10, 2, 6, 0.5), ${shadows.glow}`,
  },
  sealInner: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#E8A33D', alignItems: 'center', justifyContent: 'center' },
  sealLetter: { fontFamily: fonts.displayBold, fontSize: 40, lineHeight: 46, color: night.waxDeep },
  caption: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 30,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 15.5,
    lineHeight: 23,
    color: night.muted,
  },
});
