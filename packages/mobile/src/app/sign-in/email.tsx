import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Field, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { DEMO } from '@/demo';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

/** Looks like a complete address. The API decides whether it is allowed. */
const COMPLETE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
/** School and government endings; a quick hint before the API's real allowlist. */
const INSTITUTIONAL = /\.(edu|gov)(\.[a-z]{2})?$|\.ac\.[a-z]{2}$/;

export default function SignInEmail() {
  const { api } = useSession();
  // The demo fills in an address, so trying it is one tap.
  const [email, setEmail] = useState(DEMO ? 'you@demo.edu' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = email.trim().toLowerCase();
  const complete = COMPLETE.test(normalized);
  const looksPersonal = complete && !INSTITUTIONAL.test(normalized.slice(normalized.lastIndexOf('@') + 1));

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.sendCode(normalized);
      router.push({ pathname: '/sign-in/code', params: { verificationId: sent.verificationId, email: sent.email } });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'unsupported-domain'
          ? "HateD isn't open to that address yet. Use your school or government email."
          : describeError(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button label="Send my code" onPress={send} disabled={!complete || looksPersonal} busy={busy} />
          <View style={styles.privacy}>
            <Feather name="lock" size={15} color={day.muted} />
            <Text style={styles.privacyText}>Never shown on your profile.</Text>
          </View>
        </>
      }
    >
      <BackButton />
      <Title style={styles.title}>What's your school or work email?</Title>
      <Body style={styles.lede}>
        We use it once, to confirm you're a real person at a real institution. Your match never sees it.
      </Body>

      <View style={styles.form}>
        <Field
          label="Email"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError(null);
          }}
          onSubmitEditing={() => complete && !looksPersonal && void send()}
          placeholder="you@university.edu"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          inputMode="email"
          keyboardType="email-address"
          returnKeyType="send"
          textContentType="emailAddress"
        />
        {error !== null ? (
          <Notice kind="error">{error}</Notice>
        ) : looksPersonal ? (
          <Notice kind="error">That looks like a personal address. HateD needs an email from a school or government domain.</Notice>
        ) : (
          <Notice kind="info">
            {DEMO
              ? 'This is a demo: no email is sent, and any school-style address works.'
              : 'Works with addresses like .edu, .edu.au, .ac.uk and .gov from participating institutions.'}
          </Notice>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 24 },
  lede: { marginTop: 12 },
  form: { marginTop: 28, gap: 10 },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  privacyText: { fontFamily: fonts.body, fontSize: 13, color: day.muted },
});
