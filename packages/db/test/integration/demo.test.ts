import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DEMO_DOMAIN, clearDemoPopulation, seedDemoPopulation } from '../../src/demo.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createMemoryPhotoStore } from '../../src/photo-store.js';
import { getAccount } from '../../src/profiles.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';

describe.skipIf(!hasTestDatabase)('demo population (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates fully onboarded, verified members at the demo university', async () => {
    const store = createMemoryPhotoStore();
    const summary = await seedDemoPopulation(prisma, { count: 12, photos: store });
    expect(summary.created).toBe(12);
    expect(Object.values(summary.mix).reduce((a, b) => a + b, 0)).toBe(12);

    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    expect(users).toHaveLength(12);
    for (const user of users) {
      expect(user.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
      const account = await getAccount(prisma, user.id);
      expect(account?.onboarding).toEqual({ profile: true, answers: true, photos: true });
      expect(account?.institution?.name).toBe('HateD Demo University');
      expect(account?.profile?.bio).toBeTruthy();
      expect(account?.profile?.prompts).toHaveLength(2);
      expect(account?.photos.length).toBeGreaterThanOrEqual(2);
    }
    // Two files (full and blurred) per photo.
    expect(store.keys()).toHaveLength(2 * (await prisma.photo.count()));
    expect(await prisma.profileTrait.count()).toBeGreaterThanOrEqual(12 * 5);
  });

  it('gives the same people for the same seed, and replaces rather than duplicates', async () => {
    await seedDemoPopulation(prisma, { count: 6, seed: 3 });
    const first = await prisma.profile.findMany({ orderBy: { displayName: 'asc' }, select: { displayName: true, birthDate: true, genderId: true } });
    await seedDemoPopulation(prisma, { count: 6, seed: 3 });
    const second = await prisma.profile.findMany({ orderBy: { displayName: 'asc' }, select: { displayName: true, birthDate: true, genderId: true } });

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(6);
  });

  it('clears only demo members, and their photo files', async () => {
    const store = createMemoryPhotoStore();
    await prisma.user.create({ data: { email: 'real@vu.edu.au' } });
    await seedDemoPopulation(prisma, { count: 4, photos: store });
    expect(store.keys().length).toBeGreaterThan(0);

    expect(await clearDemoPopulation(prisma, store)).toBe(4);
    expect((await prisma.user.findMany()).map((user) => user.email)).toEqual(['real@vu.edu.au']);
    expect(store.keys()).toEqual([]);
  });
});
