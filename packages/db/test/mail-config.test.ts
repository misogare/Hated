import { describe, expect, it } from 'vitest';

import {
  createMailer,
  describeMailConfig,
  explainMailError,
  isMailTransportKind,
  resolveMailConfig,
  type MailConfig,
  type MailEnv,
} from '../src/mail-config.js';

const SMTP_ENV: MailEnv = {
  SMTP_HOST: 'smtp-relay.brevo.com',
  SMTP_USER: 'login@smtp-brevo.com',
  SMTP_PASS: 'xsmtpsib-secret',
  MAIL_FROM: 'HateD <codes@example.com>',
};

const RESEND_ENV: MailEnv = {
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'HateD <codes@example.com>',
};

const SMTP_CONFIG: MailConfig = {
  kind: 'smtp',
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  user: 'login@smtp-brevo.com',
  pass: 'xsmtpsib-secret',
  from: 'HateD <codes@example.com>',
};

/** An error shaped like the ones nodemailer throws. */
function smtpError(fields: { code?: string; responseCode?: number; response?: string }): Error {
  return Object.assign(new Error('smtp failure'), fields);
}

describe('resolveMailConfig auto-detection', () => {
  it('falls back to the console when nothing is configured', () => {
    expect(resolveMailConfig({})).toEqual({ kind: 'console', fallback: true });
  });

  it('picks Resend when only a Resend key is set', () => {
    expect(resolveMailConfig(RESEND_ENV)).toEqual({
      kind: 'resend',
      apiKey: 're_test',
      from: 'HateD <codes@example.com>',
    });
  });

  it('prefers SMTP over Resend when both are configured', () => {
    expect(resolveMailConfig({ ...RESEND_ENV, ...SMTP_ENV }).kind).toBe('smtp');
  });

  it('treats blank values as unset', () => {
    expect(resolveMailConfig({ SMTP_HOST: '  ', RESEND_API_KEY: '' })).toEqual({
      kind: 'console',
      fallback: true,
    });
  });
});

describe('resolveMailConfig explicit selection', () => {
  it('honours MAIL_TRANSPORT over auto-detection', () => {
    expect(resolveMailConfig({ ...SMTP_ENV, ...RESEND_ENV, MAIL_TRANSPORT: 'resend' }).kind).toBe('resend');
  });

  it('lets the override beat MAIL_TRANSPORT, and marks a requested console as deliberate', () => {
    const config = resolveMailConfig({ ...SMTP_ENV, MAIL_TRANSPORT: 'smtp' }, { transport: 'console' });
    expect(config).toEqual({ kind: 'console', fallback: false });
  });

  it('rejects an unknown MAIL_TRANSPORT', () => {
    expect(() => resolveMailConfig({ MAIL_TRANSPORT: 'carrier-pigeon' })).toThrow(
      /MAIL_TRANSPORT must be one of smtp, resend, console/,
    );
  });

  it('uses the from override ahead of MAIL_FROM', () => {
    const config = resolveMailConfig(SMTP_ENV, { from: 'Other <o@example.com>' });
    expect(config.kind === 'smtp' && config.from).toBe('Other <o@example.com>');
  });
});

