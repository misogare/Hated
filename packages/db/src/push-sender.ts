/**
 * Delivering push notifications through Expo's push service.
 *
 * Like the mailer, a one-method transport over the platform `fetch`, so no SDK
 * is needed and tests inject a fake. Expo takes up to 100 messages per request
 * and answers with one ticket per message, in order. A ticket's
 * `DeviceNotRegistered` error means the app was uninstalled or the token
 * expired: the caller should forget that token.
 */

import type { MailFetch } from './mailer.js';

export interface PushMessage {
  /** An Expo push token. */
  to: string;
  title: string;
  body: string;
  /** Read by the app when the notification is tapped, e.g. which chat to open. */
  data?: Record<string, string>;
}

export type PushTicket = { ok: true } | { ok: false; error: string };

export interface PushSender {
  /** One ticket per message, in the same order. Throws if Expo cannot be reached. */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
}

export interface ExpoPushSenderOptions {
  /** Only needed if "enhanced push security" is turned on for the Expo project. */
  accessToken?: string;
  endpoint?: string;
  fetchImpl?: MailFetch;
}

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

export function createExpoPushSender(options: ExpoPushSenderOptions = {}): PushSender {
  const endpoint = options.endpoint ?? EXPO_PUSH_ENDPOINT;
  const fetchImpl: MailFetch = options.fetchImpl ?? globalThis.fetch;

  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let start = 0; start < messages.length; start += BATCH_SIZE) {
        const batch = messages.slice(start, start + BATCH_SIZE).map((message) => ({
          ...message,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
        }));
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`Expo push service refused the request (${response.status}): ${text}`);

        const data = (JSON.parse(text) as { data?: Array<{ status: string; details?: { error?: string }; message?: string }> }).data ?? [];
        for (let index = 0; index < batch.length; index++) {
          const ticket = data[index];
          tickets.push(
            ticket?.status === 'ok'
              ? { ok: true }
              : { ok: false, error: ticket?.details?.error ?? ticket?.message ?? 'no ticket returned' },
          );
        }
      }
      return tickets;
    },
  };
}
