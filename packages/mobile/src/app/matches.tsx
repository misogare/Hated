import type { MatchSummary } from '@hated/api/contract';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { UnreadBadge } from '@/components/Badge';
import { BackButton, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

/** Every match so far, newest first: open a conversation, or see where things stand. */
export default function Matches() {
  const { api } = useSession();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload on focus, so unread counts drop after reading a conversation.
  useFocusEffect(
    useCallback(() => {
      api.matches().then(
        (response) => {
          setMatches(response.matches);
          setError(null);
        },
        (caught: unknown) => setError(describeError(caught)),
      );
    }, [api]),
  );

  return (
    <Screen tone="night" scroll>
      <BackButton tone="night" />
      <Title tone="night" style={styles.title}>
        Your matches
      </Title>

      {matches === null ? (
        <View style={styles.center}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Body tone="night" style={styles.empty}>
            No matches yet. When a round closes, your match will appear here.
          </Body>
        </View>
      ) : (
        <View style={styles.list}>
          {matches.map((match, index) => (
            <Row key={match.matchId} match={match} latest={index === 0} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function Row({ match, latest }: { match: MatchSummary; latest: boolean }) {
  const open = match.mutual && !match.passed;
  // Only this round's match can still be opened to say hello.
  const target = open ? 'chat' : latest && !match.passed ? 'reveal' : null;
  const round = new Date(match.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const content = (
    <>
      <View style={[styles.monogram, match.passed && styles.dimmed]}>
        <Text style={styles.monogramText}>{match.partner.displayName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, match.passed && styles.mutedText]} numberOfLines={1}>
            {match.partner.displayName}, {match.partner.age}
          </Text>
          <Text style={styles.date}>{round}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, match.unread > 0 && styles.previewUnread]} numberOfLines={1}>
            {status(match, latest)}
          </Text>
          <UnreadBadge count={match.unread} />
        </View>
      </View>
    </>
  );

  if (target === null) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${match.partner.displayName}: ${status(match, latest)}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${match.partner.displayName}: ${status(match, latest)}`}
      onPress={() =>
        target === 'chat' ? router.push({ pathname: '/chat', params: { matchId: match.matchId } }) : router.push('/reveal')
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function status(match: MatchSummary, latest: boolean): string {
  if (match.passed) return 'This match has ended';
  if (match.lastMessage !== null) return `${match.lastMessage.mine ? 'You: ' : ''}${match.lastMessage.body}`;
  if (match.mutual) return 'You both said hello. Start the conversation';
  if (match.saidHello) return `Waiting for ${match.partner.displayName} to say hello`;
  return latest ? 'Say hello to open a conversation' : 'No hello this round';
}

const styles = StyleSheet.create({
  title: { marginTop: 24 },
  center: { paddingVertical: 64, alignItems: 'center' },
  empty: { textAlign: 'center' },
  list: { marginTop: 20, gap: 10, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
  },
  pressed: { opacity: 0.75 },
  monogram: { width: 52, height: 52, borderRadius: 26, backgroundColor: night.blush, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
  monogramText: { fontFamily: fonts.display, fontSize: 24, color: night.bg },
  rowText: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  name: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: night.text },
  mutedText: { color: night.muted },
  date: { fontFamily: fonts.body, fontSize: 12.5, color: night.muted },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: night.muted },
  previewUnread: { fontFamily: fonts.bodySemi, color: night.text },
});
