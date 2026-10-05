import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PROFILE_INCLUDE } from '../src/mapper.js';
import { loadEngineProfiles } from '../src/population.js';
import type { ProfileWithRelations } from '../src/mapper.js';

interface FindManyArgs {
  where?: {
    isActive?: boolean;
    id?: { in: string[] };
  };
  include?: unknown;
  orderBy?: unknown;
}

/** Captures the query it was given and returns canned rows. */
class FakeClient {
  rows: ProfileWithRelations[] = [];
  lastArgs: FindManyArgs | undefined;

  readonly profile = {
    findMany: async (args: FindManyArgs) => {
      this.lastArgs = args;
      return this.rows;
    },
  };
}

function row(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: 'p1',
    genderId: 'woman',
    similarityWeight: null,
    desireWeight: null,
    reciprocityWeight: null,
    seeking: [],
    traits: [],
    desires: [],
    blocksMade: [],
    blocksTargetingMe: [],
    ...overrides,
  };
}

function clientFor(rows: ProfileWithRelations[]): { client: PrismaClient; fake: FakeClient } {
  const fake = new FakeClient();
  fake.rows = rows;
  return { client: fake as unknown as PrismaClient, fake };
}

describe('loadEngineProfiles', () => {
  it('queries the active population with the mapper relations, ordered by id', async () => {
    const { client, fake } = clientFor([row()]);

    await loadEngineProfiles(client);

    expect(fake.lastArgs?.where).toEqual({ isActive: true });
    expect(fake.lastArgs?.include).toEqual(PROFILE_INCLUDE);
    expect(fake.lastArgs?.orderBy).toEqual({ id: 'asc' });
  });

  it('drops the active filter when includeInactive is set', async () => {
    const { client, fake } = clientFor([]);

    await loadEngineProfiles(client, { includeInactive: true });

    expect(fake.lastArgs?.where).toEqual({});
  });

  it('restricts to the requested ids when given', async () => {
    const { client, fake } = clientFor([]);

    await loadEngineProfiles(client, { ids: ['a', 'b'] });

    expect(fake.lastArgs?.where).toEqual({ isActive: true, id: { in: ['a', 'b'] } });
  });

  it('maps rows into engine profiles', async () => {
    const { client } = clientFor([
      row({
        id: 'p1',
        genderId: 'man',
        similarityWeight: 0.2,
        desireWeight: 0.4,
        reciprocityWeight: 0,
        seeking: [{ genderId: 'woman' }],
        traits: [{ key: 'humor', value: 0.8 }],
        desires: [{ key: 'humor', target: 0.9, weight: 0.5 }],
        blocksMade: [{ blockedId: 'p9' }],
      }),
    ]);

    const [profile] = await loadEngineProfiles(client);

    expect(profile).toEqual({
      id: 'p1',
      gender: 'man',
      seeking: ['woman'],
      traits: { humor: 0.8 },
      desired: { humor: { target: 0.9, weight: 0.5 } },
      weights: { similarityWeight: 0.2, desireWeight: 0.4, reciprocityWeight: 0 },
      blocked: ['p9'],
    });
  });

  it('returns an empty population without querying further', async () => {
    const { client } = clientFor([]);
    await expect(loadEngineProfiles(client)).resolves.toEqual([]);
  });
});
