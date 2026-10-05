import { runMatchRound, type Profile } from '@hated/core';
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { persistMatchRound } from '../src/rounds.js';

interface RoundRow {
  id: string;
  [key: string]: unknown;
}

/** Records everything the helper tries to write inside the transaction. */
class FakeTx {
  readonly rounds: RoundRow[] = [];
  readonly participants: Array<Record<string, unknown>> = [];
  readonly matches: Array<Record<string, unknown>> = [];

  readonly matchRound = {
    create: async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
      const row: RoundRow = { id: `round-${this.rounds.length + 1}`, ...data };
      this.rounds.push(row);
      return select?.id === true ? { id: row.id } : row;
    },
  };

  readonly matchRoundParticipant = {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      this.participants.push(...data);
      return { count: data.length };
    },
  };

  readonly match = {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      this.matches.push(...data);
      return { count: data.length };
    },
  };
}

class FakeClient {
  readonly tx = new FakeTx();
  readonly $transaction = async (fn: (tx: FakeTx) => Promise<unknown>) => fn(this.tx);
}

function setup(): { client: PrismaClient; fake: FakeClient } {
  const fake = new FakeClient();
  return { client: fake as unknown as PrismaClient, fake };
}

/** A person whose liking is driven entirely by one `humor` trait. */
function person(id: string, gender: string, seeking: string[], humor: number, target: number): Profile {
  return {
    id,
    gender,
    seeking,
    traits: { humor },
    desired: { humor: { target, weight: 1 } },
  };
}

const BALANCED: Profile[] = [
  person('m1', 'man', ['woman'], 0.9, 0.8),
  person('m2', 'man', ['woman'], 0.4, 0.3),
  person('w1', 'woman', ['man'], 0.85, 0.9),
  person('w2', 'woman', ['man'], 0.5, 0.4),
];

describe('persistMatchRound', () => {
  it('writes one round with its objective, seed, and metrics', async () => {
    const { client, fake } = setup();
    const result = runMatchRound(BALANCED, { objective: 'egalitarian', seed: 11 });

    const summary = await persistMatchRound(client, result, { seed: 11, population: BALANCED });

    expect(fake.tx.rounds).toHaveLength(1);
    expect(summary.participants).toBe(4);
    expect(summary.matches).toBe(result.pairs.length);

    const round = fake.tx.rounds[0]!;
    expect(round.id).toBe(summary.roundId);
    expect(round.status).toBe('COMPUTED');
    expect(round.objective).toBe('egalitarian');
    expect(round.seed).toBe(11);
    expect(round.population).toBe(4);
    expect(round.matched).toBe(2);
    expect(round.matchRate).toBe(1);
    expect(round.stable).toBe(true);
    expect(round.config).toEqual(result.config);

    const metrics = round.metrics as { fair: { objective: string }; sideA: unknown };
    expect(metrics.fair.objective).toBe('egalitarian');
    expect(metrics.sideA).toBeDefined();
  });

  it('stores one participant per person, tagged with side and matched flag', async () => {
    const { client, fake } = setup();
    const result = runMatchRound(BALANCED, { objective: 'egalitarian', seed: 11 });

    const summary = await persistMatchRound(client, result, { population: BALANCED });

    expect(fake.tx.participants).toHaveLength(4);
    for (const participant of fake.tx.participants) {
      expect(participant.roundId).toBe(summary.roundId);
      expect(participant.matched).toBe(result.partners.has(participant.profileId as string));
      expect(participant.unmatchedReason).toBeNull();
    }

    const sideA = fake.tx.participants.filter((p) => p.side === 'A').map((p) => p.profileId);
    const sideB = fake.tx.participants.filter((p) => p.side === 'B').map((p) => p.profileId);
    expect(new Set(sideA)).toEqual(new Set(result.partition.sideA));
    expect(new Set(sideB)).toEqual(new Set(result.partition.sideB));
  });

  it('stores each pair with 1-based ranks and directional scores', async () => {
    const { client, fake } = setup();
    const result = runMatchRound(BALANCED, { objective: 'egalitarian', seed: 11 });

    const summary = await persistMatchRound(client, result, { population: BALANCED });

    expect(fake.tx.matches).toHaveLength(2);
    for (const match of fake.tx.matches) {
      expect(match.roundId).toBe(summary.roundId);
      expect(typeof match.rankA).toBe('number');
      expect(match.rankA as number).toBeGreaterThanOrEqual(1);
      expect(match.rankB as number).toBeGreaterThanOrEqual(1);
      expect(match.scoreAB as number).toBeGreaterThan(0);
      expect(match.scoreBA as number).toBeGreaterThan(0);
    }

    const pair = fake.tx.matches[0]!;
    const expectedRankA =
      result.proposerPrefs.get(pair.profileAId as string)!.indexOf(pair.profileBId as string) + 1;
    expect(pair.rankA).toBe(expectedRankA);
  });

  it('leaves scores null but still fills ranks when no population is given', async () => {
    const { client, fake } = setup();
    const result = runMatchRound(BALANCED, { objective: 'egalitarian', seed: 11 });

    await persistMatchRound(client, result, { seed: 11 });

    expect(fake.tx.matches).toHaveLength(2);
    for (const match of fake.tx.matches) {
      expect(match.scoreAB).toBeNull();
      expect(match.scoreBA).toBeNull();
      expect(typeof match.rankA).toBe('number');
    }
  });

  it('marks an eligible but unchosen participant as not-selected', async () => {
    const { client, fake } = setup();
    const lopsided = [
      person('m1', 'man', ['woman'], 0.9, 0.8),
      person('m2', 'man', ['woman'], 0.4, 0.3),
      person('w1', 'woman', ['man'], 0.85, 0.9),
    ];
    const result = runMatchRound(lopsided, { objective: 'egalitarian', seed: 3 });

    const summary = await persistMatchRound(client, result, { population: lopsided });

    expect(summary.matches).toBe(1);
    const unmatched = fake.tx.participants.filter((p) => p.matched === false);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.unmatchedReason).toBe('not-selected');
  });

  it('marks a participant with no eligible candidates as no-eligible-candidates', async () => {
    const { client, fake } = setup();
    const withGhost = [
      person('m1', 'man', ['woman'], 0.9, 0.8),
      person('w1', 'woman', ['man'], 0.85, 0.9),
      person('z1', 'man', ['alien'], 0.5, 0.5),
    ];
    const result = runMatchRound(withGhost, { objective: 'egalitarian', seed: 5 });

    await persistMatchRound(client, result, { population: withGhost });

    const ghost = fake.tx.participants.find((p) => p.profileId === 'z1')!;
    expect(ghost.matched).toBe(false);
    expect(ghost.unmatchedReason).toBe('no-eligible-candidates');
  });

  it('honours a custom status and timestamps', async () => {
    const { client, fake } = setup();
    const result = runMatchRound(BALANCED, { objective: 'egalitarian', seed: 11 });
    const startedAt = new Date('2026-02-01T00:00:00.000Z');
    const completedAt = new Date('2026-02-01T00:05:00.000Z');

    await persistMatchRound(client, result, { status: 'PUBLISHED', startedAt, completedAt });

    const round = fake.tx.rounds[0]!;
    expect(round.status).toBe('PUBLISHED');
    expect(round.startedAt).toBe(startedAt);
    expect(round.completedAt).toBe(completedAt);
  });
});
