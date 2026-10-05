import type { Match } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow, Heading, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

type Step = 'sealed' | 'deciding' | 'confirming-pass' | 'said-hello' | 'passed';

/** The one-match reveal: sealed until opened, then hello or pass. */
export default function Reveal() {
  const { api } = useSession();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [step, setStep] = useState<Step>('sealed');
  const [mutual, setMutual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.home().then(
      (home) => {
        if (home.result.status !== 'matched') return setMatch(null);
        const found = home.result.match;
        setMatch(found);
        setMutual(found.mutual);
        // Already acted on: skip the envelope.
        if (found.passed) setStep('passed');
        else if (found.saidHello) setStep('said-hello');
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [api]);

  if (match === null) return <Redirect href="/home" />;
  if (match === undefined) {
    return (
      <Screen tone="night">
        <View style={styles.center}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      </Screen>
    );
  }

  async function act(action: 'hello' | 'pass') {
    if (match === null || match === undefined) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'hello') {
        setMutual((await api.sayHello(match.matchId)).mutual);
        setStep('said-hello');
      } else {
        await api.pass(match.matchId);
        setStep('passed');
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'sealed') {
    return (
      <Screen tone="night" footer={<Button label="Open" tone="night" onPress={() => setStep('deciding')} />}>
        <BackButton tone="night" />
        <Eyebrow tone="night" style={styles.eyebrow}>
          This round
        </Eyebrow>
        <Title tone="night" style={styles.sealedTitle}>
          Your match is here.
        </Title>
        <View style={styles.envelope}>
          <View style={styles.seal} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.sealInner}>
              <Feather name="heart" size={36} color={night.bg} />
            </View>
          </View>
          <Body tone="night" style={styles.envelopeText}>
            One person, chosen for you this round. Open it when you're ready.
          </Body>
        </View>
      </Screen>
    );
  }

  const { partner, matchId } = match;
  return (
    <Screen tone="night" scroll footer={renderActions()}>
      <BackButton tone="night" />
      <Eyebrow tone="night" style={styles.eyebrowCenter}>
        You matched with
      </Eyebrow>
      <View style={styles.monogram} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.monogramText}>{partner.displayName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Title tone="night" style={styles.name}>
        {partner.displayName}, {partner.age}
      </Title>
      <View style={styles.verified}>
        <Feather name="shield" size={16} color={night.honey} />
        <Body tone="night" style={styles.verifiedText}>
          {partner.institution === null ? 'Verified' : `Verified at ${partner.institution}`}
        </Body>
      </View>

      {match.reasons.length === 0 ? null : (
        <View style={styles.card}>
          <Heading tone="night">Why you two</Heading>
          {match.reasons.map((reason) => (
            <View key={reason} style={styles.reason}>
              <View style={styles.reasonDot} />
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}
      {error === null ? null : (
        <View style={styles.errorRow}>
          <Notice tone="night" kind="error">{error}</Notice>
        </View>
      )}
    </Screen>
  );

  function renderActions() {
    switch (step) {
      case 'deciding':
        return (
          <>
            <Button label="Say hello" tone="night" onPress={() => void act('hello')} busy={busy} />
            <Button label="Not for me" tone="night" variant="secondary" onPress={() => setStep('confirming-pass')} disabled={busy} />
            <Button
              label="Report"
              tone="night"
              variant="text"
              onPress={() => router.push({ pathname: '/report', params: { matchId, name: partner.displayName } })}
            />
          </>
        );
      case 'confirming-pass':
        return (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Pass on {partner.displayName}?</Text>
            <Text style={styles.sheetBody}>You won't be matched with each other again.</Text>
            <View style={styles.sheetButtons}>
              <Button label="Keep match" variant="secondary" onPress={() => setStep('deciding')} style={styles.sheetButton} />
              <Button label="Yes, pass" onPress={() => void act('pass')} busy={busy} style={[styles.sheetButton, styles.passButton]} />
            </View>
          </View>
        );
      case 'said-hello':
        return mutual ? (
          <>
            <View style={[styles.card, styles.helloCard]}>
              <Heading tone="night">You both said hello</Heading>
              <Body tone="night" style={styles.helloText}>
                {partner.displayName} said hello too, so your conversation is open.
              </Body>
            </View>
            <Button
              label="Open chat"
              tone="night"
              onPress={() => router.push({ pathname: '/chat', params: { matchId } })}
            />
          </>
        ) : (
          <View style={[styles.card, styles.helloCard]}>
            <Heading tone="night">Hello sent</Heading>
            <Body tone="night" style={styles.helloText}>
              When {partner.displayName} says hello too, a conversation opens for you both.
            </Body>
          </View>
        );
      case 'passed':
      default:
        return (
          <>
            <Body tone="night" style={styles.passed}>
              Got it. You're still in for the next round.
            </Body>
            <Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />
          </>
        );
    }
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { marginTop: 24, textAlign: 'center' },
  eyebrowCenter: { marginTop: 8, textAlign: 'center' },
  sealedTitle: { marginTop: 12, textAlign: 'center', fontSize: 40, lineHeight: 43 },
  envelope: {
    marginTop: 40,
    alignSelf: 'center',
    width: 300,
    height: 330,
    borderRadius: 32,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    padding: 24,
  },
  seal: { width: 112, height: 112, borderRadius: 56, backgroundColor: night.ember, alignItems: 'center', justifyContent: 'center' },
  sealInner: { width: 84, height: 84, borderRadius: 42, backgroundColor: night.honey, alignItems: 'center', justifyContent: 'center' },
  envelopeText: { textAlign: 'center', fontSize: 15.5, lineHeight: 23, maxWidth: 220 },
  monogram: { marginTop: 22, alignSelf: 'center', width: 128, height: 128, borderRadius: 64, backgroundColor: night.blush, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: fonts.display, fontSize: 56, color: night.bg },
  name: { marginTop: 18, textAlign: 'center', fontSize: 40, lineHeight: 43 },
  verified: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  verifiedText: { fontSize: 14.5 },
  card: { marginTop: 26, padding: 20, borderRadius: 22, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 10 },
  reason: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  reasonDot: { marginTop: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: night.honey },
  reasonText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: night.text },
  errorRow: { marginTop: 16 },
  sheet: { padding: 20, borderRadius: 22, backgroundColor: night.text },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: night.bg },
  sheetBody: { marginTop: 6, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: '#5E3E4C' },
  sheetButtons: { marginTop: 14, flexDirection: 'row', gap: 10 },
  sheetButton: { flex: 1, height: 48 },
  passButton: { backgroundColor: night.bg },
  helloCard: { marginTop: 0, borderColor: night.honey },
  helloText: { fontSize: 14.5, lineHeight: 21 },
  passed: { textAlign: 'center', fontSize: 15 },
});
