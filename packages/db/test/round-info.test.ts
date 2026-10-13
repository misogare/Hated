import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { getRoundReport } from '../src/round-info.js';

interface Row {
  [key: string]: unknown;
}

class FakeClient {
  constructor(private readonly row: Row | null) {}

  readonly matchRound = {
    findUnique: async (_args: unknown) => this.row,
  };
}

function client(row: Row | null): PrismaClient {
  return new FakeClient(row) as unknown as PrismaClient;
}

const ROW: Row = {
  id: 'round-1',
  status: 'COMPUTED',
  objective: 'egalitarian',
  config: { topK: 32 },
  seed: 11,
  population: 2,
  matched: 1,
  matchRate: 1,
  stable: true,
  metrics: { fair: { objective: 'egalitarian', strategy: 'exhaustive' } },
  startedAt: new Date('2026-02-01T00:00:00.000Z'),
  completedAt: new Date('2026-02-01T00:00:01.000Z'),
  participants: [
    {
      profileId: 'm1',
      side: 'A',
      matched: true,
      unmatchedReason: null,
      profile: { displayName: 'Mia' },
    },
    {
      profileId: 'w1',
      side: 'B',
      matched: false,
      unmatchedReason: 'not-selected',
      profile: { displayName: 'Wren' },
    },
  ],
  matches: [
    {
      profileAId: 'm1',
      profileBId: 'w1',
      rankA: 1,
      rankB: 2,
      scoreAB: 0.9,
      scoreBA: 0.8,
      profileA: { displayName: 'Mia' },
      profileB: { displayName: 'Wren' },
      feedback: [{ answer: 'well' }, { answer: null }],
    },
  ],
};

describe('getRoundReport', () => {
  it("tallies how the round's matches went", async () => {
    const report = (await getRoundReport(client(ROW), 'round-1'))!;
    expect(report.feedback).toEqual({ well: 1, okay: 0, notForMe: 0, skipped: 1 });
  });

  it('returns null for an unknown round id', async () => {
    expect(await getRoundReport(client(null), 'nope')).toBeNull();
  });

  it('maps the round header and stored metrics', async () => {
    const report = await getRoundReport(client(ROW), 'round-1');

    expect(report).not.toBeNull();
    expect(report!.id).toBe('round-1');
    expect(report!.status).toBe('COMPUTED');
    expect(report!.objective).toBe('egalitarian');
    expect(report!.seed).toBe(11);
    expect(report!.matched).toBe(1);
    expect(report!.stable).toBe(true);
    expect(report!.metrics?.fair?.strategy).toBe('exhaustive');
    expect(report!.startedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('flattens participants with their display name, side, and outcome', async () => {
    const report = (await getRoundReport(client(ROW), 'round-1'))!;

    expect(report.participants).toEqual([
      {
        profileId: 'm1',
        displayName: 'Mia',
        side: 'A',
        matched: true,
        unmatchedReason: null,
      },
      {
        profileId: 'w1',
        displayName: 'Wren',
        side: 'B',
        matched: false,
        unmatchedReason: 'not-selected',
      },
    ]);
  });

  it('flattens matches with names, ranks, and directional scores', async () => {
    const report = (await getRoundReport(client(ROW), 'round-1'))!;

    expect(report.matches).toEqual([
      {
        profileAId: 'm1',
        displayNameA: 'Mia',
        profileBId: 'w1',
        displayNameB: 'Wren',
        rankA: 1,
        rankB: 2,
        scoreAB: 0.9,
        scoreBA: 0.8,
      },
    ]);
  });

  it('treats a null metrics column as an empty report', async () => {
    const report = (await getRoundReport(client({ ...ROW, metrics: null }), 'round-1'))!;
    expect(report.metrics).toBeNull();
  });
});
