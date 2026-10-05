import type { ReactNode } from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { day, fonts, night, type Tone } from '@/theme';

interface Props extends TextProps {
  tone?: Tone;
  children: ReactNode;
}

function color(tone: Tone, muted = false): TextStyle {
  if (tone === 'day') return { color: muted ? day.muted : day.ink };
  return { color: muted ? night.muted : night.text };
}

/** Screen headline, in Fraunces. */
export function Title({ tone = 'day', style, ...props }: Props) {
  return <Text accessibilityRole="header" style={[styles.title, color(tone), style]} {...props} />;
}

/** Section heading, smaller. */
export function Heading({ tone = 'day', style, ...props }: Props) {
  return <Text accessibilityRole="header" style={[styles.heading, color(tone), style]} {...props} />;
}

export function Body({ tone = 'day', style, ...props }: Props) {
  return <Text style={[styles.body, color(tone, true), style]} {...props} />;
}

/** A form label or a strong short line. */
export function Label({ tone = 'day', style, ...props }: Props) {
  return <Text style={[styles.label, color(tone), style]} {...props} />;
}

/** Small uppercase overline, e.g. "Next round closes in". */
export function Eyebrow({ tone = 'day', style, ...props }: Props) {
  return <Text style={[styles.eyebrow, color(tone, true), style]} {...props} />;
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 37, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20 },
  eyebrow: { fontFamily: fonts.bodySemi, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' },
});
