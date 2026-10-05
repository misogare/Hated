import { StyleSheet, Text, View } from 'react-native';

import { fonts, night } from '@/theme';

/** A honey count bubble for unread messages; renders nothing at zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.badge} accessible accessibilityLabel={`${count} unread ${count === 1 ? 'message' : 'messages'}`}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: night.honey, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.bodyBold, fontSize: 13, color: night.bg },
});
