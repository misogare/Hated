/**
 * Push notifications on the phone: asking permission, registering this device
 * with the API, and opening the right screen when a notification is tapped.
 *
 * Push needs three things the app cannot provide by itself, so registration
 * reports why it did nothing rather than failing:
 * - a real device (simulators and the web build cannot receive pushes);
 * - permission from the person;
 * - an Expo project id (`extra.eas.projectId` in app.json, written by
 *   `eas init`), which is what an Expo push token belongs to.
 * Expo Go on Android cannot receive pushes at all (SDK 53+); a development
 * build can. Expo Go on iPhone can.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import type { ApiClient } from '@/api/client';

export type PushSetup =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-project' | 'failed'; detail?: string };

/** What the API puts in each notification's data. */
interface PushData {
  type?: 'message' | 'mutual' | 'round';
  matchId?: string;
}

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** The conversation on screen, whose messages need no banner. */
let openChat: string | null = null;

if (supported) {
  // Show notifications that arrive while the app is open too, except a message
  // in the conversation already on screen.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as PushData | null;
      const show = !(data?.type === 'message' && data.matchId !== undefined && data.matchId === openChat);
      return { shouldPlaySound: show, shouldSetBadge: false, shouldShowBanner: show, shouldShowList: show };
    },
  });
}

/** This device's token once registered, so signing out can unregister it. */
let registeredToken: string | null = null;

export function currentPushToken(): string | null {
  return registeredToken;
}

/** Signed out: the next sign-in registers again. */
export function forgetPushToken(): void {
  registeredToken = null;
}

/** Ask for permission (once), then register this device's push token with the API. */
export async function registerForPush(api: ApiClient): Promise<PushSetup> {
  if (!supported || !Device.isDevice) return { ok: false, reason: 'unsupported' };

  if (Platform.OS === 'android') {
    // Android needs a channel before it will show the permission prompt.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Matches and messages',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#B83A5E',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return { ok: false, reason: 'denied' };

  const projectId: string | undefined =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: 'no-project' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(token, Platform.OS as 'ios' | 'android');
    registeredToken = token;
    return { ok: true, token };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Open the screen a tapped notification is about: the conversation, or home
 * for a round result (calling `onRound` so home shows it). Used by home, which
 * sits at the bottom of the stack once someone has finished onboarding.
 */
function useNotificationRoutingOnDevice(onRound: () => void): void {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (response === undefined || response === null) return;
    const data = response.notification.request.content.data as PushData | null;
    if ((data?.type === 'message' || data?.type === 'mutual') && data.matchId) {
      if (data.matchId !== openChat) router.push({ pathname: '/chat', params: { matchId: data.matchId } });
    } else if (data?.type === 'round') {
      if (router.canDismiss()) router.dismissTo('/home');
      onRound();
    }
    // Handled: don't route again on the next render or launch.
    Notifications.clearLastNotificationResponse();
  }, [response, onRound]);
}

export const useNotificationRouting: (onRound: () => void) => void = supported ? useNotificationRoutingOnDevice : () => undefined;

/** Mark this conversation as on screen while it is focused. */
export function useOpenChat(matchId: string): void {
  useFocusEffect(
    useCallback(() => {
      openChat = matchId;
      return () => {
        if (openChat === matchId) openChat = null;
      };
    }, [matchId]),
  );
}
