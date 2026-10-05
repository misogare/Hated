import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice, Wordmark } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

/** Welcome: what HateD is, for someone who hasn't signed in. */
export default function Welcome() {
  const { notice } = useSession();
  return (
    <Screen
      footer={
        <>
          <Button label="Get started" onPress={() => router.push('/how-it-works')} />
          <Button label="I already have an account" variant="secondary" onPress={() => router.push('/sign-in/email')} />
          <Body style={styles.footnote}>Open to verified school and government emails.</Body>
        </>
      }
    >
      <Wordmark />
      {notice === null ? null : (
        <View style={styles.notice}>
          <Notice kind="success">{notice}</Notice>
        </View>
      )}
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.circle, { left: 0, backgroundColor: day.peach }]} />
        <View style={[styles.circle, { left: 90, backgroundColor: day.blush, opacity: 0.85 }]} />
        <View style={styles.spark} />
      </View>
      <Title style={styles.headline}>For people who hate dating apps.</Title>
      <Body style={styles.lede}>
        No swiping and no feeds. Each round you get one match, chosen by what you both actually care about.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { marginTop: 16 },
  art: { alignSelf: 'center', width: 246, height: 196, marginTop: 28 },
  circle: { position: 'absolute', top: 20, width: 156, height: 156, borderRadius: 78 },
  spark: { position: 'absolute', left: 112, top: 87, width: 22, height: 22, borderRadius: 11, backgroundColor: day.honey },
  headline: { marginTop: 24, fontSize: 44, lineHeight: 46, letterSpacing: -0.9 },
  lede: { marginTop: 16, fontSize: 17, lineHeight: 26 },
  footnote: { textAlign: 'center', fontSize: 13, fontFamily: fonts.body },
});
