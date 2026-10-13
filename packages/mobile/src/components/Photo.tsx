import type { Photo } from '@hated/api/contract';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useSession } from '@/session';
import { fonts, night } from '@/theme';

interface ProfilePhotoProps {
  photo: Photo;
  /**
   * Show the real photo. Until then only the blurred copy is fetched (the API
   * wouldn't send more), and when this turns true the real one fades in over it.
   */
  unlocked: boolean;
  style?: StyleProp<ViewStyle>;
}

/** One photo, blurred or not. The API decides what this person may see; this only asks. */
export function ProfilePhoto({ photo, unlocked, style }: ProfilePhotoProps) {
  const { api } = useSession();
  // The same source objects from one render to the next: a new one makes the
  // image load again and replay its fade, so it flickered whenever a screen
  // re-rendered (a chat on every keystroke and message).
  const blurred = useMemo(() => api.photoSource(photo.id, 'blurred'), [api, photo.id]);
  const full = useMemo(() => (unlocked ? api.photoSource(photo.id, 'full') : null), [api, photo.id, unlocked]);
  return (
    <View style={[styles.frame, style]}>
      <Image
        source={full ?? blurred}
        placeholder={unlocked ? blurred : null}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={unlocked ? 1200 : 250}
        cachePolicy="memory-disk"
        style={StyleSheet.absoluteFill}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

/** A small lock on a blurred photo. */
export function LockBadge({ size = 24 }: { size?: number }) {
  return (
    <View style={[styles.lock, { width: size, height: size, borderRadius: size / 2 }]}>
      <Feather name="lock" size={Math.round(size / 2)} color={night.honey} />
    </View>
  );
}

interface AvatarProps {
  name: string;
  photo: Photo | null;
  unlocked: boolean;
  size: number;
  /** A gold ring: this conversation is open. */
  ring?: boolean;
}

/** A round photo for lists and headers, or the first letter of the name when there's none. */
export function Avatar({ name, photo, unlocked, size, ring = false }: AvatarProps) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[circle, ring && styles.ring]}
    >
      {photo === null ? (
        <View style={[circle, styles.monogram]}>
          <Text style={[styles.monogramText, { fontSize: size * 0.42 }]}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
      ) : (
        <>
          <ProfilePhoto photo={photo} unlocked={unlocked} style={circle} />
          {unlocked ? null : (
            <View style={styles.centre}>
              <LockBadge size={Math.max(20, Math.round(size * 0.42))} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: night.surface },
  lock: { backgroundColor: 'rgba(43, 22, 32, 0.8)', alignItems: 'center', justifyContent: 'center' },
  ring: { boxShadow: `0px 0px 0px 2px ${night.bg}, 0px 0px 0px 3.5px ${night.honey}` },
  monogram: { backgroundColor: night.blush, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: fonts.display, color: night.bg },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
