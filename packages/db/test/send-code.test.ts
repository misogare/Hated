import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/send-code.js';

describe('send-code parseArgs', () => {
  it('defaults to a real send with no recipient', () => {
    expect(parseArgs([])).toEqual({ print: false, json: false, help: false });
  });

  it('reads the email, user, sender, app, and ttl', () => {
    const args = parseArgs([
      '--email',
      'student@mit.edu',
      '--user',
      'u1',
      '--from',
      'HateD <codes@x.com>',
      '--app',
      'HateD',
      '--ttl',
      '15',
    ]);

    expect(args.email).toBe('student@mit.edu');
    expect(args.user).toBe('u1');
    expect(args.from).toBe('HateD <codes@x.com>');
    expect(args.app).toBe('HateD');
    expect(args.ttlMinutes).toBe(15);
  });

  it('reads a transport and rejects an unknown one', () => {
    expect(parseArgs(['--transport', 'smtp']).transport).toBe('smtp');
    expect(parseArgs([]).transport).toBeUndefined();
    expect(() => parseArgs(['--transport', 'fax'])).toThrow(/--transport must be one of/);
  });

  it('turns on the boolean flags', () => {
    expect(parseArgs(['--print']).print).toBe(true);
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown flags, missing values, and bad numbers', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--email'])).toThrow(/Expected a value/);
    expect(() => parseArgs(['--ttl', 'soon'])).toThrow(/Expected a number/);
  });
});
