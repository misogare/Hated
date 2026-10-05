import type { AnswerValue, Question } from '@hated/api/contract';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice, Steps } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { capitalize, choiceList, scaleLabels, scalePhrase } from '@/copy';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

/** Step 2: the FirstDate questionnaire, one question at a time, each saved as it is answered. */
export default function Questions() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { api, refresh } = useSession();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [questionnaire, saved] = await Promise.all([api.questionnaire(), api.answers()]);
        setQuestions(questionnaire.questions.filter((question) => question.kind === 'SCALE' || question.kind === 'SINGLE_CHOICE'));
        setAnswers(saved.answers);
      } catch (caught) {
        setError(describeError(caught));
      }
    })();
  }, [api]);

  if (questions === null) {
    return (
      <Screen>
        <View style={styles.loading}>{error === null ? <ActivityIndicator color={day.accent} /> : <Notice kind="error">{error}</Notice>}</View>
      </Screen>
    );
  }

  const question = questions[index]!;
  const isLast = index === questions.length - 1;
  const stored = answers[question.key];
  const value = question.kind === 'SCALE' ? (typeof stored === 'number' ? stored : 0.5) : typeof stored === 'string' ? stored : null;

  async function advance(answer: AnswerValue) {
    setBusy(true);
    setError(null);
    try {
      await api.saveAnswers({ [question.key]: answer });
      setAnswers({ ...answers, [question.key]: answer });
      if (!isLast) {
        setIndex(index + 1);
        return;
      }
      await refresh();
      if (editing) router.back();
      else router.push('/onboarding/hopes');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    if (index > 0) setIndex(index - 1);
    else if (router.canGoBack()) router.back();
    else router.replace('/onboarding/about');
  }

  return (
    <Screen
      footer={
        <>
          <Button label="Skip this one" variant="text" onPress={() => void advance(null)} disabled={busy} />
          <Button
            label={isLast ? (editing ? 'Save' : "Next: what you're hoping for") : 'Next'}
            onPress={() => void advance(value)}
            disabled={value === null}
            busy={busy}
          />
        </>
      }
    >
      <View style={styles.top}>
        <BackButton onPress={back} />
        <View style={styles.fill}>
          <Steps step={2} total={3} caption={`${editing ? 'Your answers' : 'Step 2 of 3'} · Question ${index + 1} of ${questions.length}`} />
        </View>
      </View>

      <Title style={styles.prompt}>{question.prompt}</Title>

      {question.kind === 'SCALE' ? (
        <ScaleAnswer question={question} value={value as number} onChange={(next) => setAnswers({ ...answers, [question.key]: next })} />
      ) : (
        <View style={styles.choices}>
          {choiceList(question).map((choice) => {
            const selected = value === choice;
            return (
              <Pressable
                key={choice}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setAnswers({ ...answers, [question.key]: choice })}
                style={[styles.choice, selected ? styles.choiceOn : styles.choiceOff]}
              >
                <Text style={[styles.choiceText, { color: selected ? '#FFFFFF' : day.ink }]}>{capitalize(choice)}</Text>
              </Pressable>
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

function ScaleAnswer({ question, value, onChange }: { question: Question; value: number; onChange: (value: number) => void }) {
  const { left, right } = scaleLabels(question);
  const phrase = scalePhrase(question, value);
  return (
    <View style={styles.scale}>
      {phrase === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.phrase}>
          {phrase}
        </Text>
      )}
      <Slider
        accessibilityLabel={question.prompt}
        value={value}
        minimumValue={0}
        maximumValue={1}
        step={0.01}
        onValueChange={onChange}
        minimumTrackTintColor={day.accent}
        maximumTrackTintColor={day.line}
        thumbTintColor={day.accent}
        style={styles.slider}
      />
      <View style={styles.ends}>
        <Body style={styles.end}>{left}</Body>
        <Body style={[styles.end, styles.endRight]}>{right}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  fill: { flex: 1 },
  prompt: { marginTop: 40, fontSize: 30, lineHeight: 35 },
  scale: { marginTop: 48 },
  phrase: { textAlign: 'center', fontFamily: fonts.displayItalic, fontSize: 22, color: day.accent, minHeight: 30 },
  slider: { marginTop: 20, height: 44 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  end: { fontFamily: fonts.bodyMedium, fontSize: 14, flexShrink: 1 },
  endRight: { textAlign: 'right' },
  choices: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  choice: { width: '47%', height: 88, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: day.ink, borderColor: day.ink },
  choiceOff: { backgroundColor: day.surface, borderColor: day.field },
  choiceText: { fontFamily: fonts.bodySemi, fontSize: 16 },
  error: { marginTop: 16 },
});
