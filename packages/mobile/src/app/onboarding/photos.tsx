import type { OwnPhoto, Prompt } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { describeError } from '@/api/client';
import { Button } from '@/components/Button';
import { BackButton, Notice, Steps } from '@/components/Controls';
import { ProfilePhoto } from '@/components/Photo';
import { Highlights } from '@/components/Profile';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { goBack } from '@/navigation';
import { useSession } from '@/session';
import { day, fonts } from '@/theme';

const MAX_PHOTOS = 6;
const MIN_PHOTOS = 2;
const MAX_BIO = 120;
const MAX_ANSWER = 150;
/** Longest side sent to the API; it keeps at most 1080×1350 anyway. */
const UPLOAD_SIDE = 1600;

interface Draft {
  key: string;
  answer: string;
}

/**
 * Step 4: photos and a few words, what a match reads before saying hello. Also
 * the editor for them (`?edit=1`).
 */
export default function PhotosAndWords() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { account, api, refresh } = useSession();

  const [photos, setPhotos] = useState<OwnPhoto[]>(account?.photos ?? []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [bio, setBio] = useState(account?.profile?.bio ?? '');
  const [choices, setChoices] = useState<Prompt[] | null>(null);
  const [prompts, setPrompts] = useState<Draft[]>(() => (account?.profile?.prompts ?? []).map(({ key, answer }) => ({ key, answer })));
  const [choosing, setChoosing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.prompts().then(
      ({ prompts: offered }) => {
        setChoices(offered);
        // Two prompts to answer: the ones already answered, then the first free ones.
        setPrompts((current) => {
          const taken = new Set(current.map((prompt) => prompt.key));
          const free = offered.filter((prompt) => !taken.has(prompt.key)).map((prompt) => ({ key: prompt.key, answer: '' }));
          return [...current, ...free].slice(0, Math.max(2, current.length));
        });
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [api]);

  const total = photos.length + uploading.length;
  // A photo that wasn't approved doesn't count, as on the server.
  const missing = Math.max(0, MIN_PHOTOS - photos.filter((photo) => photo.review !== 'rejected').length);
  const label = (key: string) => choices?.find((prompt) => prompt.key === key)?.label ?? '';

  async function pick() {
    setError(null);
    const room = MAX_PHOTOS - total;
    if (room <= 0) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: room > 1,
      selectionLimit: room,
      quality: 1,
    });
    if (picked.canceled) return;
    for (const asset of picked.assets.slice(0, room)) await upload(asset);
  }

  async function upload(asset: ImagePicker.ImagePickerAsset) {
    setUploading((current) => [...current, asset.uri]);
    try {
      setPhotos((await api.uploadPhoto(await asJpeg(asset))).photos);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setUploading((current) => current.filter((uri) => uri !== asset.uri));
    }
  }

  async function makeMain(photoId: string) {
    setSelected(null);
    try {
      setPhotos((await api.reorderPhotos([photoId, ...photos.map((photo) => photo.id).filter((id) => id !== photoId)])).photos);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function remove(photoId: string) {
    setSelected(null);
    try {
      setPhotos((await api.deletePhoto(photoId)).photos);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveWords({ bio: bio.trim() === '' ? null : bio, prompts });
      await refresh();
      if (editing) goBack('/home');
      else router.push('/onboarding/done');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      scroll
      footer={
        <Button
          label={missing > 0 ? `Add ${missing} more photo${missing === 1 ? '' : 's'}` : editing ? 'Save' : 'Save and finish'}
          onPress={() => void save()}
          disabled={missing > 0 || uploading.length > 0 || choices === null}
          busy={saving}
        />
      }
    >
      <View style={styles.top}>
        <BackButton fallback={editing ? '/home' : '/onboarding/hopes'} />
        {editing ? null : (
          <View style={styles.steps}>
            <Steps step={4} total={4} />
          </View>
        )}
      </View>
      <Title style={styles.title}>{editing ? 'Photos and words' : 'Photos and a few words'}</Title>
      <Body style={styles.lede}>This is what your match reads before deciding to say hello.</Body>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <Text style={styles.count}>
            {photos.length} of {MAX_PHOTOS}
          </Text>
        </View>
        <Text style={styles.hint}>Add two to six. Your match sees them blurred until you both say hello.</Text>

        <View style={styles.grid}>
          {photos.map((photo, index) => (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1}${index === 0 ? ', your main photo' : ''}${photo.review === 'approved' ? '' : photo.review === 'pending' ? ', in review' : ', not approved'}`}
              accessibilityHint="Shows what you can do with it"
              accessibilityState={{ selected: selected === photo.id }}
              onPress={() => setSelected(selected === photo.id ? null : photo.id)}
              style={[styles.tile, selected === photo.id && styles.tileSelected]}
            >
              <ProfilePhoto photo={photo} unlocked={!preview} style={StyleSheet.absoluteFill} />
              {index === 0 ? (
                <View style={styles.mainTag}>
                  <Text style={styles.mainTagText}>Main</Text>
                </View>
              ) : null}
              {photo.review === 'approved' ? null : (
                <View style={[styles.reviewTag, photo.review === 'rejected' && styles.reviewTagRejected]}>
                  <Text style={[styles.reviewTagText, photo.review === 'rejected' && styles.reviewTagTextRejected]}>
                    {photo.review === 'pending' ? 'In review' : 'Not approved'}
                  </Text>
                </View>
              )}
              {preview ? (
                <View style={styles.tileLock}>
                  <Feather name="lock" size={12} color={day.honey} />
                </View>
              ) : null}
            </Pressable>
          ))}
          {uploading.map((uri) => (
            <View key={uri} style={styles.tile} accessible accessibilityLabel="Uploading a photo">
              <Image source={{ uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
              <View style={styles.tileBusy}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            </View>
          ))}
          {Array.from({ length: MAX_PHOTOS - total }, (_, index) => (
            <Pressable
              key={`empty-${index}`}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              onPress={() => void pick()}
              style={({ pressed }) => [styles.tile, styles.empty, pressed && styles.pressed]}
            >
              <View style={styles.plus}>
                <Feather name="plus" size={18} color={day.accent} />
              </View>
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          ))}
        </View>

        {selected === null ? null : (
          <View style={styles.actions}>
            {photos[0]?.id === selected ? null : (
              <Pressable accessibilityRole="button" onPress={() => void makeMain(selected)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                <Feather name="star" size={15} color={day.ink} />
                <Text style={styles.actionText}>Make main</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={() => void remove(selected)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Feather name="trash-2" size={15} color={day.danger} />
              <Text style={[styles.actionText, { color: day.danger }]}>Remove</Text>
            </Pressable>
          </View>
        )}

        {photos.some((photo) => photo.review === 'rejected') ? (
          <Notice kind="error">A photo wasn't approved, so no match will see it. Remove it and add another.</Notice>
        ) : photos.some((photo) => photo.review === 'pending') ? (
          <Notice kind="info">Photos marked "In review" are checked before a match can see them. It's usually quick.</Notice>
        ) : null}

        <View style={styles.previewRow}>
          <Text style={styles.previewText}>See them as your match will</Text>
          <Switch
            accessibilityLabel="See your photos as your match will"
            value={preview}
            onValueChange={setPreview}
            trackColor={{ false: day.line, true: day.accent }}
            thumbColor="#FFFFFF"
            {...{ activeThumbColor: '#FFFFFF' }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>A line about you</Text>
          <Text style={styles.count}>
            {bio.length}/{MAX_BIO}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="A line about you"
          value={bio}
          onChangeText={(text) => setBio(text.slice(0, MAX_BIO))}
          placeholder="Bookshop on Sunday, then far too much coffee."
          placeholderTextColor={day.muted}
          selectionColor={day.accent}
          multiline
          maxLength={MAX_BIO}
          style={[styles.textCard, styles.bio]}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Two prompts</Text>
        <Text style={styles.hint}>Answer in your own words. Specific beats impressive.</Text>
        {choices === null ? (
          <ActivityIndicator color={day.accent} style={styles.loading} />
        ) : (
          prompts.map((prompt, index) => (
            <View key={index} style={styles.textCard}>
              <View style={styles.promptHead}>
                <Text style={styles.promptLabel}>{label(prompt.key)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Change the prompt "${label(prompt.key)}"`}
                  onPress={() => setChoosing(choosing === index ? null : index)}
                  style={({ pressed }) => [styles.change, pressed && styles.pressed]}
                >
                  <Text style={styles.changeText}>{choosing === index ? 'Keep' : 'Change'}</Text>
                </Pressable>
              </View>
              {choosing === index ? (
                <View style={styles.choices}>
                  {choices
                    .filter((choice) => !prompts.some((other, otherIndex) => otherIndex !== index && other.key === choice.key))
                    .map((choice) => (
                      <Pressable
                        key={choice.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: choice.key === prompt.key }}
                        onPress={() => {
                          setPrompts(prompts.map((other, otherIndex) => (otherIndex === index ? { key: choice.key, answer: choice.key === prompt.key ? prompt.answer : '' } : other)));
                          setChoosing(null);
                        }}
                        style={({ pressed }) => [styles.choice, choice.key === prompt.key && styles.choiceOn, pressed && styles.pressed]}
                      >
                        <Text style={[styles.choiceText, choice.key === prompt.key && styles.choiceTextOn]}>{choice.label}</Text>
                      </Pressable>
                    ))}
                </View>
              ) : (
                <TextInput
                  accessibilityLabel={label(prompt.key)}
                  value={prompt.answer}
                  onChangeText={(text) => setPrompts(prompts.map((other, otherIndex) => (otherIndex === index ? { ...other, answer: text.slice(0, MAX_ANSWER) } : other)))}
                  placeholder="Your answer"
                  placeholderTextColor={day.muted}
                  selectionColor={day.accent}
                  multiline
                  maxLength={MAX_ANSWER}
                  style={styles.answer}
                />
              )}
            </View>
          ))
        )}
      </View>

      {(account?.profile?.highlights.length ?? 0) === 0 ? null : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>From your answers</Text>
          <Text style={styles.hint}>Worked out from your questionnaire. Your match sees these too.</Text>
          <View style={styles.highlights}>
            <Highlights items={account?.profile?.highlights ?? []} tone="day" />
          </View>
        </View>
      )}

      {error === null ? null : (
        <View style={styles.error}>
          <Notice kind="error">{error}</Notice>
        </View>
      )}
    </Screen>
  );
}

