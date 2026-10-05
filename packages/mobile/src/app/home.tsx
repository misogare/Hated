import type { Home as HomeData } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { UnreadBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Notice, Wordmark } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Eyebrow, Heading } from '@/components/Text';
import { roundTime } from '@/copy';
import { registerForPush, useNotificationRouting } from '@/notifications';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

/** Home, in the evening palette: the countdown to the next round, and the latest result. */
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
    <Screen tone="night" scroll>
      <View style={styles.header}>
        <Wordmark tone="night" size={24} />
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={styles.iconButton}>
          <Feather name="settings" size={20} color={night.text} />
        </Pressable>
      </View>

      {home === null ? (
        <View style={styles.loading}>{error === null ? <ActivityIndicator color={night.honey} /> : <Notice tone="night" kind="error">{error}</Notice>}</View>
      ) : (
        <>
          <Result home={home} />
          <Countdown nextRoundAt={home.nextRoundAt} />

          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, home.isActive ? styles.statusOn : styles.statusOff]} />
              <Heading tone="night" style={styles.statusTitle}>
                {home.isActive ? "You're in this round" : "You're sitting this one out"}
              </Heading>
            </View>
            <Body tone="night" style={styles.statusBody}>
              {home.isActive ? "We'll use your answers as they are when the round closes." : 'Switch back on any time before the round closes.'}
            </Body>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Sit this round out</Text>
              <Switch
                accessibilityLabel="Sit this round out"
                value={!home.isActive}
                onValueChange={(sittingOut) => void toggle(!sittingOut)}
                disabled={toggling}
                trackColor={{ false: night.line, true: night.honey }}
                thumbColor={night.text}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel={home.unreadTotal > 0 ? `Your matches, ${home.unreadTotal} unread` : 'Your matches'}
            onPress={() => router.push('/matches')}
            style={[styles.tile, styles.matchesTile]}
          >
            <View style={styles.matchesText}>
              <Text style={styles.tileTitle}>Your matches</Text>
              <Text style={styles.tileHint}>Every match and conversation</Text>
            </View>
            <UnreadBadge count={home.unreadTotal} />
            <Feather name="chevron-right" size={20} color={night.muted} />
          </Pressable>

          <View style={styles.tiles}>
            <Link href={{ pathname: '/onboarding/questions', params: { edit: '1' } }} asChild>
              <Pressable accessibilityRole="link" style={styles.tile}>
                <Text style={styles.tileTitle}>Your answers</Text>
                <Text style={styles.tileHint}>Edit</Text>
              </Pressable>
            </Link>
            <Link href={{ pathname: '/onboarding/hopes', params: { edit: '1' } }} asChild>
              <Pressable accessibilityRole="link" style={styles.tile}>
                <Text style={styles.tileTitle}>What matters</Text>
                <Text style={styles.tileHint}>Edit</Text>
              </Pressable>
            </Link>
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

/** The latest published round, when there is one to act on. */
function Result({ home }: { home: HomeData }) {
  const result = home.result;
  if (result.status === 'none') return null;
  if (result.status === 'unmatched') {
    return (
      <View style={[styles.card, styles.resultCard]}>
        <Heading tone="night">No match last round</Heading>
        <Button label="Read more" variant="text" tone="night" onPress={() => router.push('/no-match')} style={styles.inlineButton} />
      </View>
    );
  }
  const { match } = result;
  if (match.passed) return null;
  return (
    <View style={[styles.card, styles.resultCard, styles.resultMatched]}>
      <Heading tone="night">{match.mutual ? `You and ${match.partner.displayName} both said hello` : 'Your match is here'}</Heading>
      {match.mutual ? (
        <>
          <Button
            label={match.unread > 0 ? `Open chat · ${match.unread} new` : 'Open chat'}
            tone="night"
            onPress={() => router.push({ pathname: '/chat', params: { matchId: match.matchId } })}
          />
          <Button label="See your match" variant="text" tone="night" onPress={() => router.push('/reveal')} style={styles.inlineButton} />
        </>
      ) : (
        <Button label={match.saidHello ? 'See your match' : 'Open'} tone="night" onPress={() => router.push('/reveal')} />
      )}
    </View>
  );
}

/** Days, hours, minutes and seconds until the round closes, ticking. */
function Countdown({ nextRoundAt }: { nextRoundAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.floor((new Date(nextRoundAt).getTime() - now) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const units = [
    { value: String(Math.floor(remaining / 86400)), label: 'days' },
    { value: pad(Math.floor((remaining % 86400) / 3600)), label: 'hours' },
    { value: pad(Math.floor((remaining % 3600) / 60)), label: 'min' },
    { value: pad(remaining % 60), label: 'sec' },
  ];

  return (
    <View style={styles.countdown} accessible accessibilityLabel={`Next round closes ${roundTime(nextRoundAt)}`}>
      <Eyebrow tone="night">Next round closes in</Eyebrow>
      <View style={styles.units}>
        {units.map((unit) => (
          <View key={unit.label} style={styles.unit}>
            <Text style={styles.unitValue}>{unit.value}</Text>
            <Text style={styles.unitLabel}>{unit.label}</Text>
          </View>
        ))}
      </View>
      <Body tone="night" style={styles.when}>
        {roundTime(nextRoundAt)}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: night.surface, alignItems: 'center', justifyContent: 'center' },
  loading: { paddingVertical: 96, alignItems: 'center' },
  countdown: { marginTop: 40, alignItems: 'center' },
  units: { marginTop: 18, flexDirection: 'row', alignSelf: 'stretch' },
  unit: { flex: 1, alignItems: 'center', gap: 4 },
  unitValue: { fontFamily: fonts.display, fontSize: 50, lineHeight: 54, color: night.honey, fontVariant: ['tabular-nums'] },
  unitLabel: { fontFamily: fonts.body, fontSize: 13, color: night.muted },
  when: { marginTop: 14, fontSize: 15 },
  card: { marginTop: 32, padding: 20, borderRadius: 24, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line },
  resultCard: { marginTop: 28, gap: 14 },
  resultMatched: { borderColor: night.honey },
  inlineButton: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusOn: { backgroundColor: night.honey },
  statusOff: { borderWidth: 2, borderColor: night.muted },
  statusTitle: { fontFamily: fonts.bodySemi, fontSize: 17 },
  statusBody: { marginTop: 8, fontSize: 14.5, lineHeight: 21 },
  toggleRow: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: night.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: night.text },
  matchesTile: { marginTop: 14, flex: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  matchesText: { flex: 1, gap: 2 },
  tiles: { marginTop: 12, flexDirection: 'row', gap: 12 },
  tile: { flex: 1, minHeight: 64, padding: 16, borderRadius: 18, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, gap: 2 },
  tileTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: night.text },
  tileHint: { fontFamily: fonts.body, fontSize: 13, color: night.muted },
  footnote: { marginTop: 28, marginBottom: 8, textAlign: 'center', fontSize: 14, lineHeight: 21 },
});
