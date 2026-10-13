import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { processPhoto } from '../src/photo-processing.js';

const SECRET = 'PHOTOGRAPHER-SECRET';

/** A camera photo: landscape pixels, stored sideways, with private metadata. */
async function cameraPhoto(width: number, height: number, orientation = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c08080' } })
    .jpeg()
    .withMetadata({ orientation })
    .withExifMerge({ IFD0: { Copyright: SECRET } })
    .toBuffer();
}

describe('processPhoto', () => {
  it('keeps an upright JPEG with every bit of metadata dropped', async () => {
    const input = await cameraPhoto(800, 600, 6);
    expect(input.includes(Buffer.from(SECRET))).toBe(true);

    const result = await processPhoto(input);
    if (!result.ok) throw new Error(result.problem);
    const full = await sharp(result.photo.full).metadata();

    // Orientation 6 means "turn 90° to view": the photo is portrait.
    expect([result.photo.width, result.photo.height]).toEqual([600, 800]);
    expect([full.width, full.height, full.format]).toEqual([600, 800, 'jpeg']);
    expect(full.exif).toBeUndefined();
    expect(result.photo.full.includes(Buffer.from(SECRET))).toBe(false);
  });

  it('shrinks big photos to fit 1080 by 1350, and never enlarges small ones', async () => {
    const big = await processPhoto(await cameraPhoto(3000, 4000));
    const small = await processPhoto(await cameraPhoto(400, 500));
    if (!big.ok || !small.ok) throw new Error('refused');
    expect([big.photo.width, big.photo.height]).toEqual([1013, 1350]);
    expect([small.photo.width, small.photo.height]).toEqual([400, 500]);
  });

  it('blurs from a few dozen pixels, so no detail can come back', async () => {
    // Fine stripes: detail that survives any ordinary blur at full size.
    const stripes = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8" fill="#000"/><rect x="4" width="4" height="8" fill="#fff"/></pattern></defs><rect width="640" height="800" fill="url(#p)"/></svg>`,
      ),
    )
      .png()
      .toBuffer();

    const result = await processPhoto(stripes);
    if (!result.ok) throw new Error(result.problem);
    const blurred = sharp(result.photo.blurred);
    const { width, height } = await blurred.metadata();
    const stats = await blurred.stats();

    expect([width, height]).toEqual([360, 450]);
    // The stripes average out to a flat grey: almost no contrast is left.
    expect(stats.channels[0]!.stdev).toBeLessThan(6);
    expect(result.photo.blurred.length).toBeLessThan(result.photo.full.length);
  });

  it('refuses what is not a photo, and photos too small to show', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>');
    const tiny = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#808080' } }).png().toBuffer();

    expect(await processPhoto(svg)).toEqual({ ok: false, problem: "That file isn't a photo we can read. Try a JPEG or PNG." });
    expect(await processPhoto(Buffer.from('not a photo'))).toMatchObject({ ok: false });
    expect(await processPhoto(tiny)).toEqual({ ok: false, problem: 'That photo is too small. Use one at least 320 pixels across.' });
  });

  it('reads PNG and WebP too', async () => {
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: '#80808080' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#808080' } }).webp().toBuffer();
    expect((await processPhoto(png)).ok).toBe(true);
    expect((await processPhoto(webp)).ok).toBe(true);
  });
});
