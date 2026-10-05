import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('defaults to a deterministic persist run', () => {
    expect(parseArgs([])).toEqual({
      seed: 42,
      objective: 'min-regret',
      status: 'COMPUTED',
      includeInactive: false,
      persist: true,
      json: false,
      help: false,
    });
  });

  it('reads seed, objective, status, and FirstDate overrides', () => {
    const args = parseArgs([
      '--seed',
      '7',
      '--objective',
      'egalitarian',
      '--status',
      'PUBLISHED',
      '--topK',
      '16',
      '--minScore',
      '0.5',
    ]);

    expect(args.seed).toBe(7);
    expect(args.objective).toBe('egalitarian');
    expect(args.status).toBe('PUBLISHED');
    expect(args.topK).toBe(16);
    expect(args.minScore).toBe(0.5);
  });

  it('parses an id list, taking both camel and kebab spellings of topK', () => {
    expect(parseArgs(['--ids', 'a, b ,c']).ids).toEqual(['a', 'b', 'c']);
    expect(parseArgs(['--topk', '8']).topK).toBe(8);
    expect(parseArgs(['--minscore', '0.4']).minScore).toBe(0.4);
  });

  it('turns on the boolean flags', () => {
    expect(parseArgs(['--include-inactive']).includeInactive).toBe(true);
    expect(parseArgs(['--dry-run']).persist).toBe(false);
    expect(parseArgs(['--no-persist']).persist).toBe(false);
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown flags, bad numbers, and unknown enum values', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--seed', 'abc'])).toThrow(/Expected a number/);
    expect(() => parseArgs(['--seed'])).toThrow(/Expected a number/);
    expect(() => parseArgs(['--objective', 'leftmost'])).toThrow(/--objective must be one of/);
    expect(() => parseArgs(['--status', 'DONE'])).toThrow(/--status must be one of/);
    expect(() => parseArgs(['--ids'])).toThrow(/comma-separated list/);
  });
});
