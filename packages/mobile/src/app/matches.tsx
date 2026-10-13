import type { MatchSummary } from '@hated/api/contract';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { UnreadBadge } from '@/components/Badge';
import { BackButton, Notice } from '@/components/Controls';
import { Avatar } from '@/components/Photo';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow, Title } from '@/components/Text';
import { useLive } from '@/live';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

/** Every match so far, newest first: open a conversation, or see where things stand. */
export default function Matches() {
  const { api } = useSession();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.matches().then(
      (response) => {
        setMatches(response.matches);
        setError(null);
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [api]);

  // Reload on focus, so unread counts drop after reading a conversation, and
  // the moment anything changes.
  useFocusEffect(load);
  useLive(load);

  const [latest, ...earlier] = matches ?? [];
  return (
    <Screen tone="night" glow scroll>
      <BackButton tone="night" />
      <Title tone="night" style={styles.title}>
        Your matches
      </Title>
      <Body tone="night" style={styles.lede}>
        One a round, newest first.
      </Body>

      {matches === null ? (
        <View style={styles.center}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      ) : latest === undefined ? (
        <View style={styles.center}>
          <Body tone="night" style={styles.empty}>
            No matches yet. When a round closes, your match will appear here.
          </Body>
        </View>
      ) : (
        <>
          <Eyebrow tone="night" style={styles.section}>
            {new Date(latest.publishedAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Eyebrow>
          <Row match={latest} latest />
          {earlier.length === 0 ? null : (
            <>
              <Eyebrow tone="night" style={styles.section}>
                Earlier
              </Eyebrow>
              <View style={styles.list}>
                {earlier.map((match) => (
                  <Row key={match.matchId} match={match} latest={false} />
                ))}
              </View>
            </>
          )}
          <Body tone="night" style={styles.footnote}>
            Photos unlock once you both say hello.
          </Body>
        </>
      )}
    </Screen>
  );
}

function Row({ match, latest }: { match: MatchSummary; latest: boolean }) {
  const open = match.mutual && !match.passed;
  // This round's match can be opened to say hello; an earlier one only if a hello is already in.
  const target = open ? 'chat' : !match.passed && (latest || match.saidHello) ? 'reveal' : null;
  const date = new Date(match.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const lastAt = match.lastMessage === null ? null : new Date(match.lastMessage.sentAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const highlighted = open && (latest || match.unread > 0);

  const content = (
    <>
      <View style={match.passed && styles.dimmed}>
        <Avatar name={match.partner.displayName} photo={match.partner.photo} unlocked={match.photosUnlocked} size={56} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, match.passed && styles.mutedText]} numberOfLines={1}>
            {match.partner.displayName}
          </Text>
          <Text style={styles.date}>{latest && lastAt !== null ? lastAt : date}</Text>
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

  const rowStyle = [styles.row, highlighted && styles.rowLive, match.passed && styles.rowEnded];
  if (target === null) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={`${match.partner.displayName}: ${status(match, latest)}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${match.partner.displayName}: ${status(match, latest)}`}
      onPress={() =>
        target === 'chat'
          ? router.push({ pathname: '/chat', params: { matchId: match.matchId } })
          : router.push({ pathname: '/reveal', params: { matchId: match.matchId } })
      }
      style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function status(match: MatchSummary, latest: boolean): string {
  if (match.passed) return 'This conversation has ended';
  if (match.lastMessage !== null) return `${match.lastMessage.mine ? 'You: ' : ''}${match.lastMessage.body}`;
  if (match.mutual) return 'You both said hello. Start the conversation';
  if (match.saidHello) return `You said hello · waiting for ${match.partner.displayName}`;
  return latest ? 'Open it when you’re ready' : 'No hello this round';
}

const styles = StyleSheet.create({
  title: { marginTop: 22, fontSize: 36, lineHeight: 39 },
  lede: { marginTop: 6, fontSize: 15 },
  center: { paddingVertical: 64, alignItems: 'center' },
  empty: { textAlign: 'center' },
  section: { marginTop: 26, marginBottom: 10, fontSize: 12, letterSpacing: 1.6 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 22,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
  },
  rowLive: { borderColor: night.honey },
  rowEnded: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.45 },
  rowText: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  name: { flexShrink: 1, fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: night.text },
  mutedText: { color: night.muted },
  date: { fontFamily: fonts.body, fontSize: 12.5, color: night.muted },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: night.muted },
  previewUnread: { fontFamily: fonts.bodySemi, color: night.text },
  footnote: { marginTop: 22, textAlign: 'center', fontSize: 13.5 },
});
