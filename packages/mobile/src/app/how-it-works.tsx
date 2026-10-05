import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackButton } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Heading, Label, Title } from '@/components/Text';
import { day, fonts } from '@/theme';

const STEPS = [
  { title: "Prove you're real", body: 'Verify a school or government email. Everyone you could meet has done the same.' },
  { title: 'Tell us what matters', body: "A few honest questions about you, and about what you're hoping for in someone else." },
  { title: 'Meet your one match', body: 'When a round closes, everyone is paired at once, and nobody gets more than one match.' },
];

export default function HowItWorks() {
  return (
    <Screen scroll footer={<Button label="Verify my email" onPress={() => router.push('/sign-in/email')} />}>
      <BackButton />
      <Title style={styles.title}>How HateD works</Title>

      <View style={styles.steps}>
        {STEPS.map((step, index) => (
          <View key={step.title} style={styles.step}>
            <View style={[styles.number, index === STEPS.length - 1 && styles.numberLast]}>
              <Text style={[styles.numberText, index === STEPS.length - 1 && { color: '#FFFFFF' }]}>{index + 1}</Text>
            </View>
            <View style={styles.stepText}>
              <Label style={styles.stepTitle}>{step.title}</Label>
              <Body style={styles.stepBody}>{step.body}</Body>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Heading>Why only one?</Heading>
        <Body style={styles.cardBody}>
          Because it makes every match count. Pairings are stable: no two people would both rather be with each other than
          with their match. And among stable pairings, we pick the one that does best by whoever fares worst.
        </Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 24, fontSize: 34, lineHeight: 38 },
  steps: { marginTop: 28, gap: 22 },
  step: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  number: { width: 40, height: 40, borderRadius: 20, backgroundColor: day.tint, alignItems: 'center', justifyContent: 'center' },
  numberLast: { backgroundColor: day.accent },
  numberText: { fontFamily: fonts.displayBold, fontSize: 18, color: day.ink },
  stepText: { flex: 1, gap: 6 },
  stepTitle: { fontSize: 18 },
  stepBody: { fontSize: 15.5, lineHeight: 23 },
  card: { marginTop: 28, marginBottom: 12, padding: 20, borderRadius: 20, backgroundColor: day.card, borderWidth: 1, borderColor: day.line, gap: 8 },
  cardBody: { fontSize: 15, lineHeight: 22 },
});
