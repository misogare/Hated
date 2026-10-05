import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/verify-code.js';

describe('verify-code parseArgs', () => {
  it('reads the id and code, and defaults to a formatted view', () => {
    expect(parseArgs(['--id', 'ver-1', '--code', '123456'])).toEqual({
      id: 'ver-1',
      code: '123456',
      json: false,
      help: false,
    });
  });

  it('accepts the verification id positionally', () => {
    expect(parseArgs(['ver-2', '--code', '000001']).id).toBe('ver-2');
  });

  it('rejects giving the id twice', () => {
    expect(() => parseArgs(['ver-1', '--id', 'ver-2', '--code', '1'])).toThrow(/twice/);
  });

  it('turns on the boolean flags', () => {
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--code'])).toThrow(/Expected a value/);
    expect(() => parseArgs(['--id'])).toThrow(/Expected a value/);
  });
});
