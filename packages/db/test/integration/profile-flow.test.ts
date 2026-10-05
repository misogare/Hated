import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getActiveQuestionnaire, getAnswers, getDesires, saveAnswers, saveDesires } from '../../src/answers.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { getAccount, saveProfile, setProfileActive } from '../../src/profiles.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { NOW, member } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('profile, answers and desires (Postgres)', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('profile', () => {
    it('walks onboarding: no profile, then profile, then answers', async () => {
      const user = await prisma.user.create({ data: { email: 'sam@vu.edu.au' } });
      expect((await getAccount(prisma, user.id))?.onboarding).toEqual({ profile: false, answers: false });

      await saveProfile(prisma, user.id, { displayName: ' Sam ', birthDate: new Date('2003-04-20'), gender: 'woman', seeking: [] }, { now: NOW });
      const account = await getAccount(prisma, user.id, { now: NOW });
      expect(account?.profile).toEqual({
        displayName: 'Sam',
        birthDate: '2003-04-20',
        age: 23,
        gender: 'woman',
        seeking: [],
        isActive: true,
      });
      expect(account?.onboarding).toEqual({ profile: true, answers: false });

      await saveAnswers(prisma, user.id, { humor: 0.8 });
      expect((await getAccount(prisma, user.id))?.onboarding).toEqual({ profile: true, answers: true });
    });

    it('replaces who someone is open to, and reports the verified institution', async () => {
      const { userId } = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', ['man', 'nonbinary']);
      await saveProfile(prisma, userId, { displayName: 'Sam', birthDate: new Date('2003-04-20'), gender: 'woman', seeking: ['woman'] }, { now: NOW });

      const account = await getAccount(prisma, userId);
      expect(account?.profile?.seeking).toEqual(['woman']);
      expect(account?.institution).toEqual({ name: 'Victoria University', domain: 'vu.edu.au' });
    });

    it('rejects an under-18 profile without writing it', async () => {
      const user = await prisma.user.create({ data: { email: 'kid@vu.edu.au' } });
      const result = await saveProfile(prisma, user.id, { displayName: 'Kid', birthDate: new Date('2010-01-01'), gender: 'man', seeking: [] }, { now: NOW });

      expect(result).toEqual({ ok: false, reason: 'invalid', problems: ['You need to be 18 or over to use HateD.'] });
      expect(await prisma.profile.count()).toBe(0);
    });

    it('toggles whether someone is in the next round', async () => {
      const { userId } = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      expect(await setProfileActive(prisma, userId, false)).toBe(true);
      expect((await getAccount(prisma, userId))?.profile?.isActive).toBe(false);

      const stranger = await prisma.user.create({ data: { email: 'new@vu.edu.au' } });
      expect(await setProfileActive(prisma, stranger.id, false)).toBe(false);
    });
  });

  describe('answers and desires', () => {
    it('serves the seeded questionnaire in order', async () => {
      const questionnaire = await getActiveQuestionnaire(prisma);
      expect(questionnaire?.questions.map((question) => question.key)).toEqual([
        'values',
        'lifestyle',
        'ambition',
        'humor',
        'openness',
        'weekend',
      ]);
    });

    it('stores answers and derives scale answers into traits; skipping clears both', async () => {
      const { userId, profileId } = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);

      expect(await saveAnswers(prisma, userId, { humor: 0.8, lifestyle: 0.3, weekend: 'outdoors' })).toEqual({ ok: true });
      expect(await getAnswers(prisma, userId)).toEqual({ humor: 0.8, lifestyle: 0.3, weekend: 'outdoors' });
      const traits = await prisma.profileTrait.findMany({ where: { profileId }, orderBy: { key: 'asc' } });
      expect(traits.map(({ key, value }) => [key, value])).toEqual([['humor', 0.8], ['lifestyle', 0.3]]);

      await saveAnswers(prisma, userId, { humor: null });
      expect(await getAnswers(prisma, userId)).toEqual({ lifestyle: 0.3, weekend: 'outdoors' });
      expect(await prisma.profileTrait.count({ where: { profileId, key: 'humor' } })).toBe(0);
    });

    it('rejects answers that do not fit their question, writing nothing', async () => {
      const { userId } = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const result = await saveAnswers(prisma, userId, { humor: 1.5, weekend: 'skydiving', nope: 1 });

      expect(result).toMatchObject({ ok: false, reason: 'invalid' });
      if (!result.ok && result.reason === 'invalid') expect(result.problems).toHaveLength(3);
      expect(await getAnswers(prisma, userId)).toEqual({});
    });

    it('needs a profile before answers or desires', async () => {
      const user = await prisma.user.create({ data: { email: 'new@vu.edu.au' } });
      expect(await saveAnswers(prisma, user.id, { humor: 0.5 })).toEqual({ ok: false, reason: 'no-profile' });
      expect(await saveDesires(prisma, user.id, { humor: { target: 0.5, weight: 1 } })).toEqual({ ok: false, reason: 'no-profile' });
    });

    it('stores desires, and "don\'t mind" removes one', async () => {
      const { userId } = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      await saveDesires(prisma, userId, { humor: { target: 0.9, weight: 1 }, ambition: { target: 0.5, weight: 0.5 } });
      await saveDesires(prisma, userId, { ambition: { target: 0.5, weight: 0 } });

      expect(await getDesires(prisma, userId)).toEqual({ humor: { target: 0.9, weight: 1 } });
      expect(await saveDesires(prisma, userId, { looks: { target: 1, weight: 1 } })).toMatchObject({ ok: false, reason: 'invalid' });
    });
  });
});
