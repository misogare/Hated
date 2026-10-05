import type { ReportReason } from '@hated/api/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'harassment', label: 'Harassment or threats' },
  { id: 'inappropriate', label: 'Inappropriate messages or content' },
  { id: 'spam', label: 'Spam or a scam' },
  { id: 'unsafe', label: 'I feel unsafe' },
  { id: 'other', label: 'Something else' },
];

/** Report a match. Reporting also ends it, so the two are never matched again. */
export default function Report() {
  const { matchId, name } = useLocalSearchParams<{ matchId: string; name?: string }>();
  const { api } = useSession();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const who = name ?? 'your match';

  async function submit() {
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.report(matchId, { reason, ...(details.trim().length > 0 ? { details: details.trim() } : {}) });
      setDone(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen tone="night" footer={<Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />}>
        <View style={styles.center}>
          <Title tone="night" style={styles.centerTitle}>
            Thanks for telling us.
          </Title>
          <Body tone="night" style={styles.centerBody}>
            Your report has been saved for review. This match has ended, and you won't be matched with {who} again.
          </Body>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      tone="night"
      scroll
      footer={<Button label="Report and end match" tone="night" onPress={() => void submit()} disabled={reason === null} busy={busy} />}
    >
      <BackButton tone="night" />
      <Title tone="night" style={styles.title}>
        Report {who}
      </Title>
      <Body tone="night" style={styles.lede}>
        Reporting ends this match, so you won't be matched again. Your report is saved for the HateD team to review.
      </Body>

      <View style={styles.reasons} accessibilityRole="radiogroup" accessibilityLabel="What happened?">
        {REASONS.map((option) => {
          const selected = reason === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setReason(option.id)}
              style={[styles.reason, selected && styles.reasonOn]}
            >
              <View style={[styles.dot, selected && styles.dotOn]} />
              <Text style={styles.reasonText}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Anything else we should know? (optional)</Text>
      <TextInput
        accessibilityLabel="Details"
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
        placeholder="What happened, in your own words"
        placeholderTextColor={night.muted}
        selectionColor={night.honey}
        style={styles.details}
      />
      {error === null ? null : (
        <View style={styles.error}>
          <Notice tone="night" kind="error">{error}</Notice>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 24 },
  lede: { marginTop: 10, fontSize: 15, lineHeight: 22 },
  reasons: { marginTop: 22, gap: 8 },
  reason: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
  },
  reasonOn: { borderColor: night.honey },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: night.muted },
  dotOn: { borderColor: night.honey, backgroundColor: night.honey },
  reasonText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15.5, color: night.text },
  label: { marginTop: 22, marginBottom: 8, fontFamily: fonts.bodySemi, fontSize: 14, color: night.text },
  details: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: night.line,
    backgroundColor: night.surface,
    padding: 14,
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: night.text,
    textAlignVertical: 'top',
  },
  error: { marginTop: 12 },
  center: { flex: 1, justifyContent: 'center', gap: 12 },
  centerTitle: { fontSize: 32, lineHeight: 37 },
  centerBody: { fontSize: 16, lineHeight: 24 },
});
