import type { ChatMessage, MatchDetail } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { MeetingCircles } from '@/components/MeetingCircles';
import { Avatar } from '@/components/Photo';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { useLive, useLiveConnected } from '@/live';
import { NATIVE_DRIVER, useReducedMotion } from '@/motion';
import { useOpenChat } from '@/notifications';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

/** How often to look for new messages while the conversation is open, without and with the live connection. */
const POLL_MS = 3000;
const POLL_LIVE_MS = 15_000;
const MAX_LENGTH = 2000;
/** How long "typing" shows after the other person's last word of it, and how often this app says it. */
const TYPING_SHOWN_MS = 5000;
const TYPING_EVERY_MS = 3000;

/** The conversation with a match, once both have said hello. */
export default function Chat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { api } = useSession();
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const newest = useRef<string | undefined>(undefined);
  /** Until when the other person is shown typing (0: they aren't). */
  const [typingUntil, setTypingUntil] = useState(0);
  const lastTyping = useRef(0);
  const live = useLiveConnected();
  useOpenChat(matchId);

  /** Add messages not seen yet, keeping order and the newest id for the next poll. */
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    // Their message is here, so they're done typing it.
    if (incoming.some((message) => !message.mine)) setTypingUntil(0);
    setMessages((current) => {
      const known = new Set((current ?? []).map((message) => message.id));
      const next = [...(current ?? []), ...incoming.filter((message) => !known.has(message.id))];
      newest.current = next.at(-1)?.id;
      return next;
    });
  }, []);

  // Who this is with (from any round), and openers for an empty conversation.
  useEffect(() => {
    api.match(matchId).then(setDetail, () => undefined);
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

  // New messages (and the match ending) arrive over the live connection at once.
  useLive((event) => {
    if ((event.type === 'message' || event.type === 'ended') && event.matchId === matchId) void poll();
    if (event.type === 'typing' && event.matchId === matchId) setTypingUntil(Date.now() + TYPING_SHOWN_MS);
  });

  // "Typing" fades after a few seconds unless they keep at it.
  useEffect(() => {
    if (typingUntil === 0) return;
    const timer = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [typingUntil]);

  /** Keep the draft, and now and then tell the other person something is being written. */
  function write(text: string) {
    setDraft(text);
    if (text.trim() === '' || Date.now() - lastTyping.current < TYPING_EVERY_MS) return;
    lastTyping.current = Date.now();
    void api.typing(matchId).catch(() => undefined);
  }

  // Poll only while the screen is in view, and rarely while the live connection is up.
  useFocusEffect(
    useCallback(() => {
      void poll();
      const timer = setInterval(() => void poll(), live ? POLL_LIVE_MS : POLL_MS);
      return () => clearInterval(timer);
    }, [poll, live]),
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

  const partner = detail?.match.partner ?? null;
  const name = partner?.displayName ?? 'Your match';
  const newestFirst = messages === null ? [] : [...messages].reverse();

  if (closed !== null) {
    return (
      <Screen tone="night" glow footer={<Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />}>
        <BackButton tone="night" />
        <View style={styles.center}>
          <Title tone="night" style={styles.centerTitle}>
            {closed}
          </Title>
        </View>
      </Screen>
    );
  }

  const canSend = draft.trim().length > 0 && !sending;
  return (
    <Screen
      tone="night"
      style={styles.body}
      footer={
        <View style={styles.composer}>
          {error === null ? null : <Notice tone="night" kind="error">{error}</Notice>}
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={`Message to ${name}`}
              value={draft}
              onChangeText={write}
              placeholder={partner === null ? 'Write a message' : `Write to ${partner.displayName}…`}
              placeholderTextColor={night.muted}
              selectionColor={night.honey}
              multiline
              maxLength={MAX_LENGTH}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={() => void send()}
              style={[styles.send, !canSend && styles.sendDisabled]}
            >
              {sending ? <ActivityIndicator color={night.bg} /> : <Feather name="arrow-up" size={21} color={night.bg} />}
            </Pressable>
          </View>
        </View>
      }
    >
      <View style={styles.header}>
        <BackButton tone="night" />
        <Avatar name={name} photo={partner?.photos[0] ?? null} unlocked={detail?.match.photosUnlocked ?? false} size={44} ring />
        <Pressable
          accessibilityRole="link"
          accessibilityHint="Shows their profile"
          disabled={detail === null}
          onPress={() => router.push({ pathname: '/reveal', params: { matchId } })}
          style={styles.headerText}
        >
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {partner === null ? name : `${partner.displayName}, ${partner.age}`}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle(detail)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Report ${name}`}
          onPress={() => router.push({ pathname: '/report', params: { matchId, name } })}
          style={styles.more}
        >
          <Feather name="flag" size={18} color={night.muted} />
        </Pressable>
      </View>

      {messages === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={night.honey} />
        </View>
      ) : messages.length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.pill}>You both said hello</Text>
          <View style={styles.starter}>
            <MeetingCircles size={34} />
            <Text style={styles.starterTitle}>Not sure how to start?</Text>
            <Body tone="night" style={styles.starterBody}>
              A few openers from what you two have in common. Tap one to use it, or say something you'd actually say in person.
            </Body>
            {(detail?.match.openers ?? []).map((opener) => (
              <Pressable
                key={opener}
                accessibilityRole="button"
                accessibilityHint="Puts this in your message"
                onPress={() => setDraft(opener)}
                style={({ pressed }) => [styles.opener, pressed && styles.pressed]}
              >
                <Text style={styles.openerText}>{opener}</Text>
              </Pressable>
            ))}
          </View>
          {typingUntil === 0 ? null : <Typing name={name} />}
        </ScrollView>
      ) : (
        <FlatList
          inverted
          data={newestFirst}
          keyExtractor={(message) => message.id}
          contentContainerStyle={styles.list}
          // The list is upside down: its header sits under the newest message.
          ListHeaderComponent={typingUntil === 0 ? null : <Typing name={name} />}
          ListFooterComponent={<Text style={[styles.pill, styles.pillTop]}>You both said hello</Text>}
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

/** "Matched Sunday · Victoria University", from what is known so far. */
function subtitle(detail: MatchDetail | null): string {
  if (detail === null) return 'Your match';
  const day = new Date(detail.publishedAt).toLocaleDateString(undefined, { weekday: 'long' });
  const institution = detail.match.partner.institution;
  return institution === null ? `Matched ${day}` : `Matched ${day} · ${institution}`;
}

/** The dots of one dot's turn to brighten, as the loop goes round. */
const DOTS = [
  { input: [0, 1 / 6, 1 / 3, 1], output: [0.35, 1, 0.35, 0.35] },
  { input: [0, 1 / 3, 1 / 2, 2 / 3, 1], output: [0.35, 0.35, 1, 0.35, 0.35] },
  { input: [0, 2 / 3, 5 / 6, 1], output: [0.35, 0.35, 1, 0.35] },
];

/** "Maya is typing": three dots in a bubble of theirs, brightening in turn (still, for less motion). */
function Typing({ name }: { name: string }) {
  const reduced = useReducedMotion();
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [reduced, phase]);
  return (
    <View style={[styles.bubbleRow, styles.theirsRow]} accessible accessibilityLabel={`${name} is typing`} accessibilityLiveRegion="polite">
      <View style={[styles.bubble, styles.theirs, styles.typing]}>
        {DOTS.map((dot, index) => (
          <Animated.View
            key={index}
            style={[styles.dot, { opacity: reduced ? 0.6 : phase.interpolate({ inputRange: dot.input, outputRange: dot.output }) }]}
          />
        ))}
      </View>
    </View>
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3F2534',
  },
  headerText: { flex: 1, gap: 2 },
  more: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: night.text },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: night.muted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  centerTitle: { textAlign: 'center', fontSize: 28, lineHeight: 33 },
  emptyScroll: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 18, gap: 12 },
  pill: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#34202C',
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: night.muted,
    overflow: 'hidden',
  },
  pillTop: { marginBottom: 10 },
  starter: { padding: 20, borderRadius: 26, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 8 },
  starterTitle: { marginTop: 8, fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: night.text },
  starterBody: { fontSize: 14.5, lineHeight: 21 },
  opener: { marginTop: 4, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: night.outline },
  openerText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: night.text },
  pressed: { opacity: 0.7 },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 6 },
  bubbleRow: { maxWidth: '80%', gap: 4 },
  mineRow: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsRow: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20 },
  mine: { backgroundColor: night.honey, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, borderBottomLeftRadius: 6 },
  bubbleText: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 15 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: night.muted },
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
    fontSize: 15.5,
    color: night.text,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: night.honey, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
});
