import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackButton } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Eyebrow, Title } from '@/components/Text';
import { useSession } from '@/session';
import { fonts, night } from '@/theme';

const EDITORS: Array<{ label: string; hint: string; href: Href }> = [
  { label: 'About you', hint: 'Name, birthday, who you are open to', href: { pathname: '/onboarding/about', params: { edit: '1' } } },
  { label: 'Your answers', hint: 'The questions about you', href: { pathname: '/onboarding/questions', params: { edit: '1' } } },
  { label: 'What matters', hint: 'What you hope for in someone', href: { pathname: '/onboarding/hopes', params: { edit: '1' } } },
];

/** Settings, opened from home: the account, shortcuts to each editor, and signing out. */
export default function Settings() {
  const { account, signOut } = useSession();
  const [confirming, setConfirming] = useState(false);

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

      <View style={styles.signOut}>
        {confirming ? (
          <View style={styles.card}>
            <Text style={styles.confirmTitle}>Sign out of HateD?</Text>
            <Text style={styles.confirmBody}>You can sign back in any time with your email.</Text>
            <View style={styles.confirmButtons}>
              <Button label="Cancel" tone="night" variant="secondary" onPress={() => setConfirming(false)} style={styles.confirmButton} />
              <Button label="Sign out" tone="night" onPress={() => void signOut()} style={styles.confirmButton} />
            </View>
          </View>
        ) : (
          <Button label="Sign out" tone="night" variant="secondary" onPress={() => setConfirming(true)} />
        )}
      </View>
    </Screen>
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
  signOut: { marginTop: 32, marginBottom: 12 },
  confirmTitle: { marginTop: 18, fontFamily: fonts.displayBold, fontSize: 19, color: night.text },
  confirmBody: { marginTop: 6, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: night.muted },
  confirmButtons: { marginTop: 16, marginBottom: 18, flexDirection: 'row', gap: 10 },
  confirmButton: { flex: 1 },
});
