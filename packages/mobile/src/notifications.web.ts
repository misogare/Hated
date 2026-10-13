/**
 * Push notifications in the web build: there are none, since browsers don't
 * receive Expo pushes. This stands in for notifications.ts with the same
 * exports and never imports expo-notifications, whose import alone warns on
 * the web ("Listening to push token changes is not yet fully supported").
 */

import type { ApiClient } from '@/api/client';

export type PushSetup =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-project' | 'failed'; detail?: string };

export function currentPushToken(): string | null {
  return null;
}

export function forgetPushToken(): void {}

export async function registerForPush(api: ApiClient): Promise<PushSetup> {
  void api;
  return { ok: false, reason: 'unsupported' };
}

export function useNotificationRouting(onRound: () => void): void {
  void onRound;
}

export function useOpenChat(matchId: string): void {
  void matchId;
}
