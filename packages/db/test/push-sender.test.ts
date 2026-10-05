import { describe, expect, it } from 'vitest';

import type { MailFetch } from '../src/mailer.js';
import { createExpoPushSender, type PushMessage } from '../src/push-sender.js';

function fakeExpo(reply: (batch: unknown[]) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string>; batch: unknown[] }> = [];
  const fetchImpl: MailFetch = async (url, init) => {
    const batch = JSON.parse(init.body ?? '[]') as unknown[];
    calls.push({ url, headers: init.headers, batch });
    const { status, body } = reply(batch);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

const message = (n: number): PushMessage => ({ to: `ExponentPushToken[${n}]`, title: 'HateD', body: `hello ${n}` });

describe('createExpoPushSender', () => {
  it('posts to Expo with sound, priority and channel, and maps tickets in order', async () => {
    const { calls, fetchImpl } = fakeExpo(() => ({
      status: 200,
      body: { data: [{ status: 'ok', id: 't1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }] },
    }));
    const tickets = await createExpoPushSender({ fetchImpl }).send([message(1), message(2)]);

    expect(tickets).toEqual([{ ok: true }, { ok: false, error: 'DeviceNotRegistered' }]);
    expect(calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls[0]!.batch[0]).toEqual({ ...message(1), sound: 'default', priority: 'high', channelId: 'default' });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('sends in batches of 100 and adds the access token when there is one', async () => {
    const { calls, fetchImpl } = fakeExpo((batch) => ({ status: 200, body: { data: batch.map(() => ({ status: 'ok' })) } }));
    const tickets = await createExpoPushSender({ fetchImpl, accessToken: 'secret' }).send(Array.from({ length: 205 }, (_, n) => message(n)));

    expect(calls.map((call) => call.batch.length)).toEqual([100, 100, 5]);
    expect(calls[0]!.headers.Authorization).toBe('Bearer secret');
    expect(tickets).toHaveLength(205);
  });

  it('throws when Expo refuses the whole request', async () => {
    const { fetchImpl } = fakeExpo(() => ({ status: 429, body: { errors: [{ code: 'TOO_MANY_REQUESTS' }] } }));
    await expect(createExpoPushSender({ fetchImpl }).send([message(1)])).rejects.toThrow(/429/);
  });
});
