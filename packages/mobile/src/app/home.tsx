import type { FeedbackAnswer, Home as HomeData, Match } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { UnreadBadge } from '@/components/Badge';
import { Candle } from '@/components/Candle';
import { NightSwitch, Notice, Wordmark } from '@/components/Controls';
import { LockBadge, ProfilePhoto } from '@/components/Photo';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow } from '@/components/Text';
import { roundTime } from '@/copy';
import { DEMO, demo } from '@/demo';
import { useLive } from '@/live';
import { registerForPush, useNotificationRouting } from '@/notifications';
import { useSession } from '@/session';
import { fonts, night, shadows } from '@/theme';
import { timeLeft, useNow } from '@/time';

/** Rounds are weekly: the candle is full a week before the round closes. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Home, in the evening palette: the candle burning down to the next round, and the latest result. */
export default function Home() {
  const { api } = useSession();
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      setHome(await api.home());
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api]);

  // Reload whenever the screen comes back into view (after a reveal or an edit).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Home is where everyone who finished onboarding lands, so ask about
  // notifications here (the system asks once) and open what a tapped one is about.
  useEffect(() => {
    void registerForPush(api).then((setup) => {
      if (__DEV__ && !setup.ok && setup.reason !== 'unsupported') console.info(`[push] not set up: ${setup.reason}${setup.detail ? ` (${setup.detail})` : ''}`);
    });
  }, [api]);
  useNotificationRouting(load);
  // Anything that changes for this person (a hello back, a message, a round) shows at once.
  useLive(() => void load());

  async function toggle(active: boolean) {
    if (home === null) return;
    setToggling(true);
    setHome({ ...home, isActive: active });
    try {
      await api.setActive(active);
    } catch (caught) {
      setHome({ ...home });
      setError(describeError(caught));
    } finally {
      setToggling(false);
    }
  }

  return (
    <Screen tone="night" scroll glow>
      <View style={styles.header}>
        <Wordmark tone="night" size={24} />
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={styles.iconButton}>
          <Feather name="sliders" size={19} color={night.text} />
        </Pressable>
      </View>

      {home === null ? (
        <View style={styles.loading}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      ) : (
        <>
          <Countdown nextRoundAt={home.nextRoundAt} />
          {DEMO ? <SkipAhead to={roundTime(home.nextRoundAt)} /> : null}

          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, home.isActive ? styles.statusOn : styles.statusOff]} />
              <Text style={styles.statusTitle}>{home.isActive ? `You're in ${weekday(home.nextRoundAt)}'s round` : "You're sitting this one out"}</Text>
              <NightSwitch accessibilityLabel="Take part in this round" value={home.isActive} onValueChange={(on) => void toggle(on)} disabled={toggling} />
            </View>
            <Body tone="night" style={styles.statusBody}>
              {home.isActive ? "We'll use your answers as they are when it closes." : 'Switch back on any time before it closes.'}
            </Body>
          </View>

          <Result home={home} />
          {home.feedbackDue === null ? null : <Feedback key={home.feedbackDue.matchId} due={home.feedbackDue} />}

          <View style={styles.tiles}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={home.unreadTotal > 0 ? `Your matches, ${home.unreadTotal} unread` : 'Your matches'}
              onPress={() => router.push('/matches')}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <View style={styles.tileTop}>
                <Feather name="users" size={20} color={night.honey} />
                <UnreadBadge count={home.unreadTotal} />
              </View>
              <Text style={styles.tileTitle}>Your matches</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/onboarding/photos', params: { edit: '1' } })}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <View style={styles.tileTop}>
                <Feather name="image" size={20} color={night.honey} />
              </View>
              <Text style={styles.tileTitle}>Your profile</Text>
            </Pressable>
          </View>

          {error === null ? null : <Notice tone="night" kind="error">{error}</Notice>}
          <Body tone="night" style={styles.footnote}>
            One match per round, at most.{'\n'}Everyone hears at the same moment.
          </Body>
        </>
      )}
    </Screen>
  );
}

/** The day the round closes, e.g. "Sunday". */
function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

