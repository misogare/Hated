/**
 * Turning an upload into the two files HateD keeps.
 *
 * - The full photo: turned upright, at most 1080 by 1350, as JPEG. Re-encoding
 *   drops every bit of metadata, so a phone's GPS position or serial number
 *   never leaves with the photo.
 * - The blurred photo: shrunk to a few dozen pixels first, so no detail
 *   survives, then blurred and scaled back up. This is the only version a match
 *   can fetch until both have said hello; blurring in the app instead would put
 *   the real photo on the wire.
 */

import sharp, { type SharpOptions } from 'sharp';

/** Biggest upload accepted, in bytes. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** The short side must be at least this many pixels. */
export const MIN_PHOTO_SIDE = 320;

/** A 50-megapixel ceiling, so a tiny file claiming to be enormous can't exhaust memory. */
const READ: SharpOptions = { autoOrient: true, failOn: 'error', limitInputPixels: 50_000_000 };
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'gif', 'tiff']);

export interface ProcessedPhoto {
  full: Buffer;
  blurred: Buffer;
  /** Of the full photo. */
  width: number;
  height: number;
}

export type ProcessPhotoResult = { ok: true; photo: ProcessedPhoto } | { ok: false; problem: string };

export async function processPhoto(input: Buffer): Promise<ProcessPhotoResult> {
  if (input.length > MAX_UPLOAD_BYTES) return { ok: false, problem: 'That photo is too big. Try one under 15 MB.' };

  let width: number;
  let height: number;
  try {
    const metadata = await sharp(input, READ).metadata();
    // An SVG is a document, not a photo, and the rest can't be read reliably.
    if (metadata.format === undefined || !FORMATS.has(metadata.format)) throw new Error('unsupported format');
    width = metadata.autoOrient.width;
    height = metadata.autoOrient.height;
  } catch {
    return { ok: false, problem: "That file isn't a photo we can read. Try a JPEG or PNG." };
  }
  if (Math.min(width, height) < MIN_PHOTO_SIDE) {
    return { ok: false, problem: `That photo is too small. Use one at least ${MIN_PHOTO_SIDE} pixels across.` };
  }

  const full = await sharp(input, READ)
    .resize({ width: 1080, height: 1350, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const tiny = await sharp(input, READ).resize({ width: 24, height: 30, fit: 'inside' }).toBuffer();
  const blurred = await sharp(tiny).resize({ width: 360, kernel: 'mitchell' }).blur(12).jpeg({ quality: 85 }).toBuffer();

  return { ok: true, photo: { full: full.data, blurred, width: full.info.width, height: full.info.height } };
}
