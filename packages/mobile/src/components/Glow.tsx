import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

interface GlowProps {
  color: string;
  /** At the centre; it fades to nothing at the edges. */
  opacity?: number;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A soft pool of light, like a candle's on a wall. React Native views can't
 * draw radial gradients, so it's a little SVG. Decoration only: screen readers
 * skip it and it never takes a touch.
 */
export function Glow({ color, opacity = 0.35, width, height, style }: GlowProps) {
  const id = `glow-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, pointerEvents: 'none' }, style]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="0.45" stopColor={color} stopOpacity={opacity * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