/** The candle, and how long is left: days and hours large, minutes and seconds ticking under them. */
function Countdown({ nextRoundAt }: { nextRoundAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = Math.max(0, new Date(nextRoundAt).getTime() - now);
  const remaining = Math.floor(remainingMs / 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  return (
    <View
      style={styles.countdown}
      accessible
      accessibilityLabel={`${weekday(nextRoundAt)}'s round closes in ${days} days, ${hours} hours and ${minutes} minutes, ${roundTime(nextRoundAt)}`}
    >
      <Candle left={remainingMs / WEEK_MS} />
      <View style={styles.countdownText}>
        <Eyebrow tone="night" style={styles.eyebrow}>
          {weekday(nextRoundAt)}'s round closes in
        </Eyebrow>
        <Text style={styles.big}>
          {days}d {pad(hours)}h
        </Text>
        <Text style={styles.small}>
          {pad(minutes)}m {pad(seconds)}s
        </Text>
        <Text style={styles.when}>{roundTime(nextRoundAt)}</Text>
      </View>
    </View>
  );
}

/** The demo can't make anyone wait a week: run the next round now. */
function SkipAhead({ to }: { to: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Demo only: runs the next round now instead of waiting for it"
      disabled={busy}
      onPress={() => {
        setBusy(true);
        void demo.skipToNextRound().finally(() => setBusy(false));
      }}
      style={({ pressed }) => [styles.skip, (pressed || busy) && styles.pressed]}
    >
      <Feather name="fast-forward" size={16} color={night.honey} />
      <Text style={styles.skipText}>Demo: skip to {to}</Text>
    </Pressable>
  );
}

/** The latest published round, when there is one to act on. */
function Result({ home }: { home: HomeData }) {
  const now = useNow(30_000);
  const result = home.result;
  if (result.status === 'none') return null;
  if (result.status === 'unmatched') {
    return (
      <>
        <Eyebrow tone="night" style={styles.section}>
          Last round
        </Eyebrow>
        <Pressable accessibilityRole="link" onPress={() => router.push('/no-match')} style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
          <View style={styles.resultText}>
            <Text style={styles.resultName}>No match this time</Text>
            <Text style={styles.resultStatus}>What that means, and what helps</Text>
          </View>
          <Feather name="chevron-right" size={20} color={night.muted} />
        </Pressable>
      </>
    );
  }

  const { match } = result;
  if (match.passed) return null;
  const opened = match.saidHello || match.mutual || match.expired;
  const photo = match.partner.photos[0];
  return (
    <>
      <Eyebrow tone="night" style={styles.section}>
        Last round
      </Eyebrow>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${opened ? match.partner.displayName : 'Your match'}: ${status(match, now)}`}
        onPress={() => (match.mutual ? router.push({ pathname: '/chat', params: { matchId: match.matchId } }) : router.push('/reveal'))}
        style={({ pressed }) => [styles.result, !match.expired && styles.resultLive, pressed && styles.pressed]}
      >
        {opened && photo !== undefined ? (
          <View style={styles.thumb}>
            <ProfilePhoto photo={photo} unlocked={match.photosUnlocked} style={StyleSheet.absoluteFill} />
            {match.photosUnlocked ? null : (
              <View style={styles.thumbLock}>
                <LockBadge size={22} />
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.thumb, styles.sealThumb]}>
            <Text style={styles.sealLetter}>D</Text>
          </View>
        )}
        <View style={styles.resultText}>
          <Text style={styles.resultName}>{opened ? `${match.partner.displayName}, ${match.partner.age}` : 'Your match is here'}</Text>
          <Text style={styles.resultStatus}>{status(match, now)}</Text>
        </View>
        <UnreadBadge count={match.unread} />
        <Feather name="chevron-right" size={20} color={night.muted} />
      </Pressable>
    </>
  );
}

const FEEDBACK: { answer: FeedbackAnswer; label: string }[] = [
  { answer: 'well', label: 'Really well' },
  { answer: 'okay', label: 'It was okay' },
  { answer: 'not-for-me', label: 'Not for me' },
];

/** Once, about a past match: how did it go? Only HateD sees the answer. */
function Feedback({ due }: { due: NonNullable<HomeData['feedbackDue']> }) {
  const { api } = useSession();
  const [done, setDone] = useState<'answered' | 'skipped' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(answer: FeedbackAnswer | null) {
    setBusy(true);
    setError(null);
    try {
      await api.feedback(due.matchId, answer);
      setDone(answer === null ? 'skipped' : 'answered');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (done === 'skipped') return null;
  return (
    <View style={styles.feedback} accessibilityLiveRegion="polite">
      {done === 'answered' ? (
        <Text style={styles.feedbackThanks}>Thanks. That helps choose better matches.</Text>
      ) : (
        <>
          <Text style={styles.feedbackTitle}>How did it go with {due.partnerName}?</Text>
          <View style={styles.feedbackChoices}>
            {FEEDBACK.map((choice) => (
              <Pressable
                key={choice.answer}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void send(choice.answer)}
                style={({ pressed }) => [styles.feedbackChoice, pressed && styles.pressed]}
              >
                <Text style={styles.feedbackChoiceText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.feedbackFoot}>
            <Text style={styles.feedbackNote}>Only HateD sees this, never {due.partnerName}.</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send(null)} style={({ pressed }) => pressed && styles.pressed}>
              <Text style={styles.feedbackSkip}>Skip</Text>
            </Pressable>
          </View>
          {error === null ? null : (
            <Notice tone="night" kind="error">
              {error}
            </Notice>
          )}
        </>
      )}
    </View>
  );
}

function status(match: Match, now: number): string {
  if (match.mutual) return match.unread > 0 ? 'New messages' : 'You both said hello';
  if (match.expired) return 'The time to say hello is up';
  const left = timeLeft(match.helloDeadline, now);
  if (match.saidHello) return `Waiting for ${match.partner.displayName} · ${left} left`;
  return `${left} left to say hello`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: night.surface, alignItems: 'center', justifyContent: 'center' },
  loading: { paddingVertical: 96, alignItems: 'center' },
  countdown: { marginTop: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  countdownText: { flex: 1, paddingBottom: 8 },
  eyebrow: { fontSize: 12, letterSpacing: 1.6 },
  big: { marginTop: 10, fontFamily: fonts.display, fontSize: 52, lineHeight: 54, letterSpacing: -1, color: night.honey, fontVariant: ['tabular-nums'] },
  small: { marginTop: 2, fontFamily: fonts.display, fontSize: 25, lineHeight: 30, color: '#E9C99A', fontVariant: ['tabular-nums'] },
  when: { marginTop: 10, fontFamily: fonts.body, fontSize: 14.5, color: night.muted },
  skip: {
    marginTop: 18,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: night.outline,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  skipText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: night.honey },
  card: { marginTop: 22, padding: 18, borderRadius: 24, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, boxShadow: shadows.card },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusOn: { backgroundColor: night.honey, boxShadow: '0px 0px 0px 5px rgba(240, 178, 86, 0.18)' },
  statusOff: { borderWidth: 2, borderColor: night.muted },
  statusTitle: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16.5, color: night.text },
  statusBody: { marginTop: 8, marginLeft: 22, fontSize: 14, lineHeight: 21 },
  section: { marginTop: 26, marginBottom: 10, fontSize: 12, letterSpacing: 1.6 },
  result: {
    padding: 12,
    borderRadius: 24,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  resultLive: { borderColor: night.honey },
  thumb: { width: 62, height: 78, borderRadius: 16, overflow: 'hidden', backgroundColor: night.line },
  thumbLock: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  sealThumb: { backgroundColor: night.wax, alignItems: 'center', justifyContent: 'center' },
  sealLetter: { fontFamily: fonts.displayBold, fontSize: 30, color: night.waxDeep },
  resultText: { flex: 1, gap: 4, paddingLeft: 2 },
  resultName: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: night.text },
  resultStatus: { fontFamily: fonts.body, fontSize: 14, color: night.muted },
  tiles: { marginTop: 12, flexDirection: 'row', gap: 12 },
  tile: { flex: 1, minHeight: 84, padding: 16, borderRadius: 20, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, justifyContent: 'space-between', gap: 10 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: night.text },
  pressed: { opacity: 0.75 },
  feedback: { marginTop: 22, padding: 18, borderRadius: 24, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 12 },
  feedbackTitle: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: night.text },
  feedbackChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feedbackChoice: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: night.outline, justifyContent: 'center' },
  feedbackChoiceText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: night.text },
  feedbackFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  feedbackNote: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: night.muted },
  feedbackSkip: { fontFamily: fonts.bodySemi, fontSize: 14, color: night.honey, paddingVertical: 8 },
  feedbackThanks: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: night.text },
  footnote: { marginTop: 26, marginBottom: 8, textAlign: 'center', fontSize: 13.5, lineHeight: 20 },
});
