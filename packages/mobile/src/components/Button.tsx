import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { day, fonts, night, type Tone } from '@/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** `danger` is for the one thing that can't be undone: deleting the account. */
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  tone?: Tone;
  disabled?: boolean;
  /** Shows a spinner and ignores presses. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/** Pill buttons from the prototype: rose (day) or honey (night) primary, outlined secondary. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  tone = 'day',
  disabled = false,
  busy = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const inactive = disabled || busy;
  const palette = colors(variant, tone);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        variant === 'text' ? styles.text : styles.pill,
        variant === 'secondary' && { borderWidth: 1.5, borderColor: palette.border, height: 52 },
        { backgroundColor: disabled ? palette.disabledBg : pressed ? palette.pressed : palette.bg },
        variant === 'danger' && pressed && styles.dangerPressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[styles.label, variant === 'text' && styles.textLabel, { color: disabled ? palette.disabledFg : palette.fg }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function colors(variant: 'primary' | 'secondary' | 'text' | 'danger', tone: Tone) {
  if (variant === 'danger') {
    const bg = tone === 'day' ? day.danger : night.rose;
    return tone === 'day'
      ? { bg, pressed: bg, fg: '#FFFFFF', border: bg, disabledBg: day.disabled, disabledFg: day.muted }
      : { bg, pressed: bg, fg: night.bg, border: bg, disabledBg: night.line, disabledFg: night.muted };
  }
  if (variant === 'primary') {
    return tone === 'day'
      ? { bg: day.accent, pressed: day.accentPressed, fg: '#FFFFFF', border: day.accent, disabledBg: day.disabled, disabledFg: day.muted }
      : { bg: night.honey, pressed: night.honeyPressed, fg: night.bg, border: night.honey, disabledBg: night.line, disabledFg: night.muted };
  }
  const fg = tone === 'day' ? (variant === 'text' ? day.accent : day.ink) : variant === 'text' ? night.honey : night.text;
  return {
    bg: 'transparent',
    pressed: tone === 'day' ? day.tint : night.surface,
    fg,
    border: tone === 'day' ? day.field : night.outline,
    disabledBg: 'transparent',
    disabledFg: tone === 'day' ? day.muted : night.muted,
  };
}

const styles = StyleSheet.create({
  pill: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  text: { minHeight: 44, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22 },
  label: { fontFamily: fonts.bodySemi, fontSize: 17 },
  textLabel: { fontSize: 15, textDecorationLine: 'underline' },
  dangerPressed: { opacity: 0.85 },
});