describe('resolveMailConfig SMTP settings', () => {
  it('defaults to port 587 with STARTTLS', () => {
    expect(resolveMailConfig(SMTP_ENV)).toEqual(SMTP_CONFIG);
  });

  it('switches to implicit TLS on port 465', () => {
    const config = resolveMailConfig({ ...SMTP_ENV, SMTP_PORT: '465' });
    expect(config).toMatchObject({ port: 465, secure: true });
  });

  it('reads SMTP_SECURE explicitly', () => {
    expect(resolveMailConfig({ ...SMTP_ENV, SMTP_PORT: '2525', SMTP_SECURE: 'true' })).toMatchObject({
      port: 2525,
      secure: true,
    });
    expect(resolveMailConfig({ ...SMTP_ENV, SMTP_PORT: '465', SMTP_SECURE: 'false' })).toMatchObject({
      secure: false,
    });
  });

  it('rejects a bad port or secure flag', () => {
    expect(() => resolveMailConfig({ ...SMTP_ENV, SMTP_PORT: 'smtp' })).toThrow(/SMTP_PORT/);
    expect(() => resolveMailConfig({ ...SMTP_ENV, SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/);
    expect(() => resolveMailConfig({ ...SMTP_ENV, SMTP_SECURE: 'maybe' })).toThrow(/SMTP_SECURE/);
  });

  it('names every missing variable instead of falling through to Resend', () => {
    const env = { ...RESEND_ENV, SMTP_HOST: 'smtp-relay.brevo.com', MAIL_FROM: '' };
    expect(() => resolveMailConfig(env)).toThrow('needs SMTP_USER, SMTP_PASS, MAIL_FROM');
  });

  it('names the missing Resend key when Resend is requested', () => {
    expect(() => resolveMailConfig({ MAIL_TRANSPORT: 'resend', MAIL_FROM: 'a@b.c' })).toThrow(
      'The resend mail transport needs RESEND_API_KEY.',
    );
  });
});

describe('createMailer', () => {
  it('builds a transport per kind, with verify only where it can work', () => {
    expect(createMailer({ kind: 'console', fallback: false }).verify).toBeUndefined();
    expect(createMailer({ kind: 'resend', apiKey: 'k', from: 'f@x.com' }).verify).toBeUndefined();
    expect(typeof createMailer(SMTP_CONFIG).verify).toBe('function');
  });
});

describe('describeMailConfig', () => {
  it('summarises the SMTP target without the password', () => {
    const line = describeMailConfig(SMTP_CONFIG);

    expect(line).toContain('smtp-relay.brevo.com:587');
    expect(line).toContain('STARTTLS');
    expect(line).toContain('login@smtp-brevo.com');
    expect(line).not.toContain('xsmtpsib-secret');
  });

  it('never prints the Resend key', () => {
    expect(describeMailConfig({ kind: 'resend', apiKey: 're_secret', from: 'f@x.com' })).not.toContain(
      're_secret',
    );
  });
});

describe('explainMailError', () => {
  it('points at the SMTP key and Brevo IP authorization when login fails', () => {
    const hint = explainMailError(smtpError({ code: 'EAUTH', responseCode: 535 }), SMTP_CONFIG);

    expect(hint).toContain('SMTP key');
    expect(hint).toContain('Authorized IPs');
  });

  it('names a Brevo API key used as the SMTP password', () => {
    const config: MailConfig = { ...SMTP_CONFIG, pass: 'xkeysib-0123-abcd' };
    const hint = explainMailError(smtpError({ code: 'EAUTH', responseCode: 535 }), config);

    expect(hint).toMatch(/^SMTP_PASS holds a Brevo API key/);
    expect(hint).toContain('SMTP tab');
    expect(hint).not.toContain('0123-abcd');
  });

  it('does not blame the key type for an SMTP key or a non-Brevo relay', () => {
    const smtpKey = explainMailError(smtpError({ code: 'EAUTH' }), { ...SMTP_CONFIG, pass: 'xsmtpsib-0123' });
    const elsewhere = explainMailError(smtpError({ code: 'EAUTH' }), {
      ...SMTP_CONFIG,
      host: 'smtp.gmail.com',
      pass: 'xkeysib-0123',
    });

    expect(smtpKey).not.toContain('API key');
    expect(elsewhere).not.toContain('API key');
  });

  it('leads with the IP hint when the reply says the IP is not authorized', () => {
    const hint = explainMailError(
      smtpError({ code: 'EAUTH', response: 'Unauthorized: IP not authorized' }),
      SMTP_CONFIG,
    );

    expect(hint).toMatch(/^Brevo also refuses SMTP from IP addresses/);
  });

  it('leaves out Brevo advice for other providers', () => {
    const hint = explainMailError(smtpError({ code: 'EAUTH' }), { ...SMTP_CONFIG, host: 'smtp.gmail.com' });

    expect(hint).toContain('app password');
    expect(hint).not.toContain('Brevo');
  });

  it('suggests other ports when the relay is unreachable', () => {
    expect(explainMailError(smtpError({ code: 'ETIMEDOUT' }), SMTP_CONFIG)).toContain('2525');
  });

  it('explains a rejected sender', () => {
    expect(explainMailError(smtpError({ code: 'EENVELOPE', responseCode: 550 }), SMTP_CONFIG)).toContain(
      'MAIL_FROM',
    );
  });

  it('has nothing to add for non-SMTP transports or unknown errors', () => {
    expect(explainMailError(new Error('Resend rejected the email (403)'), {
      kind: 'resend',
      apiKey: 'k',
      from: 'f@x.com',
    })).toBeUndefined();
    expect(explainMailError(smtpError({ code: 'ESTREAM' }), SMTP_CONFIG)).toBeUndefined();
    expect(explainMailError('boom', SMTP_CONFIG)).toBeUndefined();
  });
});

describe('isMailTransportKind', () => {
  it('accepts exactly the three transports', () => {
    expect(['smtp', 'resend', 'console'].every(isMailTransportKind)).toBe(true);
    expect(isMailTransportKind('ses')).toBe(false);
  });
});
