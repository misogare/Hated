import type { Match } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { ApiError, describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice } from '@/components/Controls';
import { Envelope } from '@/components/Envelope';
import { MeetingCircles } from '@/components/MeetingCircles';
import { LockBadge, ProfilePhoto } from '@/components/Photo';
import { Highlights, PromptCard, Quote, Reasons } from '@/components/Profile';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow } from '@/components/Text';
import { useLive, useLiveConnected } from '@/live';
import { NATIVE_DRIVER } from '@/motion';
import { useSession } from '@/session';
import { fonts, night, shadows } from '@/theme';
import { timeLeft, useNow } from '@/time';

/**
 * - sealed / opening: the envelope, before and while it opens.
 * - deciding / confirming-pass: reading the profile, then hello or pass.
 * - waiting: said hello; watching for theirs.
 * - meeting: it just became mutual; the circles meet, then the chat opens.
 * - together: it was already mutual when this screen opened.
 * - passed: the match has ended.
 * - expired: the time to say hello ran out before both had.
 */
type Step = 'sealed' | 'opening' | 'deciding' | 'confirming-pass' | 'waiting' | 'meeting' | 'together' | 'passed' | 'expired';

/** The steps in which the window to say hello is still being waited on. */
const OPEN_STEPS: readonly Step[] = ['sealed', 'opening', 'deciding', 'confirming-pass', 'waiting'];

/** How often to look for the other person's hello while waiting here, without and with the live connection. */
const WATCH_MS = 4000;
const WATCH_LIVE_MS = 20_000;
/** How long the "you both said hello" moment lasts before the chat opens. */
const MEETING_MS = 2600;

function stepFor(match: Match): Step {
  if (match.passed) return 'passed';
  if (match.mutual) return 'together';
  if (match.expired) return 'expired';
  if (match.saidHello) return 'waiting';
  return 'sealed';
}

/**
 * The one-match reveal: sealed until opened, then the other person's profile
 * and hello or pass. This round's match by default, or any match with
 * `?matchId=`; `&moment=mutual` opens on the moment both said hello (when it
 * happened while this person was elsewhere in the app).
 */
