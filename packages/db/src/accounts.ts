/**
 * Deleting an account, for good: the person's right to erasure.
 *
 * One delete of the user row cascades to everything that is theirs: the
 * profile and its answers, traits and hopes; sessions and push tokens; email
 * verifications; their place in past rounds; their matches, with every message
 * in them; and reports about them. The other person in a match simply stops
 * seeing it. Reports they made about someone else stay, without their name, so
 * the team can still act on them. Round totals (how many were matched) are
 * counts, not people, and stay as they were.
 *
 * Photos live outside the database, so their files are deleted too, after the
 * rows: if that fails, what is left is files nothing points to, never an
 * account half deleted.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import type { PhotoStore } from './photo-store.js';
import { removePhotoFiles } from './photos.js';

/** Delete the account and everything in it, photo files included. False if there was no such account. */
export async function deleteAccount(prisma: PrismaClient, store: PhotoStore, userId: string): Promise<boolean> {
  const photos = await prisma.photo.findMany({ where: { profile: { userId } }, select: { id: true } });
  const { count } = await prisma.user.deleteMany({ where: { id: userId } });
  await removePhotoFiles(store, photos.map((photo) => photo.id));
  return count > 0;
}
