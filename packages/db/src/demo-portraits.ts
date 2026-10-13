/**
 * Photos for demo members: simple painted portraits (a head and shoulders
 * against a warm backdrop), never pictures of real people. Blurred, they read
 * like any blurred photo; in full, plainly as illustrations.
 *
 * Each member gets one look (skin, hair) seen in two or three settings, so
 * their photos belong together the way one person's photos do.
 */

import type { Rng } from '@hated/core';
import sharp from 'sharp';

const WIDTH = 900;
const HEIGHT = 1125;

const SKIN = ['#F1C7A5', '#E3B08C', '#C98D66', '#A9704D', '#7F4D34', '#5C3626'] as const;
const HAIR = ['#21160F', '#3B2418', '#5A3A22', '#8A5A2B', '#B9874E', '#1E1A1A', '#6B4B3E'] as const;
const TOPS = ['#B83A5E', '#2F4858', '#E8A33D', '#3A1E2A', '#7E8FB0', '#5E7D5A', '#F2C4B3', '#FBEFE8'] as const;
const BACKDROPS = [
  ['#D9A089', '#B97A63'],
  ['#8FA3A0', '#6E8480'],
  ['#C9B27C', '#A88F5A'],
  ['#B58DA0', '#8F6A7C'],
  ['#7E8FB0', '#5D6D8E'],
  ['#D4886A', '#AD6A4F'],
  ['#E8D5C4', '#C9B29C'],
] as const;
const LIGHTS = ['#FFF3D6', '#F7DFB8', '#FBEFE8'] as const;

/** How each of a member's photos is framed: zoom and sideways shift of the subject. */
const FRAMES = [
  { scale: 1, shift: 0 },
  { scale: 0.82, shift: -120 },
  { scale: 1.18, shift: 70 },
] as const;

interface Look {
  skin: string;
  hair: string;
  longHair: boolean;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

function portraitSvg(look: Look, frame: (typeof FRAMES)[number], rng: Rng): string {
  const [top, bottom] = pick(rng, BACKDROPS);
  const light = pick(rng, LIGHTS);
  const shirt = pick(rng, TOPS);
  const lightX = Math.round(150 + rng.next() * 600);
  const lightY = Math.round(120 + rng.next() * 260);
  const tilt = Math.round((rng.next() - 0.5) * 8);
  // The subject is drawn around (450, 600) and framed by scale and shift.
  const transform = `translate(${450 + frame.shift} 640) scale(${frame.scale}) translate(-450 -640)`;
  const hairBack = look.longHair
    ? `<path d="M285 420 C270 620 300 820 330 900 L570 900 C600 820 630 620 615 420 C600 290 300 290 285 420 Z" fill="${look.hair}"/>`
    : `<ellipse cx="450" cy="400" rx="175" ry="185" fill="${look.hair}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="backdrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${light}" stop-opacity="0.9"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
    <radialGradient id="face" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#backdrop)"/>
  <circle cx="${lightX}" cy="${lightY}" r="260" fill="url(#light)"/>
  <g transform="${transform}">
    <g transform="rotate(${tilt} 450 640)">
      ${hairBack}
      <rect x="392" y="560" width="116" height="230" rx="50" fill="${look.skin}"/>
      <path d="M100 1500 L100 1180 C120 880 280 760 450 760 C620 760 780 880 800 1180 L800 1500 Z" fill="${shirt}"/>
      <ellipse cx="450" cy="455" rx="148" ry="182" fill="${look.skin}"/>
      <ellipse cx="450" cy="455" rx="148" ry="182" fill="url(#face)"/>
      <path d="M300 410 C300 290 380 250 450 250 C540 250 610 300 604 420 C560 350 470 330 300 410 Z" fill="${look.hair}"/>
    </g>
  </g>
</svg>`;
}

/** Two or three JPEG portraits of one made-up person. */
export async function demoPortraits(rng: Rng): Promise<Buffer[]> {
  const look: Look = { skin: pick(rng, SKIN), hair: pick(rng, HAIR), longHair: rng.next() < 0.5 };
  const count = rng.next() < 0.5 ? 2 : 3;
  const photos: Buffer[] = [];
  for (const frame of FRAMES.slice(0, count)) {
    photos.push(await sharp(Buffer.from(portraitSvg(look, frame, rng))).jpeg({ quality: 88 }).toBuffer());
  }
  return photos;
}
