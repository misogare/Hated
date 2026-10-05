import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Body, Heading, Title } from '@/components/Text';
import { roundTime } from '@/copy';
import { useSession } from '@/session';
import { day } from '@/theme';

const NEXT = [
  'When the round closes, everyone is paired at once.',
  "If you're matched, you'll both find out at the same moment.",
  'You can change your answers, or sit out a round, any time before it closes.',
];

export default function Done() {
  const { api } = useSession();
  const [closes, setCloses] = useState<string | null>(null);

  useEffect(() => {
    api.home().then((home) => setCloses(roundTime(home.nextRoundAt)), () => setCloses(null));
  }, [api]);

  return (
    <Screen footer={<Button label="Go to home" onPress={() => router.replace('/home')} />}>
      <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.badgeInner}>
          <Feather name="check" size={44} color={day.ink} />
        </View>
      </View>
      <Title style={styles.title}>You're in.</Title>
      <Body style={styles.lede}>
        Your answers are saved. You're in the next round{closes === null ? '.' : `, which closes ${closes}.`}
      </Body>

      <View style={styles.card}>
        <Heading>What happens next</Heading>
        {NEXT.map((line) => (
          <View key={line} style={styles.item}>
            <View style={styles.dot} />
            <Body style={styles.itemText}>{line}</Body>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { marginTop: 48, alignSelf: 'center', width: 132, height: 132, borderRadius: 66, backgroundColor: day.honeySoft, alignItems: 'center', justifyContent: 'center' },
  badgeInner: { width: 96, height: 96, borderRadius: 48, backgroundColor: day.honey, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 36, textAlign: 'center', fontSize: 42, lineHeight: 45 },
  lede: { marginTop: 14, textAlign: 'center', fontSize: 17, lineHeight: 26 },
  card: { marginTop: 32, padding: 20, borderRadius: 22, backgroundColor: day.card, borderWidth: 1, borderColor: day.line, gap: 12 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { marginTop: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: day.accent },
  itemText: { flex: 1, fontSize: 15, lineHeight: 22 },
});
