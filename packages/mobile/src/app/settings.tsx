import type { NotificationPrefs } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, NightSwitch, Notice } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Eyebrow, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

const EDITORS: { label: string; hint: string; href: Href }[] = [
  { label: 'About you', hint: 'Name, birthday, who you are open to', href: { pathname: '/onboarding/about', params: { edit: '1' } } },
  { label: 'Your answers', hint: 'The questions about you', href: { pathname: '/onboarding/questions', params: { edit: '1' } } },
  { label: 'What matters', hint: 'What you hope for in someone', href: { pathname: '/onboarding/hopes', params: { edit: '1' } } },
];

const NOTIFICATIONS: { kind: keyof NotificationPrefs; label: string; hint: string }[] = [
  { kind: 'messages', label: 'New messages', hint: "When someone you're talking to writes" },
  { kind: 'hellos', label: 'Hellos', hint: 'When your match says hello back' },
  { kind: 'rounds', label: 'Round results', hint: "When a round's matches are in" },
];

const ALL_ON: NotificationPrefs = { messages: true, hellos: true, rounds: true };

/**
 * Settings, opened from home: the account, shortcuts to each editor, which
 * notifications to get, taking part in rounds, signing out, and deleting the
 * account.
 */
export default function Settings() {
  const { account, api, refresh, signOut, deleteAccount } = useSession();
  const [confirming, setConfirming] = useState<'device' | 'everywhere' | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(account?.notifications ?? ALL_ON);
  const [active, setActive] = useState(account?.profile?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  async function toggleNotification(kind: keyof NotificationPrefs, on: boolean) {
    const before = prefs;
    setPrefs({ ...prefs, [kind]: on });
    setError(null);
    try {
      setPrefs(await api.setNotifications({ [kind]: on }));
      void refresh();
    } catch (caught) {
      setPrefs(before);
      setError(describeError(caught));
    }
  }

  async function toggleActive(on: boolean) {
    setActive(on);
    setError(null);
    try {
      await api.setActive(on);
      void refresh();
    } catch (caught) {
      setActive(!on);
      setError(describeError(caught));
    }
  }

  return (
    <Screen tone="night" scroll>
      <BackButton tone="night" />
      <Title tone="night" style={styles.title}>
        Settings
      </Title>

      <Eyebrow tone="night" style={styles.section}>
        Account
      </Eyebrow>
      <View style={styles.card}>
        <Row label="Email" value={account?.email ?? ''} />
        <View style={styles.divider} />
        <Row label="Verified at" value={account?.institution?.name ?? 'Not verified'} />
      </View>

      <Eyebrow tone="night" style={styles.section}>
        Your profile
      </Eyebrow>
      <View style={styles.card}>
        {EDITORS.map((editor, index) => (
          <View key={editor.label}>
            {index === 0 ? null : <View style={styles.divider} />}
            <Pressable
              accessibilityRole="link"
              accessibilityHint={editor.hint}
              onPress={() => router.push(editor.href)}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <View style={styles.linkText}>
                <Text style={styles.linkLabel}>{editor.label}</Text>
                <Text style={styles.linkHint}>{editor.hint}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={night.muted} />
            </Pressable>
          </View>
        ))}
      </View>

      <Eyebrow tone="night" style={styles.section}>
        Notifications
      </Eyebrow>
      <View style={styles.card}>
        {NOTIFICATIONS.map((item, index) => (
          <View key={item.kind}>
            {index === 0 ? null : <View style={styles.divider} />}
            <Toggle
              label={item.label}
              hint={item.hint}
              value={prefs[item.kind]}
              onChange={(on) => void toggleNotification(item.kind, on)}
            />
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>
        {Platform.OS === 'web'
          ? 'Notifications arrive in the HateD app on your phone.'
          : "For every device you're signed in on. Your phone's own settings for HateD apply too."}
      </Text>

      <Eyebrow tone="night" style={styles.section}>
        Privacy
      </Eyebrow>
      <View style={styles.card}>
        <Toggle
          label="Take part in rounds"
          hint={
            active
              ? "You'll be matched when each round closes."
              : "You're left out of rounds until you turn this back on. Your matches and conversations stay."
          }
          value={active}
          onChange={(on) => void toggleActive(on)}
        />
      </View>

      {error === null ? null : (
        <View style={styles.error}>
          <Notice tone="night" kind="error">
            {error}
          </Notice>
        </View>
      )}

      <View style={styles.signOut}>
        {confirming === null ? (
          <>
            <Button label="Sign out" tone="night" variant="secondary" onPress={() => setConfirming('device')} />
            <Button label="Sign out of all devices" tone="night" variant="text" onPress={() => setConfirming('everywhere')} />
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.confirmTitle}>{confirming === 'device' ? 'Sign out of HateD?' : 'Sign out everywhere?'}</Text>
            <Text style={styles.confirmBody}>
              {confirming === 'device'
                ? 'You can sign back in any time with your email.'
                : 'Every phone and browser signed in to your account will be signed out, this one included.'}
            </Text>
            <View style={styles.confirmButtons}>
              <Button label="Cancel" tone="night" variant="secondary" onPress={() => setConfirming(null)} style={styles.confirmButton} />
              <Button
                label="Sign out"
                tone="night"
                onPress={() => void signOut({ everywhere: confirming === 'everywhere' })}
                style={styles.confirmButton}
              />
            </View>
          </View>
        )}
      </View>

      <DeleteAccount onDelete={deleteAccount} />
    </Screen>
  );
}

/** Deleting the account, behind a second step that says exactly what goes. */
function DeleteAccount({ onDelete }: { onDelete: () => Promise<void> }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setStep('busy');
    setError(null);
    try {
      // On success the session ends and this screen goes away.
      await onDelete();
    } catch (caught) {
      setStep('confirm');
      setError(describeError(caught));
    }
  }

  if (step === 'idle') {
    return (
      <View style={styles.delete}>
        <Pressable accessibilityRole="button" onPress={() => setStep('confirm')} style={({ pressed }) => [styles.deleteLink, pressed && styles.pressed]}>
          <Text style={styles.deleteLabel}>Delete my account</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.delete, styles.deleteCard]}>
      <Text style={styles.confirmTitle}>Delete your account?</Text>
      <Text style={styles.confirmBody}>
        This erases your profile, your answers, your matches and every conversation in them, for good. It can't be undone.
      </Text>
      <Text style={styles.confirmBody}>
        Reports you've made about someone stay, without your name, so we can still act on them.
      </Text>
      {error === null ? null : (
        <Notice tone="night" kind="error">
          {error}
        </Notice>
      )}
      <View style={styles.confirmButtons}>
        <Button
          label="Cancel"
          tone="night"
          variant="secondary"
          disabled={step === 'busy'}
          onPress={() => setStep('idle')}
          style={styles.confirmButton}
        />
        <Button label="Delete" tone="night" variant="danger" busy={step === 'busy'} onPress={() => void remove()} style={styles.confirmButton} />
      </View>
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.linkText}>
        <Text style={styles.linkLabel}>{label}</Text>
        <Text style={styles.linkHint}>{hint}</Text>
      </View>
      <NightSwitch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 24 },
  section: { marginTop: 28, marginBottom: 10 },
  card: { borderRadius: 20, backgroundColor: night.surface, borderWidth: 1, borderColor: night.line, paddingHorizontal: 18 },
  divider: { height: 1, backgroundColor: night.line },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  rowLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: night.muted },
  rowValue: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: night.text },
  link: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  pressed: { opacity: 0.7 },
  linkText: { flex: 1, gap: 2 },
  linkLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: night.text },
  linkHint: { fontFamily: fonts.body, fontSize: 13.5, color: night.muted },
  toggle: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  footnote: { marginTop: 8, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: night.muted },
  error: { marginTop: 16 },
  signOut: { marginTop: 32, gap: 8 },
  confirmTitle: { marginTop: 18, fontFamily: fonts.displayBold, fontSize: 19, color: night.text },
  confirmBody: { marginTop: 6, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: night.muted },
  confirmButtons: { marginTop: 16, marginBottom: 18, flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1 },
  delete: { marginTop: 24, marginBottom: 12 },
  deleteCard: { borderColor: night.rose, gap: 4 },
  deleteLink: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22 },
  deleteLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: night.rose },
});
