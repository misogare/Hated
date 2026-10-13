import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createMemoryPhotoStore } from '../../src/photo-store.js';
import { addPhoto, deletePhoto, listPhotos, photoAccess, readPhoto, reorderPhotos, type PhotoView } from '../../src/photos.js';
import { passMatch, sayHello } from '../../src/results.js';
import { seedDatabase } from '../../src/seed.js';
import { createTestClient, hasTestDatabase, resetDatabase } from './database.js';
import { member, roundMatching } from './fixtures.js';

/** A plain photo, in a colour so different uploads are different files. */
function jpeg(background = '#c08080', width = 600, height = 750): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
}

describe.skipIf(!hasTestDatabase)('photos (Postgres)', () => {
  let prisma: PrismaClient;
  let store: ReturnType<typeof createMemoryPhotoStore>;

  beforeEach(async () => {
    prisma ??= createTestClient();
    await resetDatabase(prisma);
    await seedDatabase(prisma);
    store = createMemoryPhotoStore();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function upload(userId: string, background?: string): Promise<PhotoView> {
    const result = await addPhoto(prisma, store, userId, await jpeg(background));
    if (!result.ok) throw new Error(`upload refused: ${result.reason}`);
    return result.photo;
  }

  it('keeps the photo and a blurred copy, and lists photos in the order added', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const first = await upload(sam.userId, '#c08080');
    const second = await upload(sam.userId, '#80a0c0');

    expect(first).toMatchObject({ width: 600, height: 750 });
    expect(await listPhotos(prisma, sam.userId)).toEqual([first, second]);
    expect(store.keys()).toEqual([`${first.id}.blur.jpg`, `${first.id}.jpg`, `${second.id}.blur.jpg`, `${second.id}.jpg`].sort());
  });

  it('lands two uploads made at the same moment, one after the other', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const [a, b] = await Promise.all([jpeg('#111111'), jpeg('#222222')]);
    const results = await Promise.all([addPhoto(prisma, store, sam.userId, a!), addPhoto(prisma, store, sam.userId, b!)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const rows = await prisma.photo.findMany({ orderBy: { position: 'asc' }, select: { position: true } });
    expect(rows).toEqual([{ position: 0 }, { position: 1 }]);
  });

  it('refuses a seventh photo, a file that is not a photo, and anyone without a profile', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    for (let index = 0; index < 6; index++) await upload(sam.userId);
    const keysBefore = store.keys();

    expect(await addPhoto(prisma, store, sam.userId, await jpeg())).toEqual({ ok: false, reason: 'too-many' });
    expect(store.keys()).toEqual(keysBefore);

    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    expect(await addPhoto(prisma, store, maya.userId, Buffer.from('not a photo'))).toEqual({
      ok: false,
      reason: 'invalid',
      problem: "That file isn't a photo we can read. Try a JPEG or PNG.",
    });
    const user = await prisma.user.create({ data: { email: 'new@vu.edu.au' } });
    expect(await addPhoto(prisma, store, user.id, await jpeg())).toEqual({ ok: false, reason: 'no-profile' });
  });

  it('closes up the order when a photo goes, deletes its files, and lets only its owner remove it', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
    const [one, two, three] = [await upload(sam.userId), await upload(sam.userId), await upload(sam.userId)];

    expect(await deletePhoto(prisma, store, maya.userId, two.id)).toBe(false);
    expect(await deletePhoto(prisma, store, sam.userId, two.id)).toBe(true);

    expect(await listPhotos(prisma, sam.userId)).toEqual([one, three]);
    expect(await prisma.photo.findMany({ orderBy: { position: 'asc' }, select: { position: true } })).toEqual([{ position: 0 }, { position: 1 }]);
    expect(store.keys().some((key) => key.startsWith(two.id))).toBe(false);
  });

  it('puts photos in a new order, and refuses one that is not exactly their photos', async () => {
    const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
    const [one, two, three] = [await upload(sam.userId), await upload(sam.userId), await upload(sam.userId)];

    expect(await reorderPhotos(prisma, sam.userId, [three.id, one.id, two.id])).toEqual({ ok: true, photos: [three, one, two] });
    expect(await reorderPhotos(prisma, sam.userId, [three.id, one.id])).toEqual({ ok: false, reason: 'invalid' });
    expect(await reorderPhotos(prisma, sam.userId, [three.id, one.id, one.id])).toEqual({ ok: false, reason: 'invalid' });
    expect(await reorderPhotos(prisma, sam.userId, [three.id, one.id, 'someone-elses'])).toEqual({ ok: false, reason: 'invalid' });
    expect(await listPhotos(prisma, sam.userId)).toEqual([three, one, two]);
  });

  describe('who sees what', () => {
    it("shows people their own photos, and a match's blurred until both say hello", async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
      const photo = await upload(maya.userId);
      const match = await roundMatching(prisma, sam.profileId, maya.profileId);

      expect(await photoAccess(prisma, maya.userId, photo.id)).toBe('full');
      expect(await photoAccess(prisma, sam.userId, photo.id)).toBe('blurred');
      expect(await readPhoto(prisma, store, sam.userId, photo.id, 'full')).toBeNull();
      const blurred = await readPhoto(prisma, store, sam.userId, photo.id, 'blurred');
      expect((await sharp(blurred!).metadata()).width).toBe(360);

      await sayHello(prisma, sam.userId, match.id);
      expect(await photoAccess(prisma, sam.userId, photo.id)).toBe('blurred');
      await sayHello(prisma, maya.userId, match.id);
      expect(await photoAccess(prisma, sam.userId, photo.id)).toBe('full');
      expect((await sharp((await readPhoto(prisma, store, sam.userId, photo.id, 'full'))!).metadata()).width).toBe(600);
    });

    it('shows nothing to strangers, before a round is published, or after a match ends', async () => {
      const sam = await member(prisma, 'sam@vu.edu.au', 'Sam', 'woman', []);
      const maya = await member(prisma, 'maya@vu.edu.au', 'Maya', 'woman', []);
      const zara = await member(prisma, 'zara@vu.edu.au', 'Zara', 'woman', []);
      const photo = await upload(maya.userId);

      expect(await photoAccess(prisma, zara.userId, photo.id)).toBeNull();
      await roundMatching(prisma, zara.profileId, maya.profileId, 'COMPUTED');
      expect(await photoAccess(prisma, zara.userId, photo.id)).toBeNull();

      const match = await roundMatching(prisma, sam.profileId, maya.profileId);
      await sayHello(prisma, sam.userId, match.id);
      await sayHello(prisma, maya.userId, match.id);
      await passMatch(prisma, maya.userId, match.id);
      expect(await photoAccess(prisma, sam.userId, photo.id)).toBeNull();
      expect(await readPhoto(prisma, store, sam.userId, photo.id, 'blurred')).toBeNull();
      expect(await photoAccess(prisma, sam.userId, 'no-such-photo')).toBeNull();
    });
  });
});
