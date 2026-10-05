import { describe, expect, it } from 'vitest';

import {
  createConsoleMailer,
  createResendMailer,
  renderVerificationEmail,
  type MailFetch,
} from '../src/mailer.js';

describe('renderVerificationEmail', () => {
  it('puts the code in the subject, text, and html', () => {
    const message = renderVerificationEmail({
      to: 'student@mit.edu',
      code: '042913',
      domain: 'mit.edu',
      type: 'EDU',
      expiresInMinutes: 10,
    });

    expect(message.to).toBe('student@mit.edu');
    expect(message.subject).toContain('042913');
    expect(message.text).toContain('042913');
    expect(message.text).toContain('mit.edu');
    expect(message.text).toContain('10 minutes');
    expect(message.html).toContain('042913');
    expect(message.html).toContain('mit.edu');
  });

  it('uses singular wording for a one-minute ttl and says government for GOV', () => {
    const message = renderVerificationEmail({
      to: 'me@nasa.gov',
      code: '111111',
      domain: 'nasa.gov',
      type: 'GOV',
      expiresInMinutes: 1,
      appName: 'HateD',
    });

    expect(message.text).toContain('government email');
    expect(message.text).toContain('1 minute.');
    expect(message.text).not.toContain('1 minutes');
  });

  it('escapes html in the app name and domain', () => {
    const message = renderVerificationEmail({
      to: 'a@x.edu',
      code: '222222',
      domain: 'x.edu<script>',
      type: 'EDU',
      expiresInMinutes: 5,
      appName: 'A & B <Co>',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('A &amp; B &lt;Co&gt;');
  });
});

describe('createConsoleMailer', () => {
  it('prints the recipient, subject, and body', async () => {
    const lines: string[] = [];
    const mailer = createConsoleMailer({ log: (line) => lines.push(line) });

    await mailer.send({
      to: 'a@mit.edu',
      subject: 'subj',
      text: 'body with 123456',
      html: '<p>body</p>',
    });

    expect(lines.join('\n')).toContain('a@mit.edu');
    expect(lines.join('\n')).toContain('subj');
    expect(lines.join('\n')).toContain('123456');
  });
});

describe('createResendMailer', () => {
  function fakeFetch(status = 200): { calls: Array<{ url: string; init: Parameters<MailFetch>[1] }>; fetch: MailFetch } {
    const calls: Array<{ url: string; init: Parameters<MailFetch>[1] }> = [];
    const fetch: MailFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, text: async () => 'body' };
    };
    return { calls, fetch };
  }

  it('posts the message to Resend with the api key and sender', async () => {
    const { calls, fetch } = fakeFetch();
    const mailer = createResendMailer({ apiKey: 're_test', from: 'HateD <codes@x.com>', fetchImpl: fetch });

    await mailer.send({ to: 'a@mit.edu', subject: 'hi', text: 'plain', html: '<p>hi</p>' });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe('Bearer re_test');
    expect(call.init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init.body);
    expect(body).toMatchObject({
      from: 'HateD <codes@x.com>',
      to: 'a@mit.edu',
      subject: 'hi',
      text: 'plain',
      html: '<p>hi</p>',
    });
  });

  it('honours a custom endpoint', async () => {
    const { calls, fetch } = fakeFetch();
    const mailer = createResendMailer({
      apiKey: 'k',
      from: 'f@x.com',
      endpoint: 'https://proxy.test/emails',
      fetchImpl: fetch,
    });

    await mailer.send({ to: 'a@x.com', subject: 's', text: 't', html: 'h' });
    expect(calls[0]!.url).toBe('https://proxy.test/emails');
  });

  it('throws with the status when Resend rejects the request', async () => {
    const { fetch } = fakeFetch(422);
    const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.com', fetchImpl: fetch });

    await expect(
      mailer.send({ to: 'a@x.com', subject: 's', text: 't', html: 'h' }),
    ).rejects.toThrow(/422/);
  });
});
