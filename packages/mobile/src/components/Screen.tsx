import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { day, night, type Tone } from '@/theme';

interface ScreenProps {
  tone?: Tone;
  /** Scroll the body when content can outgrow the screen. */
  scroll?: boolean;
  /** Pinned below the body (primary actions), clear of the home indicator. */
  footer?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}

/** A full screen in the day or night palette, padded clear of notches and keyboards. */
export function Screen({ tone = 'day', scroll = false, footer, children, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const background = tone === 'day' ? day.bg : night.bg;
  const body = [styles.body, style];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={tone === 'day' ? 'dark' : 'light'} />
      <View style={{ height: insets.top + 12 }} />
      {scroll ? (
        <ScrollView style={styles.fill} contentContainerStyle={body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, ...body]}>{children}</View>
      )}
      {footer === undefined ? (
        <View style={{ height: insets.bottom + 12 }} />
      ) : (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{footer}</View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 24 },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 12 },
});
