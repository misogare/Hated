import type { Desire, Question } from '@hated/api/contract';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice, Steps } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { scaleLabels, traitTitle } from '@/copy';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

const LEVELS = [
  { label: "Don't mind", weight: 0 },
  { label: 'Nice to have', weight: 0.5 },
  { label: 'Important', weight: 1 },
] as const;

/** A trait with nothing saved yet: "Nice to have", aimed at the middle. */
const DEFAULT_DESIRE: Desire = { target: 0.5, weight: 0.5 };

/**
 * Step 3: what they hope for on each trait. As in the prototype, a trait not
 * saved yet starts at "Nice to have", aimed at the middle of the scale;
 * "Don't mind" leaves it out of matching entirely.
 */
export default function Hopes() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { api } = useSession();
  const [traits, setTraits] = useState<Question[] | null>(null);
  const [desires, setDesires] = useState<Record<string, Desire>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [questionnaire, saved] = await Promise.all([api.questionnaire(), api.desires()]);
        setTraits(questionnaire.questions.filter((question) => question.kind === 'SCALE' && question.traitKey !== null));
        setDesires(saved.desires);
      } catch (caught) {
        setError(describeError(caught));
      }
    })();
  }, [api]);

  function desireFor(key: string): Desire {
    return desires[key] ?? DEFAULT_DESIRE;
  }

  async function save() {
    if (traits === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveDesires(Object.fromEntries(traits.map((trait) => [trait.traitKey!, desireFor(trait.traitKey!)])));
      if (editing) router.back();
      else router.push('/onboarding/photos');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      scroll
      footer={<Button label={editing ? 'Save' : 'Next: photos and words'} onPress={() => void save()} disabled={traits === null} busy={busy} />}
    >
      <View style={styles.top}>
        <BackButton />
        {editing ? null : (
          <View style={styles.fill}>
            <Steps step={3} total={4} />
          </View>
        )}
      </View>
      <Title style={styles.title}>What are you hoping for?</Title>
      <Body style={styles.lede}>Say how much each one matters. Anything you mark "Don't mind" is left out entirely.</Body>

      {traits === null ? (
        <View style={styles.loading}>{error === null ? <ActivityIndicator color={day.accent} /> : null}</View>
      ) : (
        <View style={styles.cards}>
          {traits.map((trait) => {
            const key = trait.traitKey!;
            const desire = desireFor(key);
            const { left, right } = scaleLabels(trait);
            const title = traitTitle(trait);
            return (
              <View key={key} style={styles.card}>
                <Text style={styles.cardTitle}>{title}</Text>
                <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={`How much ${title.toLowerCase()} matters`}>
                  {LEVELS.map((level) => {
                    const selected = desire.weight === level.weight;
                    return (
                      <Pressable
                        key={level.label}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setDesires({ ...desires, [key]: { ...desire, weight: level.weight } })}
                        style={[styles.segment, selected && styles.segmentOn]}
                      >
                        <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{level.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {desire.weight === 0 ? null : (
                  <>
                    <Slider
                      accessibilityLabel={`${title}: what you're hoping for`}
                      value={desire.target}
                      minimumValue={0}
                      maximumValue={1}
                      step={0.01}
                      onValueChange={(target) => setDesires({ ...desires, [key]: { ...desire, target } })}
                      minimumTrackTintColor={day.accent}
                      maximumTrackTintColor={day.line}
                      thumbTintColor={day.accent}
                      style={styles.slider}
                    />
                    <View style={styles.ends}>
                      <Text style={styles.end}>{left}</Text>
                      <Text style={[styles.end, styles.endRight]}>{right}</Text>
                    </View>
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}

      {error === null ? null : (
        <View style={styles.error}>
          <Notice kind="error">{error}</Notice>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  fill: { flex: 1 },
  title: { marginTop: 22, fontSize: 30, lineHeight: 35 },
  lede: { marginTop: 10, fontSize: 15.5, lineHeight: 23 },
  loading: { paddingVertical: 48 },
  cards: { marginTop: 18, gap: 14, paddingBottom: 8 },
  card: { padding: 16, borderRadius: 20, backgroundColor: day.surface, borderWidth: 1, borderColor: day.line },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: 16, color: day.ink },
  segments: { marginTop: 12, flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: day.segment },
  segment: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentOn: { backgroundColor: day.ink },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: day.ink, textAlign: 'center' },
  segmentTextOn: { fontFamily: fonts.bodySemi, color: '#FFFFFF' },
  slider: { marginTop: 10, height: 40 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  end: { fontFamily: fonts.bodyMedium, fontSize: 13, color: day.muted, flexShrink: 1 },
  endRight: { textAlign: 'right' },
  error: { marginTop: 16 },
});
