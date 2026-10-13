import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createMemoryPhotoStore } from '../../src/photo-store.js';
import { addPhoto } from '../../src/photos.js';
import { saveWords } from '../../src/profile-words.js';
import { getAccount } from '../../src/profiles.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member } from './fixtures.js';

describe.skipIf(!hasTestDatabase)('profile words and photos on the account (Postgres)', () => {
  let prisma: PrismaClient;
  const store = createMemoryPhotoStore();

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function addPhotos(userId: string, count: number) {
    for (let index = 0; index < count; index++) {
      const photo = await sharp({ create: { width: 600, height: 750, channels: 3, background: '#c08080' } }).jpeg().toBuffer();
      const result = await addPhoto(prisma, store, userId, photo);
      if (!result.ok) throw new Error(result.reason);
    }
  }

  describe('saving words', () => {
    it('keeps a tidied line and the answered prompts, in order, and shows them on the account', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);

      const saved = await saveWords(prisma, sam.userId, {
        bio: '  Bookshop on Sunday,\n  then far too much coffee. ',
        prompts: [
          { key: 'weirdly-good-at', answer: ' Guessing the twist by chapter three. ' },
          { key: 'green-flag', answer: '   ' },
          { key: 'perfect-sunday', answer: 'A long walk to the market.' },
        ],
      });

      const words = {
        bio: 'Bookshop on Sunday, then far too much coffee.',
        prompts: [
          { key: 'weirdly-good-at', label: "I'm weirdly good at", answer: 'Guessing the twist by chapter three.' },
          { key: 'perfect-sunday', label: 'A perfect Sunday', answer: 'A long walk to the market.' },
        ],
      };
      expect(saved).toEqual({ ok: true, words });
      expect((await getAccount(prisma, sam.userId))?.profile).toMatchObject(words);
    });

    it('replaces earlier words entirely, and a blank line clears it', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      await saveWords(prisma, sam.userId, { bio: 'First try', prompts: [{ key: 'perfect-sunday', answer: 'Market.' }] });
      await saveWords(prisma, sam.userId, { bio: '   ', prompts: [{ key: 'first-date', answer: 'Dumplings.' }] });

      expect((await getAccount(prisma, sam.userId))?.profile).toMatchObject({
        bio: null,
        prompts: [{ key: 'first-date', label: 'An ideal first date', answer: 'Dumplings.' }],
      });
    });

    it('refuses a long line, unknown or repeated prompts, and more than three', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const answer = (key: string) => ({ key, answer: 'Yes.' });

      expect(await saveWords(prisma, sam.userId, { bio: 'x'.repeat(121), prompts: [] })).toEqual({
        ok: false,
        reason: 'invalid',
        problems: ['Keep your line under 120 characters.'],
      });
      expect(
        await saveWords(prisma, sam.userId, { bio: null, prompts: [answer('pets'), answer('first-date'), { key: 'first-date', answer: 'y'.repeat(151) }] }),
      ).toEqual({
        ok: false,
        reason: 'invalid',
        problems: ['There\'s no prompt called "pets".', 'Answer "An ideal first date" only once.'],
      });
      expect(
        await saveWords(prisma, sam.userId, { bio: null, prompts: ['first-date', 'green-flag', 'perfect-sunday', 'obsessed-with'].map(answer) }),
      ).toEqual({ ok: false, reason: 'invalid', problems: ['Choose up to 3 prompts.'] });

      const user = await prisma.user.create({ data: { email: 'new@vu.edu.au' } });
      expect(await saveWords(prisma, user.id, { bio: 'Hi', prompts: [] })).toEqual({ ok: false, reason: 'no-profile' });
    });
  });

  it('counts the profile finished once it has two photos', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    await addPhotos(sam.userId, 1);
    expect((await getAccount(prisma, sam.userId))?.onboarding.photos).toBe(false);
    await addPhotos(sam.userId, 1);
    const account = await getAccount(prisma, sam.userId);
    expect(account?.onboarding.photos).toBe(true);
    expect(account?.photos).toHaveLength(2);
  });
});