/**
 * A photo as the API wants it: JPEG (iPhones pick HEIC), and no bigger than it
 * needs to be, so uploads are quick on a phone connection.
 */
async function asJpeg(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > UPLOAD_SIDE) {
    context.resize(asset.width >= asset.height ? { width: UPLOAD_SIDE, height: null } : { width: null, height: UPLOAD_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return saved.uri;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  steps: { flex: 1 },
  title: { marginTop: 22, fontSize: 34, lineHeight: 37 },
  lede: { marginTop: 10, fontSize: 15.5, lineHeight: 23 },
  section: { marginTop: 28, gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: day.ink },
  count: { fontFamily: fonts.bodySemi, fontSize: 14, color: day.muted },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: day.muted },
  grid: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.6%', aspectRatio: 3 / 4, borderRadius: 18, overflow: 'hidden', backgroundColor: day.tint },
  tileSelected: { borderWidth: 3, borderColor: day.accent },
  tileBusy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(58, 30, 42, 0.45)', alignItems: 'center', justifyContent: 'center' },
  tileLock: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(43, 22, 32, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainTag: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(251, 243, 238, 0.94)' },
  mainTagText: { fontFamily: fonts.bodyBold, fontSize: 11, color: day.ink },
  reviewTag: { position: 'absolute', right: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(58, 30, 42, 0.82)' },
  reviewTagRejected: { backgroundColor: day.danger },
  reviewTagText: { fontFamily: fonts.bodyBold, fontSize: 11, color: '#FFFFFF' },
  reviewTagTextRejected: { color: '#FFFFFF' },
  empty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C9A99F', backgroundColor: day.card, alignItems: 'center', justifyContent: 'center', gap: 6 },
  plus: { width: 34, height: 34, borderRadius: 17, backgroundColor: day.tint, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: day.accent },
  pressed: { opacity: 0.7 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: day.segment, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontFamily: fonts.bodySemi, fontSize: 14, color: day.ink },
  previewRow: {
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: day.segment,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: day.ink },
  textCard: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 20, borderWidth: 1.5, borderColor: day.line, backgroundColor: day.surface, gap: 6 },
  bio: { fontFamily: fonts.displayItalic, fontSize: 19, lineHeight: 26, color: day.ink, minHeight: 64 },
  loading: { marginTop: 12 },
  promptHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  promptLabel: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: '#A4561F' },
  change: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: day.segment, justifyContent: 'center' },
  changeText: { fontFamily: fonts.bodySemi, fontSize: 13, color: day.ink },
  answer: { fontFamily: fonts.display, fontSize: 19, lineHeight: 26, color: day.ink, minHeight: 52, padding: 0 },
  choices: { gap: 6, paddingTop: 4 },
  choice: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: day.line, justifyContent: 'center' },
  choiceOn: { borderColor: day.accent, backgroundColor: day.tint },
  choiceText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: day.ink },
  choiceTextOn: { fontFamily: fonts.bodySemi },
  highlights: { marginTop: 4 },
  error: { marginTop: 18 },
});
