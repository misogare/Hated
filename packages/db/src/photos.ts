/**
 * A person's photos: adding, removing and ordering them, and who may see which
 * version.
 *
 * Who sees what:
 * - Their own photos, in full.
 * - A match's photos, blurred, until both have said hello; then in full. Even
 *   the blurred ones go only to someone they were actually matched with.
 * - Nothing once a match has ended (a pass or a report), and nothing of anyone
 *   else's. A photo someone may not see reads as not found, so ids reveal
 *   nothing.
 */

import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { processPhoto } from './photo-processing.js';
import type { PhotoStore } from './photo-store.js';

export const MAX_PHOTOS = 6;
/** Fewer than this and the profile isn't finished. */
export const MIN_PHOTOS = 2;

export type PhotoVariant = 'full' | 'blurred';

export interface PhotoView {
  id: string;
  /** Of the full photo, so a layout can keep its shape before it loads. */
  width: number;
  height: number;
}

export type AddPhotoResult =
  | { ok: true; photo: PhotoView }
  | { ok: false; reason: 'no-profile' | 'too-many' }
  | { ok: false; reason: 'invalid'; problem: string };

export type ReorderPhotosResult = { ok: true; photos: PhotoView[] } | { ok: false; reason: 'invalid' };

const VIEW = { id: true, width: true, height: true } as const;

/** The file a photo's version is kept under. */
export function photoKey(photoId: string, variant: PhotoVariant): string {
  return variant === 'full' ? `${photoId}.jpg` : `${photoId}.blur.jpg`;
}

/** Someone's photos in order, main first. */
export async function listPhotos(prisma: PrismaClient, userId: string): Promise<PhotoView[]> {
  return prisma.photo.findMany({ where: { profile: { userId } }, orderBy: { position: 'asc' }, select: VIEW });
}

/** Process an upload, keep both versions, and add it after the person's other photos. */
export async function addPhoto(prisma: PrismaClient, store: PhotoStore, userId: string, upload: Buffer): Promise<AddPhotoResult> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return { ok: false, reason: 'no-profile' };
  if ((await prisma.photo.count({ where: { profileId: profile.id } })) >= MAX_PHOTOS) return { ok: false, reason: 'too-many' };

  const processed = await processPhoto(upload);
  if (!processed.ok) return { ok: false, reason: 'invalid', problem: processed.problem };

  // Files first, row second: a photo is listed only once both versions exist.
  const id = randomUUID();
  await store.put(photoKey(id, 'full'), processed.photo.full);
  await store.put(photoKey(id, 'blurred'), processed.photo.blurred);
  try {
    // Two uploads at once can pick the same position; the unique index refuses
    // the second, which looks again.
    for (let attempt = 0; ; attempt++) {
      const photos = await prisma.photo.findMany({ where: { profileId: profile.id }, select: { position: true } });
      if (photos.length >= MAX_PHOTOS) {
        await removePhotoFiles(store, [id]);
        return { ok: false, reason: 'too-many' };
      }
      const position = Math.max(-1, ...photos.map((photo) => photo.position)) + 1;
      try {
        const photo = await prisma.photo.create({
          data: { id, profileId: profile.id, position, width: processed.photo.width, height: processed.photo.height },
          select: VIEW,
        });
        return { ok: true, photo };
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'P2002' || attempt >= 3) throw error;
      }
    }
  } catch (error) {
    await removePhotoFiles(store, [id]);
    throw error;
  }
}

/** Remove one of the person's photos; the rest close up. False if it isn't theirs. */
export async function deletePhoto(prisma: PrismaClient, store: PhotoStore, userId: string, photoId: string): Promise<boolean> {
  const photo = await prisma.photo.findFirst({ where: { id: photoId, profile: { userId } }, select: { id: true, profileId: true } });
  if (photo === null) return false;

  await prisma.$transaction(async (tx) => {
    await tx.photo.delete({ where: { id: photo.id } });
    const rest = await tx.photo.findMany({ where: { profileId: photo.profileId }, orderBy: { position: 'asc' }, select: { id: true } });
    await renumber(tx, photo.profileId, rest.map((other) => other.id));
  });
  await removePhotoFiles(store, [photo.id]);
  return true;
}

/** Put the person's photos in this order (every one of their photo ids, once). */
export async function reorderPhotos(prisma: PrismaClient, userId: string, ids: readonly string[]): Promise<ReorderPhotosResult> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return { ok: false, reason: 'invalid' };
  const current = await prisma.photo.findMany({ where: { profileId: profile.id }, select: { id: true } });
  const known = new Set(current.map((photo) => photo.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    return { ok: false, reason: 'invalid' };
  }

  await prisma.$transaction(async (tx) => renumber(tx, profile.id, ids));
  return { ok: true, photos: await listPhotos(prisma, userId) };
}

/** Which version of a photo this person may see, or null for neither. */
export async function photoAccess(prisma: PrismaClient, viewerUserId: string, photoId: string): Promise<PhotoVariant | null> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { profile: { select: { id: true, userId: true } } },
  });
  if (photo === null) return null;
  if (photo.profile.userId === viewerUserId) return 'full';

  const viewer = await prisma.profile.findUnique({ where: { userId: viewerUserId }, select: { id: true } });
  if (viewer === null) return null;
  const owner = photo.profile.id;
  const [matches, blocks] = await Promise.all([
    prisma.match.findMany({
      where: {
        round: { status: 'PUBLISHED' },
        OR: [
          { profileAId: viewer.id, profileBId: owner },
          { profileAId: owner, profileBId: viewer.id },
        ],
      },
      select: { helloAAt: true, helloBAt: true },
    }),
    prisma.profileBlock.count({
      where: {
        OR: [
          { blockerId: viewer.id, blockedId: owner },
          { blockerId: owner, blockedId: viewer.id },
        ],
      },
    }),
  ]);
  if (matches.length === 0 || blocks > 0) return null;
  return matches.some((match) => match.helloAAt !== null && match.helloBAt !== null) ? 'full' : 'blurred';
}

/**
 * The bytes of that version of a photo, if this person may see it. Whoever may
 * see the full photo may see the blurred one too.
 */
export async function readPhoto(
  prisma: PrismaClient,
  store: PhotoStore,
  viewerUserId: string,
  photoId: string,
  variant: PhotoVariant,
): Promise<Buffer | null> {
  const access = await photoAccess(prisma, viewerUserId, photoId);
  if (access === null || (variant === 'full' && access !== 'full')) return null;
  return store.get(photoKey(photoId, variant));
}

/** Delete both files of each photo. */
export async function removePhotoFiles(store: PhotoStore, photoIds: readonly string[]): Promise<void> {
  for (const id of photoIds) {
    await store.delete(photoKey(id, 'full'));
    await store.delete(photoKey(id, 'blurred'));
  }
}

/**
 * Give the photos positions 0, 1, 2… in this order. Everything moves out of
 * the way first, so the unique (profile, position) index never trips midway.
 */
async function renumber(tx: Prisma.TransactionClient, profileId: string, ids: readonly string[]): Promise<void> {
  await tx.photo.updateMany({ where: { profileId }, data: { position: { increment: 1000 } } });
  for (const [position, id] of ids.entries()) {
    await tx.photo.update({ where: { id }, data: { position } });
  }
}
