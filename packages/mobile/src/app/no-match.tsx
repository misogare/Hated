import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackButton } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow, Heading, Title } from '@/components/Text';
import { roundTime } from '@/copy';
import { useSession } from '@/session';
import { night } from '@/theme';

/** No match this round: gentle, honest, and one thing to try. */
export default function NoMatch() {
  const { api } = useSession();
  const [reason, setReason] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    api.home().then(
      (home) => {
        setNext(roundTime(home.nextRoundAt));
        if (home.result.status === 'unmatched') setReason(home.result.reason);
      },
      () => undefined,
    );
  }, [api]);

  // Nobody fit what they asked for: the one case where their settings are the lever.
  const nobodyFit = reason === 'no-eligible-candidates';

  return (
    <Screen
      tone="night"
      footer={
        <>
          <Body tone="night" style={styles.next}>
            {next === null ? "You're still in for the next round." : `You're still in for the next round, ${next}.`}
          </Body>
          <Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />
        </>
      }
    >
      <BackButton tone="night" />
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.circle, { left: 0, backgroundColor: '#5A3442' }]} />
        <View style={[styles.circle, { left: 114, backgroundColor: '#4A2A38' }]} />
        <View style={styles.spark} />
      </View>
      <Eyebrow tone="night" style={styles.eyebrow}>
        Last round
      </Eyebrow>
      <Title tone="night" style={styles.title}>
        No match this time.
      </Title>
      <Body tone="night" style={styles.body}>
        {nobodyFit
          ? 'Nobody in this round fitted everything you asked for. That says more about the round than about you.'
          : "A match only goes ahead when it's a good fit for both people, and this round the pieces didn't line up. That's not a verdict on you."}
      </Body>

      <View style={styles.card}>
        <Heading tone="night">Want a wider field?</Heading>
        <Body tone="night" style={styles.cardBody}>
          If a lot is marked "Important", fewer people can be a fit. Easing one or two widens who you could meet.
        </Body>
        <Button
          label="Review what matters"
          variant="text"
          tone="night"
          onPress={() => router.push({ pathname: '/onboarding/hopes', params: { edit: '1' } })}
          style={styles.inline}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { marginTop: 12, alignSelf: 'center', width: 218, height: 130 },
  circle: { position: 'absolute', top: 12, width: 104, height: 104, borderRadius: 52 },
  spark: { position: 'absolute', left: 101, top: 56, width: 16, height: 16, borderRadius: 8, backgroundColor: night.honey, opacity: 0.55 },
  eyebrow: { marginTop: 20, textAlign: 'center' },
  title: { marginTop: 12, textAlign: 'center', fontSize: 38, lineHeight: 42 },
  body: { marginTop: 14, textAlign: 'center', fontSize: 16, lineHeight: 25 },
  card: { marginTop: 28, padding: 20, borderRadius: 22, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 6 },
  cardBody: { fontSize: 14.5, lineHeight: 21 },
  inline: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  next: { textAlign: 'center', fontSize: 14.5 },
});
