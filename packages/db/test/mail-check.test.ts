import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/mail-check.js';

describe('mail-check parseArgs', () => {
  it('defaults to a check without a test send', () => {
    expect(parseArgs([])).toEqual({ help: false });
  });

  it('reads the recipient, transport, sender, and app name', () => {
    const args = parseArgs([
      '--to',
      ' Me@Example.COM ',
      '--transport',
      'smtp',
      '--from',
      'HateD <codes@x.com>',
      '--app',
      'HateD',
    ]);

    expect(args).toEqual({
      to: 'me@example.com',
      transport: 'smtp',
      from: 'HateD <codes@x.com>',
      app: 'HateD',
      help: false,
    });
  });

  it('turns on help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects a bad recipient, an unknown transport, unknown flags, and missing values', () => {
    expect(() => parseArgs(['--to', 'not-an-email'])).toThrow(/--to must be an email address/);
    expect(() => parseArgs(['--transport', 'fax'])).toThrow(/--transport must be one of/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--to'])).toThrow(/Expected a value/);
  });
});
