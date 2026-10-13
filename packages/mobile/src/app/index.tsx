import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice, Wordmark } from '@/components/Controls';
import { MeetingCircles } from '@/components/MeetingCircles';
import { Screen } from '@/components/Screen';
import { Body } from '@/components/Text';
import { DEMO } from '@/demo';
import { useSession } from '@/session';
import { day, fonts, shadows } from '@/theme';

const STEPS = ['Answer a few honest questions', 'Meet one person, once a week', 'See their photos once you both say hello'];

/** Welcome: what HateD is, for someone who hasn't signed in. */
export default function Welcome() {
  const { notice } = useSession();
  return (
    <Screen
      footer={
        <>
          <Button label="Get started" onPress={() => router.push('/how-it-works')} style={styles.primary} />
          <Button label="I already have an account" variant="secondary" onPress={() => router.push('/sign-in/email')} />
          <Body style={styles.footnote}>
            {DEMO ? 'A demo with made-up people. Nothing you enter leaves this browser.' : 'Open to verified university and government emails.'}
          </Body>
        </>
      }
    >
      <View style={styles.blob} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={styles.header}>
        <Wordmark />
        <Pressable accessibilityRole="link" onPress={() => router.push('/sign-in/email')} style={({ pressed }) => [styles.signIn, pressed && styles.pressed]}>
          <Text style={styles.signInText}>Sign in</Text>
        </Pressable>
      </View>
      {notice === null ? null : (
        <View style={styles.notice}>
          <Notice kind="success">{notice}</Notice>
        </View>
      )}

      <View style={styles.art}>
        <MeetingCircles size={150} motion="drift" />
        <View style={styles.ring} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      </View>

      <Text accessibilityRole="header" style={styles.headline}>
        For people who <Text style={styles.hate}>hate</Text> dating apps.
      </Text>
      <Body style={styles.lede}>No swiping and no feeds. One match a week, chosen by what you both actually care about.</Body>

      <View style={styles.steps}>
        {STEPS.map((step, index) => (
          <View key={step} style={styles.step}>
            <Text style={styles.stepNumber}>{index + 1}</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', left: -150, top: -190, width: 420, height: 420, borderRadius: 210, backgroundColor: '#F7E3D8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signIn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, borderRadius: 12 },
  signInText: { fontFamily: fonts.bodySemi, fontSize: 15, color: day.accent },
  pressed: { opacity: 0.7 },
  notice: { marginTop: 12 },
  art: { alignSelf: 'center', marginTop: 18, height: 170, justifyContent: 'center' },
  ring: { position: 'absolute', right: -42, top: 0, width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, borderColor: day.ink, opacity: 0.16 },
  headline: { marginTop: 18, fontFamily: fonts.display, fontSize: 44, lineHeight: 45, letterSpacing: -1.3, color: day.ink },
  hate: { fontFamily: fonts.displayItalic, color: day.accent },
  lede: { marginTop: 14, fontSize: 17, lineHeight: 25 },
  steps: { marginTop: 20, gap: 10 },
  step: { flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  stepNumber: { width: 18, fontFamily: fonts.displayItalic, fontSize: 18, color: '#A4561F' },
  stepText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15.5, lineHeight: 22, color: day.ink },
  primary: { boxShadow: shadows.rose },
  footnote: { textAlign: 'center', fontSize: 13, fontFamily: fonts.body },
});
