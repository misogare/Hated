import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Chip, Field, Notice, Steps } from '@/components/Controls';
import { Screen } from '@/components/Screen';
import { Body, Label, Title } from '@/components/Text';
import { GENDERS } from '@/copy';
import { goBack } from '@/navigation';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

/** Step 1: name, birthday, gender, and who they're open to. Also the profile editor (`?edit=1`). */
export default function About() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { api, account, refresh } = useSession();
  const saved = account?.profile ?? null;
  const [year, month, dayOfMonth] = saved?.birthDate.split('-') ?? ['', '', ''];

  const [name, setName] = useState(saved?.displayName ?? '');
  const [birth, setBirth] = useState({ day: dayOfMonth ?? '', month: month ?? '', year: year ?? '' });
  const [gender, setGender] = useState<string | null>(saved?.gender ?? null);
  // Empty means "everyone", as the engine reads it; `null` means not chosen yet.
  const [seeking, setSeeking] = useState<string[] | null>(saved?.seeking ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const birthDate = `${birth.year.padStart(4, '0')}-${birth.month.padStart(2, '0')}-${birth.day.padStart(2, '0')}`;
  const birthComplete = birth.year.length === 4 && birth.month.length > 0 && birth.day.length > 0;
  const ready = name.trim().length > 0 && birthComplete && gender !== null && seeking !== null;

  function toggleSeeking(id: string) {
    const current = seeking ?? [];
    setSeeking(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save() {
    if (gender === null || seeking === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveProfile({ displayName: name.trim(), birthDate, gender, seeking });
      await refresh();
      if (editing) goBack('/settings');
      else router.push('/onboarding/questions');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll footer={<Button label={editing ? 'Save' : 'Continue'} onPress={() => void save()} disabled={!ready} busy={busy} />}>
      <View style={styles.top}>
        {editing ? <BackButton fallback="/settings" /> : null}
        {editing ? null : (
          <View style={styles.fill}>
            <Steps step={1} total={4} />
          </View>
        )}
      </View>
      <Title style={styles.title}>{editing ? 'About you' : 'A little about you'}</Title>

      <View style={styles.section}>
        <Field label="First name" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" maxLength={40} />
      </View>

      <View style={styles.section}>
        <Label>Birthday</Label>
        <View style={styles.birthRow}>
          <DatePart label="Day" placeholder="DD" value={birth.day} max={2} onChange={(value) => setBirth({ ...birth, day: value })} />
          <DatePart label="Month" placeholder="MM" value={birth.month} max={2} onChange={(value) => setBirth({ ...birth, month: value })} />
          <DatePart label="Year" placeholder="YYYY" value={birth.year} max={4} wide onChange={(value) => setBirth({ ...birth, year: value })} />
        </View>
        <Body style={styles.hint}>Your match sees your first name and age, never your birthday. You must be 18 or over.</Body>
      </View>

      <View style={styles.section}>
        <Label>I am</Label>
        <View style={styles.chips}>
          {GENDERS.map((option) => (
            <Chip key={option.id} label={option.label} selected={gender === option.id} onPress={() => setGender(option.id)} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Label>I'm open to meeting</Label>
        <View style={styles.chips}>
          {GENDERS.flatMap((option) =>
            option.plural === null
              ? []
              : [
                  <Chip
                    key={option.id}
                    label={option.plural}
                    selected={seeking?.includes(option.id) ?? false}
                    onPress={() => toggleSeeking(option.id)}
                  />,
                ],
          )}
          <Chip label="Everyone" selected={seeking !== null && seeking.length === 0} onPress={() => setSeeking([])} />
        </View>
      </View>

      {error === null ? null : (
        <View style={styles.section}>
          <Notice kind="error">{error}</Notice>
        </View>
      )}
    </Screen>
  );
}

function DatePart(props: { label: string; placeholder: string; value: string; max: number; wide?: boolean; onChange: (value: string) => void }) {
  return (
    <TextInput
      accessibilityLabel={`Birthday ${props.label.toLowerCase()}`}
      value={props.value}
      onChangeText={(text) => props.onChange(text.replace(/\D/g, '').slice(0, props.max))}
      placeholder={props.placeholder}
      placeholderTextColor={day.muted}
      inputMode="numeric"
      keyboardType="number-pad"
      maxLength={props.max}
      selectionColor={day.accent}
      style={[styles.datePart, props.wide && styles.datePartWide]}
    />
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 44 },
  fill: { flex: 1 },
  title: { marginTop: 24 },
  section: { marginTop: 22, gap: 10 },
  birthRow: { flexDirection: 'row', gap: 10 },
  datePart: {
    // Basis 0 and no minimum, so the three parts share the row instead of
    // taking a text input's intrinsic width (which overflows on web).
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: day.field,
    backgroundColor: day.surface,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 17,
    color: day.ink,
  },
  datePartWide: { flexGrow: 1.6 },
  hint: { fontSize: 13.5, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
