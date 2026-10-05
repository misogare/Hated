import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Body, Title } from '@/components/Text';
import { SessionProvider, useSession } from '@/session';
import { day } from '@/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  return (
    <SessionProvider>
      {fontsLoaded ? <Routes /> : <View style={styles.blank} />}
    </SessionProvider>
  );
}

/**
 * Which screens exist depends on the session: signed out, only the welcome and
 * sign-in screens; signed in, only the app. When sign-in completes the
 * signed-out screens disappear and the router lands on `start`, which sends the
 * person wherever onboarding left off.
 */
function Routes() {
  const { status, refresh, signOut } = useSession();

  if (status === 'loading') return <View style={styles.blank} />;
  if (status === 'offline') {
    return (
      <Screen
        footer={
          <>
            <Button label="Try again" onPress={() => void refresh()} />
            <Button label="Sign out" variant="text" onPress={() => void signOut()} />
          </>
        }
      >
        <View style={styles.offline}>
          <Title>Can't reach HateD</Title>
          <Body>Check your connection. Your sign-in is saved, so you'll pick up where you left off.</Body>
        </View>
      </Screen>
    );
  }

  const signedIn = status === 'signed-in';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: day.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="how-it-works" />
        <Stack.Screen name="sign-in/email" />
        <Stack.Screen name="sign-in/code" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="start" />
        <Stack.Screen name="onboarding/about" />
        <Stack.Screen name="onboarding/questions" />
        <Stack.Screen name="onboarding/hopes" />
        <Stack.Screen name="onboarding/done" />
        <Stack.Screen name="home" />
        <Stack.Screen name="reveal" />
        <Stack.Screen name="no-match" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="chat" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: day.bg },
  offline: { flex: 1, justifyContent: 'center', gap: 12 },
});
