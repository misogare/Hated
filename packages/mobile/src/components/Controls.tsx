import Feather from '@expo/vector-icons/Feather';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';

import { goBack } from '@/navigation';
import { useSession } from '@/session';
import { day, fonts, night, type Tone } from '@/theme';

/**
 * A switch in the evening palette: honey track, cream thumb. The web build
 * takes the "on" thumb colour from `activeThumbColor` (react-native-web only,
 * so not in React Native's types); without it the thumb turns teal.
 */
export function NightSwitch(props: { accessibilityLabel: string; value: boolean; onValueChange: (on: boolean) => void; disabled?: boolean }) {
  const web = { activeThumbColor: night.text };
  return <Switch {...props} trackColor={{ false: night.line, true: night.honey }} thumbColor={night.text} {...web} />;
}

/**
 * Round back button. Goes back in the stack; when nothing is behind this
 * screen (it was opened by a redirect, a link or a refresh), it goes to
 * `fallback` instead: by default home when signed in, the welcome screen when not.
 */
export function BackButton({ tone = 'day', onPress, fallback }: { tone?: Tone; onPress?: () => void; fallback?: Href }) {
  const { status } = useSession();
  const parent: Href = fallback ?? (status === 'signed-in' ? '/home' : '/');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress ?? (() => goBack(parent))}
      style={[styles.back, { backgroundColor: tone === 'day' ? day.tint : night.surface }]}
    >
      <Feather name="chevron-left" size={22} color={tone === 'day' ? day.ink : night.text} />
    </Pressable>
  );
}

/** A toggle chip: filled when selected. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipLabel, { color: selected ? '#FFFFFF' : day.ink, fontFamily: selected ? fonts.bodySemi : fonts.bodyMedium }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "Step n of total" with a segmented bar. */
export function Steps({ step, total, caption }: { step: number; total: number; caption?: string }) {
  return (
    <View style={styles.steps} accessible accessibilityLabel={caption ?? `Step ${step} of ${total}`}>
      <Text style={styles.stepsCaption}>{caption ?? `Step ${step} of ${total}`}</Text>
      <View style={styles.stepsBar}>
        {Array.from({ length: total }, (_, index) => (
          <View key={index} style={[styles.stepsSegment, { backgroundColor: index < step ? day.accent : day.line }]} />
        ))}
      </View>
    </View>
  );
}

/** Back button and progress on one row, as on every onboarding screen. */
export function TopBar({ children, onBack }: { children?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.topBar}>
      <BackButton onPress={onBack} />
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  /** Shown under the field. */
  hint?: string;
}

/** A labelled text input in the day palette. */
export function Field({ label, hint, style, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={day.muted}
        selectionColor={day.accent}
        style={[styles.input, style]}
        {...input}
      />
      {hint === undefined ? null : <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** One line of feedback under a form: an error, or a quiet success. */
export function Notice({ kind, children, tone = 'day' }: { kind: 'error' | 'success' | 'info'; children: ReactNode; tone?: Tone }) {
  const colorFor = {
    error: tone === 'day' ? day.danger : night.rose,
    success: tone === 'day' ? day.success : night.honey,
    info: tone === 'day' ? day.muted : night.muted,
  }[kind];
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colorFor }]}>
      {children}
    </Text>
  );
}

export function Wordmark({ tone = 'day', size = 26 }: { tone?: Tone; size?: number }) {
  return (
    <Text accessibilityRole="header" accessibilityLabel="HateD" style={[styles.wordmark, { fontSize: size, color: tone === 'day' ? day.ink : night.text }]}>
      Hate<Text style={{ color: tone === 'day' ? day.accent : night.rose }}>D</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1.5, justifyContent: 'center' },
  chipOn: { backgroundColor: day.ink, borderColor: day.ink },
  chipOff: { backgroundColor: day.surface, borderColor: day.field },
  chipLabel: { fontSize: 15 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  steps: { gap: 6 },
  stepsCaption: { fontFamily: fonts.bodySemi, fontSize: 13, color: day.muted },
  stepsBar: { flexDirection: 'row', gap: 6 },
  stepsSegment: { flex: 1, height: 5, borderRadius: 3 },
  field: { gap: 8 },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: day.ink },
  input: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: day.field,
    backgroundColor: day.surface,
    paddingHorizontal: 18,
    fontFamily: fonts.body,
    fontSize: 17,
    color: day.ink,
  },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: day.muted },
  notice: { fontFamily: fonts.bodyMedium, fontSize: 14.5, lineHeight: 20 },
  wordmark: { fontFamily: fonts.displayBold, letterSpacing: -0.3 },
});
