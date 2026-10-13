import type { PromptAnswer } from '@hated/api/contract';
import { StyleSheet, Text, View } from 'react-native';

import { day, fonts, night, type Tone } from '@/theme';

/** Their line, as a quotation in italic Fraunces. */
export function Quote({ text, tone = 'night' }: { text: string; tone?: Tone }) {
  return <Text style={[styles.quote, { color: tone === 'day' ? day.ink : night.text }]}>“{text}”</Text>;
}

/** One answered prompt: the prompt small, the answer large. */
export function PromptCard({ prompt, tone = 'night' }: { prompt: PromptAnswer; tone?: Tone }) {
  const dayTone = tone === 'day';
  return (
    <View style={[styles.card, dayTone ? styles.cardDay : styles.cardNight]}>
      <Text style={[styles.promptLabel, { color: dayTone ? '#A4561F' : night.muted }]}>{prompt.label}</Text>
      <Text style={[styles.promptAnswer, { color: dayTone ? day.ink : night.text }]}>{prompt.answer}</Text>
    </View>
  );
}

/** Highlights from the questionnaire, as outlined pills. */
export function Highlights({ items, tone = 'night' }: { items: readonly string[]; tone?: Tone }) {
  const dayTone = tone === 'day';
  return (
    <View style={styles.pills}>
      {items.map((item) => (
        <View key={item} style={[styles.pill, dayTone ? styles.pillDay : styles.pillNight]}>
          <Text style={[styles.pillText, { color: dayTone ? day.ink : night.text }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** A short list with honey dots: why two people fit. */
export function Reasons({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.reasons}>
      {items.map((reason) => (
        <View key={reason} style={styles.reason}>
          <View style={styles.dot} />
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { fontFamily: fonts.displayItalic, fontSize: 22, lineHeight: 29 },
  card: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, borderRadius: 24, borderWidth: 1, gap: 8 },
  cardNight: { backgroundColor: night.surface, borderColor: night.line },
  cardDay: { backgroundColor: day.surface, borderColor: day.line },
  promptLabel: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 1, textTransform: 'uppercase' },
  promptAnswer: { fontFamily: fonts.display, fontSize: 20, lineHeight: 27 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  pillNight: { borderWidth: 1, borderColor: night.outline },
  pillDay: { backgroundColor: day.tint },
  pillText: { fontFamily: fonts.bodySemi, fontSize: 14.5 },
  reasons: { gap: 10 },
  reason: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { marginTop: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: night.honey },
  reasonText: { flex: 1, fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22, color: night.text },
});
