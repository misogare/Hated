import { describe, expect, it } from 'vitest';

import {
  createSmtpMailer,
  smtpTransportOptions,
  type SmtpMailerOptions,
  type SmtpTransport,
} from '../src/smtp-mailer.js';

const BASE: SmtpMailerOptions = {
  host: 'smtp-relay.example.com',
  port: 587,
  user: 'login@example.com',
  pass: 'smtp-key',
  from: 'HateD <codes@example.com>',
};

function fakeTransport(failWith?: Error): {
  sent: Array<Parameters<SmtpTransport['sendMail']>[0]>;
  verified: () => number;
  transport: SmtpTransport;
} {
  const sent: Array<Parameters<SmtpTransport['sendMail']>[0]> = [];
  let verifyCalls = 0;
  const transport: SmtpTransport = {
    async sendMail(mail) {
      if (failWith) throw failWith;
      sent.push(mail);
      return { messageId: '<1@test>' };
    },
    async verify() {
      verifyCalls++;
      if (failWith) throw failWith;
      return true;
    },
  };
  return { sent, verified: () => verifyCalls, transport };
}

describe('smtpTransportOptions', () => {
  it('requires STARTTLS on the submission port', () => {
    const options = smtpTransportOptions(BASE);

    expect(options).toMatchObject({
      host: 'smtp-relay.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'login@example.com', pass: 'smtp-key' },
    });
  });

  it('uses implicit TLS on 465 and does not ask for STARTTLS on top', () => {
    const options = smtpTransportOptions({ ...BASE, port: 465 });

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it('lets an explicit secure flag override the port default', () => {
    expect(smtpTransportOptions({ ...BASE, port: 2525, secure: true }).secure).toBe(true);
    expect(smtpTransportOptions({ ...BASE, port: 465, secure: false }).requireTLS).toBe(true);
  });

  it('caps every phase with a short timeout', () => {
    const defaults = smtpTransportOptions(BASE);
    expect(defaults.connectionTimeout).toBe(15_000);
    expect(defaults.greetingTimeout).toBe(15_000);
    expect(defaults.socketTimeout).toBe(15_000);

    expect(smtpTransportOptions({ ...BASE, timeoutMs: 2_000 }).socketTimeout).toBe(2_000);
  });
});

describe('createSmtpMailer', () => {
  it('sends the rendered message from the configured sender', async () => {
    const { sent, transport } = fakeTransport();
    const mailer = createSmtpMailer({ ...BASE, transport });

    await mailer.send({ to: 'a@mit.edu', subject: 'hi', text: 'plain', html: '<p>hi</p>' });

    expect(sent).toEqual([
      {
        from: 'HateD <codes@example.com>',
        to: 'a@mit.edu',
        subject: 'hi',
        text: 'plain',
        html: '<p>hi</p>',
      },
    ]);
  });

  it('verifies through the transport without sending', async () => {
    const { sent, verified, transport } = fakeTransport();
    const mailer = createSmtpMailer({ ...BASE, transport });

    await mailer.verify();

    expect(verified()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('propagates transport failures so the caller can expire the code', async () => {
    const { transport } = fakeTransport(new Error('535 Authentication failed'));
    const mailer = createSmtpMailer({ ...BASE, transport });

    await expect(
      mailer.send({ to: 'a@x.com', subject: 's', text: 't', html: 'h' }),
    ).rejects.toThrow(/535/);
    await expect(mailer.verify()).rejects.toThrow(/535/);
  });
});
