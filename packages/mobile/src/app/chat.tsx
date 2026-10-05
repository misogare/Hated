import type { ChatMessage, Match } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

/** How often to look for new messages while the conversation is open. */
const POLL_MS = 3000;
const MAX_LENGTH = 2000;

/** The conversation with this round's match, once both have said hello. */
export default function Chat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { api } = useSession();
  const [partner, setPartner] = useState<Match['partner'] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const newest = useRef<string | undefined>(undefined);

  /** Add messages not seen yet, keeping order and the newest id for the next poll. */
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set((current ?? []).map((message) => message.id));
      const next = [...(current ?? []), ...incoming.filter((message) => !known.has(message.id))];
      newest.current = next.at(-1)?.id;
      return next;
    });
  }, []);

  useEffect(() => {
    api.home().then(
      (home) => {
        if (home.result.status === 'matched' && home.result.match.matchId === matchId) setPartner(home.result.match.partner);
      },
      () => undefined,
    );
  }, [api, matchId]);

  const poll = useCallback(async () => {
    try {
      const { messages: incoming } = await api.messages(matchId, newest.current);
      setMessages((current) => current ?? []);
      merge(incoming);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 'passed' || caught.code === 'not-mutual' || caught.code === 'not-found')) {
        setClosed(caught.code === 'not-mutual' ? describeError(caught) : 'This conversation has ended.');
      } else {
        setError(describeError(caught));
      }
    }
  }, [api, matchId, merge]);

  // Poll only while the screen is in view.
  useFocusEffect(
    useCallback(() => {
      void poll();
      const timer = setInterval(() => void poll(), POLL_MS);
      return () => clearInterval(timer);
    }, [poll]),
  );

  async function send() {
    const body = draft.trim();
    if (body.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const { message } = await api.sendMessage(matchId, body);
      merge([message]);
      setDraft('');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSending(false);
    }
  }

  const name = partner?.displayName ?? 'Your match';
  const newestFirst = messages === null ? [] : [...messages].reverse();

  if (closed !== null) {
    return (
      <Screen tone="night" footer={<Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />}>
        <BackButton tone="night" />
        <View style={styles.center}>
          <Title tone="night" style={styles.centerTitle}>
            {closed}
          </Title>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      tone="night"
      style={styles.body}
      footer={
        <View style={styles.composer}>
          {error === null ? null : <Notice tone="night" kind="error">{error}</Notice>}
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel="Message"
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={night.muted}
              selectionColor={night.honey}
              multiline
              maxLength={MAX_LENGTH}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: draft.trim().length === 0 || sending }}
              disabled={draft.trim().length === 0 || sending}
              onPress={() => void send()}
              style={[styles.send, (draft.trim().length === 0 || sending) && styles.sendDisabled]}
            >
              {sending ? <ActivityIndicator color={night.bg} /> : <Feather name="send" size={20} color={night.bg} />}
            </Pressable>
          </View>
        </View>
      }
    >
      <View style={styles.header}>
        <BackButton tone="night" />
        <View style={styles.monogram} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.monogramText}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} accessibilityRole="header">
            {partner === null ? name : `${partner.displayName}, ${partner.age}`}
          </Text>
          <Text style={styles.subtitle}>{partner?.institution ? `Verified at ${partner.institution}` : 'Your match this round'}</Text>
        </View>
      </View>

      {messages === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={night.honey} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Title tone="night" style={styles.centerTitle}>
            You both said hello.
          </Title>
          <Body tone="night" style={styles.centerBody}>
            Say something you would actually say in person.
          </Body>
        </View>
      ) : (
        <FlatList
          inverted
          data={newestFirst}
          keyExtractor={(message) => message.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            // The list is newest first, so the next-older message sits at index + 1.
            const newer = index > 0 ? newestFirst[index - 1] : undefined;
            const lastInRun = newer === undefined || newer.mine !== item.mine;
            return <Bubble message={item} showTime={lastInRun} />;
          }}
        />
      )}
    </Screen>
  );
}

function Bubble({ message, showTime }: { message: ChatMessage; showTime: boolean }) {
  const time = new Date(message.sentAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.bubbleRow, message.mine ? styles.mineRow : styles.theirsRow]}>
      <View style={[styles.bubble, message.mine ? styles.mine : styles.theirs]}>
        <Text style={[styles.bubbleText, { color: message.mine ? night.bg : night.text }]}>{message.body}</Text>
      </View>
      {showTime ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: night.line,
  },
  monogram: { width: 44, height: 44, borderRadius: 22, backgroundColor: night.blush, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: fonts.display, fontSize: 20, color: night.bg },
  headerText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.displayBold, fontSize: 19, color: night.text },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: night.muted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  centerTitle: { textAlign: 'center', fontSize: 28, lineHeight: 33 },
  centerBody: { textAlign: 'center', fontSize: 15.5 },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 6 },
  bubbleRow: { maxWidth: '82%', gap: 4 },
  mineRow: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsRow: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  mine: { backgroundColor: night.honey, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, borderBottomLeftRadius: 6 },
  bubbleText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  time: { fontFamily: fonts.body, fontSize: 11.5, color: night.muted, marginBottom: 6 },
  composer: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: night.line,
    backgroundColor: night.surface,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 13,
    fontFamily: fonts.body,
    fontSize: 16,
    color: night.text,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: night.honey, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.45 },
});
