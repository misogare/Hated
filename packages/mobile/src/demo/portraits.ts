/**
 * Painted portraits for the demo, drawn as SVG in the browser in the same
 * style as the demo members' photos on a real server
 * (packages/db/src/demo-portraits.ts): a head and shoulders against a warm
 * backdrop, never a picture of a real person.
 *
 * Each photo comes with a blurred copy, as the API keeps one: what a match sees
 * until both have said hello.
 */

import type { Look } from './people';

export const PORTRAIT_WIDTH = 900;
export const PORTRAIT_HEIGHT = 1125;

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

/** How each of a person's photos is framed: zoom and sideways shift of the subject. */
const FRAMES = [
  { scale: 1, shift: 0 },
  { scale: 0.82, shift: -120 },
  { scale: 1.18, shift: 70 },
] as const;

/** A small seeded generator (mulberry32), so a person's photos look the same on every visit. */
function seeded(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** A look for someone without one of their own (the visitor's starting photos). */
export function lookFor(seed: string): Look {
  const random = seeded(seed);
  return { skin: pick(random, SKIN), hair: pick(random, HAIR), longHair: random() < 0.5, top: pick(random, TOPS), backdrop: pick(random, BACKDROPS) };
}

function paint(look: Look, index: number, seed: string, blurred: boolean): string {
  const random = seeded(`${seed}:${index}`);
  const frame = FRAMES[index % FRAMES.length]!;
  const light = pick(random, LIGHTS);
  const lightX = Math.round(150 + random() * 600);
  const lightY = Math.round(120 + random() * 260);
  const tilt = Math.round((random() - 0.5) * 8);
  const [top, bottom] = look.backdrop;
  // The subject is drawn around (450, 600) and framed by scale and shift.
  const transform = `translate(${450 + frame.shift} 640) scale(${frame.scale}) translate(-450 -640)`;
  const hairBack = look.longHair
    ? `<path d="M285 420 C270 620 300 820 330 900 L570 900 C600 820 630 620 615 420 C600 290 300 290 285 420 Z" fill="${look.hair}"/>`
    : `<ellipse cx="450" cy="400" rx="175" ry="185" fill="${look.hair}"/>`;
  // The blurred copy keeps only colour and shape, like the API's (made from a 24-pixel thumbnail).
  const blur = blurred ? '<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="48"/></filter>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_WIDTH}" height="${PORTRAIT_HEIGHT}" viewBox="0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}">
  <defs>
    <linearGradient id="backdrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${light}" stop-opacity="0.9"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
    <radialGradient id="face" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    ${blur}
  </defs>
  <rect width="${PORTRAIT_WIDTH}" height="${PORTRAIT_HEIGHT}" fill="url(#backdrop)"/>
  <g${blurred ? ' filter="url(#blur)"' : ''}>
    <circle cx="${lightX}" cy="${lightY}" r="260" fill="url(#light)"/>
    <g transform="${transform}">
      <g transform="rotate(${tilt} 450 640)">
        ${hairBack}
        <rect x="392" y="560" width="116" height="230" rx="50" fill="${look.skin}"/>
        <path d="M100 1500 L100 1180 C120 880 280 760 450 760 C620 760 780 880 800 1180 L800 1500 Z" fill="${look.top}"/>
        <ellipse cx="450" cy="455" rx="148" ry="182" fill="${look.skin}"/>
        <ellipse cx="450" cy="455" rx="148" ry="182" fill="url(#face)"/>
        <path d="M300 410 C300 290 380 250 450 250 C540 250 610 300 604 420 C560 350 470 330 300 410 Z" fill="${look.hair}"/>
      </g>
    </g>
  </g>
</svg>`;
}

const painted = new Map<string, string>();

/** Photo `index` of someone with this look, full or blurred, as a data URI an image can show. */
export function portrait(look: Look, index: number, seed: string, variant: 'full' | 'blurred'): string {
  const key = `${seed}:${index}:${variant}`;
  let uri = painted.get(key);
  if (uri === undefined) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(paint(look, index, seed, variant === 'blurred'))}`;
    painted.set(key, uri);
  }
  return uri;
}
