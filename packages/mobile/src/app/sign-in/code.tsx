import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Label, Title } from '@/components/Text';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

const CODE_LENGTH = 6;

/** Enter the emailed code. Submits by itself once all six digits are in. */
export default function SignInCode() {
  const params = useLocalSearchParams<{ verificationId: string; email: string }>();
  const { api, signIn } = useSession();
  const [verificationId, setVerificationId] = useState(params.verificationId);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function verify(candidate: string) {
    setBusy(true);
    setMessage(null);
    try {
      const session = await api.verifyCode(verificationId, candidate);
      // Signing in swaps the route set; the layout then routes to wherever onboarding left off.
      await signIn(session.token);
    } catch (caught) {
      setCode('');
      setMessage({ kind: 'error', text: failure(caught) });
      if (caught instanceof ApiError && caught.code !== 'invalid-code' && caught.code !== 'network') setLocked(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setMessage(null);
    try {
      const sent = await api.sendCode(params.email);
      setVerificationId(sent.verificationId);
      setCode('');
      setLocked(false);
      setMessage({ kind: 'success', text: 'New code sent. Your earlier code no longer works.' });
    } catch (caught) {
      setMessage({ kind: 'error', text: describeError(caught) });
    }
  }

  function onChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && !busy) void verify(digits);
  }

  return (
    <Screen
      footer={<Button label="Continue" onPress={() => void verify(code)} disabled={code.length < CODE_LENGTH || locked} busy={busy} />}
    >
      <BackButton />
      <Title style={styles.title}>Check your inbox</Title>
      <Body style={styles.lede}>
        We sent a 6-digit code to <Text style={styles.email}>{params.email}</Text>. It expires in 10 minutes.
      </Body>

      <View style={styles.form}>
        <Label>Verification code</Label>
        <TextInput
          accessibilityLabel="Verification code"
          value={code}
          onChangeText={onChange}
          editable={!busy && !locked}
          autoFocus
          maxLength={CODE_LENGTH}
          inputMode="numeric"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          placeholder="······"
          placeholderTextColor={day.field}
          selectionColor={day.accent}
          style={styles.code}
        />
        {message === null ? null : <Notice kind={message.kind}>{message.text}</Notice>}
      </View>

      <View style={styles.help}>
        <Body style={styles.helpText}>
          Not there after a minute? Check your spam or junk folder. School inboxes can be strict with new senders.
        </Body>
        <Button label="Send a new code" variant="text" onPress={() => void resend()} style={styles.resend} />
      </View>
    </Screen>
  );
}

function failure(error: unknown): string {
  if (!(error instanceof ApiError)) return describeError(error);
  switch (error.code) {
    case 'invalid-code': {
      const left = error.body?.attemptsRemaining ?? 0;
      return `That code didn't match. ${left === 1 ? '1 try' : `${left} tries`} left.`;
    }
    case 'too-many-attempts':
      return 'Too many tries. Ask for a new code below.';
    case 'expired':
      return 'That code has expired. Ask for a new one below.';
    case 'already-verified':
    case 'unknown':
      return 'That code has already been used. Ask for a new one below.';
    default:
      return describeError(error);
  }
}

const styles = StyleSheet.create({
  title: { marginTop: 24 },
  lede: { marginTop: 12 },
  email: { fontFamily: fonts.bodySemi, color: day.ink },
  form: { marginTop: 28, gap: 10 },
  code: {
    height: 72,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: day.field,
    backgroundColor: day.surface,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 34,
    letterSpacing: 14,
    color: day.ink,
  },
  help: { marginTop: 20, padding: 18, borderRadius: 18, backgroundColor: day.card, borderWidth: 1, borderColor: day.line },
  helpText: { fontSize: 14.5, lineHeight: 21 },
  resend: { alignSelf: 'flex-start', paddingHorizontal: 0, marginTop: 4 },
});
