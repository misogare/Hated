import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/inspect.js';

describe('inspect parseArgs', () => {
  it('collects positional round ids and defaults to a formatted view', () => {
    expect(parseArgs(['round-1'])).toEqual({ ids: ['round-1'], json: false, help: false });
    expect(parseArgs(['round-1', 'round-2']).ids).toEqual(['round-1', 'round-2']);
  });

  it('turns on json and help', () => {
    expect(parseArgs(['a', '--json']).json).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('requires at least one id unless help was asked for', () => {
    expect(parseArgs([]).ids).toEqual([]);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown flag/);
  });
});
