/**
 * The words the API puts on a profile and a match, worked out the same way:
 * highlights from someone's answers (packages/db/src/descriptions.ts), why two
 * people fit (`explainMatch` in packages/db/src/results.ts) and openers for an
 * empty conversation. Copied here so the demo reads like the real thing.
 */

import type { Desire } from '@hated/api/contract';

/** Per trait, what a low, middling and high answer says. */
const LEVELS: Readonly<Record<string, readonly [string, string, string]>> = {
  values: ['Values can flex', 'Values matter, within reason', 'Values shape everything'],
  lifestyle: ['Happiest at home', 'Half nights in, half out', 'Always up for going out'],
  ambition: ['Work stays in its place', 'Driven, with balance', 'All in on work'],
  humor: ['More earnest than jokey', 'Knows when a joke fits', 'Humor comes first'],
  openness: ['Loves the familiar', 'Open, one step at a time', 'Always up for something new'],
};

const WEEKENDS: Readonly<Record<string, string>> = {
  outdoors: 'Weekends outdoors',
  culture: 'Weekends at galleries and gigs',
  quiet: 'Quiet weekends',
  social: 'Weekends with friends',
};

function level(value: number): 0 | 1 | 2 {
  return value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2;
}

/** Up to four highlights, the most telling first: the traits furthest from the middle, then the ideal weekend. */
export function describePerson(traits: Readonly<Record<string, number>>, weekend: string | null): string[] {
  const weekendLine = weekend === null ? undefined : WEEKENDS[weekend];
  const lines = Object.entries(traits)
    .filter(([key]) => LEVELS[key] !== undefined)
    .sort(([keyA, a], [keyB, b]) => Math.abs(b - 0.5) - Math.abs(a - 0.5) || keyA.localeCompare(keyB))
    .slice(0, weekendLine === undefined ? 4 : 3)
    .map(([key, value]) => LEVELS[key]![level(value)]);
  return weekendLine === undefined ? lines : [...lines, weekendLine];
}

/** Two values this close count as "the same" for an explanation. */
const CLOSE = 0.15;

const TRAIT_COPY: Record<string, { alike: [string, string, string]; hoped: string }> = {
  values: {
    alike: ['Neither of you needs values to line up perfectly', 'Shared values matter to you both, within reason', 'Shared values shape both your lives'],
    hoped: 'They care about values the way you hoped',
  },
  lifestyle: {
    alike: ["You're both happiest at home", 'You both like a mix of nights in and out', "You're both always up for going out"],
    hoped: 'Their social energy is what you hoped for',
  },
  ambition: {
    alike: ['You both keep work in its place', "You're both driven, with balance", "You're both all in on your work"],
    hoped: 'Just as driven as you hoped',
  },
  humor: {
    alike: ["You're both more earnest than jokey", 'You both know when a joke fits', 'You both lead with humor'],
    hoped: 'Their humor is what you hoped for',
  },
  openness: {
    alike: ['You both love what you know', "You're both open, at your own pace", 'You both say yes to new things'],
    hoped: 'Just as open as you hoped',
  },
};

/** Why the visitor and their match fit, strongest first: hopes the match meets, then traits they share. */
export function explainMatch(traits: Readonly<Record<string, number>>, desires: Readonly<Record<string, Desire>>, partner: Readonly<Record<string, number>>): string[] {
  const candidates: { text: string; strength: number }[] = [];
  for (const [key, desire] of Object.entries(desires)) {
    const copy = TRAIT_COPY[key];
    const value = partner[key];
    if (copy === undefined || value === undefined || desire.weight <= 0) continue;
    const gap = Math.abs(value - desire.target);
    if (gap <= CLOSE) candidates.push({ text: copy.hoped, strength: 1 + desire.weight * (1 - gap) });
  }
  const mentioned = new Set(candidates.map(({ text }) => text));
  for (const [key, mine] of Object.entries(traits)) {
    const copy = TRAIT_COPY[key];
    const theirs = partner[key];
    if (copy === undefined || theirs === undefined) continue;
    const gap = Math.abs(mine - theirs);
    if (gap > CLOSE || mentioned.has(copy.hoped)) continue;
    candidates.push({ text: copy.alike[level((mine + theirs) / 2)], strength: 1 - gap });
  }
  return candidates
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map(({ text }) => text);
}

const PROMPT_OPENERS: Readonly<Record<string, string>> = {
  'perfect-sunday': 'Your perfect Sunday sounds good. What would you add to it?',
  'weirdly-good-at': "I have to ask about the thing you're weirdly good at.",
  'win-me-over': 'Noted how to win you over. Where should I start?',
  'green-flag': "Good green flag. What's one you've spotted lately?",
  'obsessed-with': "Tell me more about what you're obsessed with right now.",
  'first-date': 'Your ideal first date sounds good. What makes it work?',
  'hate-about-apps': 'Same. So what made you try one more app?',
};

const TRAIT_OPENERS: Readonly<Record<string, readonly [string, string]>> = {
  humor: ["What's something you take more seriously than most people?", "What's the last thing that made you properly laugh?"],
  lifestyle: ['Perfect night in: what are we eating and watching?', 'Perfect night out: where do we start?'],
  openness: ["What's a favourite you never get tired of?", "What's something new you tried recently?"],
  ambition: ['What do you do to switch off?', "What are you working on that you're excited about?"],
  values: ["What's something you care about more than most people do?", "What's something you care about more than most people do?"],
};

/** Three ways to start: about two of the match's prompts, then traits the two share, then one that always fits. */
export function suggestOpeners(prompts: readonly { key: string }[], traits: Readonly<Record<string, number>>, partner: Readonly<Record<string, number>>): string[] {
  const openers = prompts.flatMap((prompt) => PROMPT_OPENERS[prompt.key] ?? []).slice(0, 2);
  const shared = Object.keys(TRAIT_OPENERS)
    .flatMap((key) => {
      const mine = traits[key];
      const theirs = partner[key];
      if (mine === undefined || theirs === undefined || Math.abs(mine - theirs) > CLOSE) return [];
      return [{ key, gap: Math.abs(mine - theirs), together: (mine + theirs) / 2 }];
    })
    .sort((a, b) => a.gap - b.gap || a.key.localeCompare(b.key));
  for (const { key, together } of shared) openers.push(TRAIT_OPENERS[key]![together < 0.5 ? 0 : 1]!);
  openers.push('What made you try an app for people who hate dating apps?');
  return [...new Set(openers)].slice(0, 3);
}