export default function Reveal() {
  const { matchId: wanted, moment } = useLocalSearchParams<{ matchId?: string; moment?: string }>();
  const { api } = useSession();
  const live = useLiveConnected();
  const now = useNow(15_000);
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [step, setStep] = useState<Step>('sealed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = wanted
      ? api.match(wanted).then((detail) => detail.match)
      : api.home().then((home) => (home.result.status === 'matched' ? home.result.match : null));
    load.then(
      (found) => {
        setMatch(found);
        if (found !== null) setStep(moment === 'mutual' && found.mutual && !found.passed ? 'meeting' : stepFor(found));
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [api, wanted, moment]);

  const matchId = match?.matchId;

  /** Fetch the match again, e.g. to pick up unlocked photos. Returns it. */
  const reload = useCallback(async () => {
    if (matchId === undefined) return null;
    const { match: fresh } = await api.match(matchId);
    setMatch(fresh);
    return fresh;
  }, [api, matchId]);

  /** Fetch the match again and move on if it has changed: both said hello, or it ended. */
  const check = useCallback(() => {
    reload().then(
      (fresh) => {
        if (fresh?.passed) setStep('passed');
        else if (fresh?.mutual) setStep((current) => (current === 'deciding' || current === 'confirming-pass' || current === 'waiting' ? 'meeting' : current));
        else if (fresh?.expired) setStep((current) => (OPEN_STEPS.includes(current) ? 'expired' : current));
      },
      () => undefined,
    );
  }, [reload]);

  // Their hello arrives over the live connection the moment it happens.
  useLive((event) => {
    if ((event.type === 'mutual' || event.type === 'ended') && event.matchId === matchId) check();
  });

  // When the time runs out while this screen is open, check with the server
  // (a hello may have just made it) and close the match if it didn't.
  const deadline = match?.helloDeadline;
  const waitingOnWindow = deadline !== undefined && match?.mutual === false && OPEN_STEPS.includes(step);
  useEffect(() => {
    if (!waitingOnWindow || deadline === undefined) return;
    const timer = setTimeout(check, Math.max(0, Date.parse(deadline) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [waitingOnWindow, deadline, check]);

  // While waiting, also look now and then, in case the live connection is down.
  useFocusEffect(
    useCallback(() => {
      if (step !== 'waiting') return;
      const timer = setInterval(check, live ? WATCH_LIVE_MS : WATCH_MS);
      return () => clearInterval(timer);
    }, [step, check, live]),
  );

  if (match === null) return <Redirect href="/home" />;
  if (match === undefined) {
    return (
      <Screen tone="night" glow>
        <View style={styles.center}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      </Screen>
    );
  }

  async function sayHello() {
    if (match === null || match === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { mutual } = await api.sayHello(match.matchId);
      if (mutual) {
        setStep('meeting');
        await reload();
      } else {
        setStep('waiting');
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'expired') {
        setStep('expired');
        await reload().catch(() => null);
      } else {
        setError(describeError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  async function pass() {
    if (match === null || match === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await api.pass(match.matchId);
      setStep('passed');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'sealed' || step === 'opening') {
    return (
      <Screen
        tone="night"
        glow
        footer={<Button label="Break the seal" tone="night" busy={step === 'opening'} onPress={() => setStep('opening')} style={styles.honey} />}
      >
        <BackButton tone="night" />
        <Eyebrow tone="night" style={styles.sealedEyebrow}>
          This round
        </Eyebrow>
        <Text accessibilityRole="header" style={styles.sealedTitle}>
          Your match{'\n'}is here.
        </Text>
        <View style={styles.envelope}>
          <Envelope opening={step === 'opening'} onOpened={() => setStep('deciding')} />
          <Deadline left={timeLeft(match.helloDeadline, now)} style={styles.sealedDeadline} />
        </View>
      </Screen>
    );
  }

  const { partner } = match;
  const [main, ...rest] = partner.photos;
  const locked = !match.photosUnlocked;

  return (
    <Screen tone="night" glow scroll footer={actions()}>
      <View style={styles.topBar}>
        <BackButton tone="night" />
        <Eyebrow tone="night" style={styles.topEyebrow}>
          Your match
        </Eyebrow>
        <View style={styles.topSpacer} />
      </View>

      {main === undefined ? null : (
        <View
          style={styles.gallery}
          accessible
          accessibilityLabel={
            locked
              ? `${partner.displayName}'s photos, blurred until you both say hello`
              : `${partner.photos.length} photo${partner.photos.length === 1 ? '' : 's'} of ${partner.displayName}`
          }
        >
          <View style={styles.mainPhoto}>
            <ProfilePhoto photo={main} unlocked={!locked} style={StyleSheet.absoluteFill} />
            {locked ? (
              <View style={styles.lockChip}>
                <Feather name="lock" size={14} color={night.honey} />
                <Text style={styles.lockText}>Photos unlock when you both say hello</Text>
              </View>
            ) : null}
          </View>
          {rest.length === 0 ? null : (
            <View style={styles.smallPhotos}>
              {rest.map((photo) => (
                <View key={photo.id} style={styles.smallPhoto}>
                  <ProfilePhoto photo={photo} unlocked={!locked} style={StyleSheet.absoluteFill} />
                  {locked ? (
                    <View style={styles.smallLock}>
                      <LockBadge size={22} />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Text accessibilityRole="header" style={styles.name}>
        {partner.displayName}, {partner.age}
      </Text>
      <View style={styles.verified}>
        <Feather name="shield" size={15} color={night.honey} />
        <Body tone="night" style={styles.verifiedText}>
          {partner.institution === null ? 'Verified' : `Verified at ${partner.institution}`}
        </Body>
      </View>

      {partner.bio === null ? null : (
        <View style={styles.block}>
          <Quote text={partner.bio} />
        </View>
      )}

      {match.reasons.length === 0 ? null : (
        <View style={[styles.card, styles.block]}>
          <Eyebrow tone="night" style={styles.honeyEyebrow}>
            Why you two
          </Eyebrow>
          <Reasons items={match.reasons} />
        </View>
      )}

      {partner.prompts.map((prompt) => (
        <View key={prompt.key} style={styles.prompt}>
          <PromptCard prompt={prompt} />
        </View>
      ))}

      {partner.highlights.length === 0 ? null : (
        <View style={styles.block}>
          <Eyebrow tone="night" style={styles.sectionEyebrow}>
            From {partner.displayName}'s answers
          </Eyebrow>
          <Highlights items={partner.highlights} />
        </View>
      )}

      {error === null ? null : (
        <View style={styles.block}>
          <Notice tone="night" kind="error">
            {error}
          </Notice>
        </View>
      )}
    </Screen>
  );

  /** The footer for this step. A plain function, not a component, so Waiting and Meeting keep their state across renders. */
  function actions() {
    if (match === null || match === undefined) return null;
    const name = match.partner.displayName;
    switch (step) {
      case 'deciding':
        return (
          <>
            <Deadline left={timeLeft(match.helloDeadline, now)} />
            <Button label="Say hello" tone="night" onPress={() => void sayHello()} busy={busy} style={styles.honey} />
            <View style={styles.secondary}>
              <Button label="Not for me" tone="night" variant="secondary" onPress={() => setStep('confirming-pass')} disabled={busy} style={styles.half} />
              <Button
                label="Report"
                tone="night"
                variant="text"
                onPress={() => router.push({ pathname: '/report', params: { matchId: match.matchId, name } })}
                style={styles.half}
              />
            </View>
          </>
        );
      case 'confirming-pass':
        return (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Pass on {name}?</Text>
            <Text style={styles.sheetBody}>You won't be matched with each other again.</Text>
            <View style={styles.sheetButtons}>
              <Button label="Keep match" variant="secondary" onPress={() => setStep('deciding')} style={styles.sheetButton} />
              <Button label="Yes, pass" onPress={() => void pass()} busy={busy} style={[styles.sheetButton, styles.passButton]} />
            </View>
          </View>
        );
      case 'waiting':
        return <Waiting name={name} left={timeLeft(match.helloDeadline, now)} />;
      case 'meeting':
        return <Meeting name={name} onDone={() => router.replace({ pathname: '/chat', params: { matchId: match.matchId } })} />;
      case 'together':
        return (
          <>
            <Body tone="night" style={styles.togetherText}>
              You both said hello.
            </Body>
            <Button label="Open chat" tone="night" onPress={() => router.push({ pathname: '/chat', params: { matchId: match.matchId } })} style={styles.honey} />
          </>
        );
      case 'expired':
        return (
          <>
            <View style={[styles.card, styles.closedCard]} accessibilityLiveRegion="polite">
              <Text style={styles.cardTitle}>The time to say hello is up</Text>
              <Body tone="night" style={styles.cardBody}>
                This match closed before you both said hello. You're still in for the next round.
              </Body>
            </View>
            <Button label="Back to home" tone="night" onPress={() => router.replace('/home')} />
          </>
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

/** How long is left to say hello, small and in honey. */
function Deadline({ left, style }: { left: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.deadline, style]}>
      <Feather name="clock" size={14} color={night.honey} />
      <Text style={styles.deadlineText}>{left} left to say hello</Text>
    </View>
  );
}

/** Hello sent: a soft pulse while the screen watches for theirs. */
function Waiting({ name, left }: { name: string; left: string }) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[styles.card, styles.helloCard]} accessibilityLiveRegion="polite">
      <Text style={styles.cardTitle}>Hello sent</Text>
      <Body tone="night" style={styles.cardBody}>
        We'll open your chat the moment {name} says hello too. You don't need to wait here.
      </Body>
      <View style={styles.waitingRow}>
        <Animated.View
          style={[
            styles.waitingDot,
            { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] },
          ]}
        />
        <Text style={styles.waitingText}>
          Waiting for {name} · {left} left
        </Text>
      </View>
    </View>
  );
}

/** Both said hello: the circles meet, the photos unblur, and then the chat opens on its own. */
function Meeting({ name, onDone }: { name: string; onDone: () => void }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const fill = Animated.timing(progress, { toValue: 1, duration: MEETING_MS, delay: 300, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
    fill.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => fill.stop();
    // Runs once: the moment plays out, then hands over to the chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return (
    <View style={[styles.card, styles.helloCard, styles.meeting]} accessibilityLiveRegion="polite">
      <MeetingCircles size={46} motion="meet" style={styles.meetingCircles} />
      <Text style={styles.meetingTitle}>You both said hello.</Text>
      <Body tone="night" style={styles.meetingBody}>
        {name}'s photos are unlocked. Opening your chat…
      </Body>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { transform: [{ scaleX: progress }] }]} />
      </View>
      <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => [styles.openNow, pressed && styles.pressed]}>
        <Text style={styles.openNowText}>Open chat now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  honey: { boxShadow: shadows.honey },
  sealedEyebrow: { marginTop: 18, textAlign: 'center', fontSize: 12, letterSpacing: 1.8 },
  sealedTitle: { marginTop: 10, textAlign: 'center', fontFamily: fonts.displayItalic, fontSize: 44, lineHeight: 46, letterSpacing: -0.8, color: night.text },
  envelope: { flex: 1, justifyContent: 'center', paddingBottom: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topEyebrow: { fontSize: 12, letterSpacing: 1.8 },
  topSpacer: { width: 44 },
  gallery: { marginTop: 16, gap: 8 },
  mainPhoto: { height: 330, borderRadius: 28, overflow: 'hidden', backgroundColor: night.surface },
  lockChip: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: 'rgba(43, 22, 32, 0.84)',
  },
  lockText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: night.text },
  smallPhotos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallPhoto: { flexGrow: 1, flexBasis: '40%', height: 150, borderRadius: 22, overflow: 'hidden', backgroundColor: night.surface },
  smallLock: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 22, fontFamily: fonts.display, fontSize: 42, lineHeight: 46, letterSpacing: -0.8, color: night.text },
  verified: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifiedText: { fontSize: 14.5 },
  block: { marginTop: 20 },
  card: { padding: 20, borderRadius: 24, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 12 },
  honeyEyebrow: { color: night.honey, fontSize: 12, letterSpacing: 1.6 },
  prompt: { marginTop: 12 },
  sectionEyebrow: { marginBottom: 12, fontSize: 12, letterSpacing: 1.6 },
  secondary: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  sheet: { padding: 20, borderRadius: 24, backgroundColor: night.text },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 21, color: night.bg },
  sheetBody: { marginTop: 6, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: '#5E3E4C' },
  sheetButtons: { marginTop: 14, flexDirection: 'row', gap: 10 },
  sheetButton: { flex: 1, height: 48 },
  passButton: { backgroundColor: night.bg },
  helloCard: { borderColor: night.honey, gap: 6 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 21, color: night.text },
  cardBody: { fontSize: 14.5, lineHeight: 21 },
  waitingRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: night.honey },
  waitingText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: night.honey },
  meeting: { alignItems: 'center', boxShadow: shadows.glow },
  meetingCircles: { alignSelf: 'center' },
  meetingTitle: { marginTop: 8, fontFamily: fonts.displayItalic, fontSize: 28, lineHeight: 32, color: night.text, textAlign: 'center' },
  meetingBody: { fontSize: 14.5, textAlign: 'center' },
  track: { marginTop: 10, alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: night.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: night.honey, transformOrigin: 'left' },
  openNow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22 },
  openNowText: { fontFamily: fonts.bodySemi, fontSize: 15, color: night.honey, textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
  togetherText: { textAlign: 'center', fontSize: 15 },
  deadline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  deadlineText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: night.honey },
  sealedDeadline: { marginTop: 18 },
  closedCard: { gap: 6 },
  passed: { textAlign: 'center', fontSize: 15 },
});
