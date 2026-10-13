import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { saveAnswers } from '../../src/answers.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { listMatches } from '../../src/matches.js';
import { createMemoryPhotoStore } from '../../src/photo-store.js';
import { addPhoto } from '../../src/photos.js';
import { saveWords } from '../../src/profile-words.js';
import { getLatestResult, getMatch, passMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member, roundMatching } from './fixtures.js';

describe.skipIf(!hasTestDatabase)("what a match reads about the other person (Postgres)", () => {
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
      // Approved straight away: this is about what a match sees once photos are allowed.
      const result = await addPhoto(prisma, store, userId, photo, { review: false });
      if (!result.ok) throw new Error(result.reason);
    }
  }

  it("shows a match the partner's words, highlights and photos, and unlocks the photos once both say hello", async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const isla = await member(prisma, 'isla@vu.edu.au', 'Isla', 'woman', []);
    await saveAnswers(prisma, sam.userId, { humor: 0.85, lifestyle: 0.5 });
    await saveAnswers(prisma, isla.userId, { humor: 0.9, lifestyle: 0.15, openness: 0.6, weekend: 'outdoors' });
    await saveWords(prisma, isla.userId, { bio: 'Bookshop on Sunday.', prompts: [{ key: 'perfect-sunday', answer: 'Market, then cooking.' }] });
    await addPhotos(isla.userId, 2);
    const match = await roundMatching(prisma, sam.profileId, isla.profileId);

    const result = await getLatestResult(prisma, sam.userId);
    if (result.status !== 'matched') throw new Error(result.status);
    expect(result.match).toMatchObject({
      partner: {
        displayName: 'Isla',
        bio: 'Bookshop on Sunday.',
        prompts: [{ key: 'perfect-sunday', label: 'A perfect Sunday', answer: 'Market, then cooking.' }],
        highlights: ['Humor comes first', 'Happiest at home', 'Open, one step at a time', 'Weekends outdoors'],
      },
      photosUnlocked: false,
      openers: ['Your perfect Sunday sounds good. What would you add to it?', "What's the last thing that made you properly laugh?", 'What made you try an app for people who hate dating apps?'],
    });
    expect(result.match.partner.photos).toHaveLength(2);
    expect((await listMatches(prisma, sam.userId))[0]).toMatchObject({ partner: { photo: result.match.partner.photos[0] }, photosUnlocked: false });

    await sayHello(prisma, sam.userId, match.id);
    await sayHello(prisma, isla.userId, match.id);
    expect((await getMatch(prisma, sam.userId, match.id))?.match.photosUnlocked).toBe(true);
    expect((await listMatches(prisma, sam.userId))[0]?.photosUnlocked).toBe(true);

    await passMatch(prisma, isla.userId, match.id);
    const ended = await getMatch(prisma, sam.userId, match.id);
    expect(ended?.match).toMatchObject({ passed: true, photosUnlocked: false, partner: { photos: [] } });
    expect((await listMatches(prisma, sam.userId))[0]?.partner.photo).toBeNull();
  });

  it("finds any of the person's matches by id, and nobody else's", async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
    const earlier = await roundMatching(prisma, sam.profileId, maya.profileId);
    await roundMatching(prisma, zara.profileId, sam.profileId);
    const unpublished = await roundMatching(prisma, maya.profileId, zara.profileId, 'COMPUTED');

    expect((await getMatch(prisma, sam.userId, earlier.id))?.match.partner.displayName).toBe('Maya');
    expect(await getMatch(prisma, zara.userId, earlier.id)).toBeNull();
    expect(await getMatch(prisma, maya.userId, unpublished.id)).toBeNull();
  });
});
