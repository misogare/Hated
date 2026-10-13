/**
 * Plain words about a person, worked out from their questionnaire: the
 * highlights a match reads ("Humor comes first"), and a few ways to start the
 * conversation once two people have both said hello.
 *
 * Phrases never use pronouns, so one set reads right about anyone, on their
 * own profile or a match's.
 */

/** Per trait, what a low, middling and high answer says. Unlisted traits are never mentioned. */
const LEVELS: Readonly<Record<string, readonly [string, string, string]>> = {
  values: ['Values can flex', 'Values matter, within reason', 'Values shape everything'],
  lifestyle: ['Happiest at home', 'Half nights in, half out', 'Always up for going out'],
  ambition: ['Work stays in its place', 'Driven, with balance', 'All in on work'],
  humor: ['More earnest than jokey', 'Knows when a joke fits', 'Humor comes first'],
  openness: ['Loves the familiar', 'Open, one step at a time', 'Always up for something new'],
};

/** The ideal-weekend answer, by choice. */
const WEEKENDS: Readonly<Record<string, string>> = {
  outdoors: 'Weekends outdoors',
  culture: 'Weekends at galleries and gigs',
  quiet: 'Quiet weekends',
  social: 'Weekends with friends',
};

const MAX_HIGHLIGHTS = 4;

function level(value: number): 0 | 1 | 2 {
  return value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2;
}

/**
 * Up to four highlights, the most telling first: the traits furthest from the
 * middle, then the ideal weekend if there is one.
 */
export function describePerson(traits: Readonly<Record<string, number>>, weekend: string | null = null): string[] {
  const weekendLine = weekend === null ? undefined : WEEKENDS[weekend];
  const ranked = Object.entries(traits)
    .filter(([key]) => LEVELS[key] !== undefined)
    .sort(([keyA, a], [keyB, b]) => Math.abs(b - 0.5) - Math.abs(a - 0.5) || keyA.localeCompare(keyB));
  const lines = ranked
    .slice(0, weekendLine === undefined ? MAX_HIGHLIGHTS : MAX_HIGHLIGHTS - 1)
    .map(([key, value]) => LEVELS[key]![level(value)]);
  return weekendLine === undefined ? lines : [...lines, weekendLine];
}

/** An opener for each prompt, about the partner's answer to it. */
const PROMPT_OPENERS: Readonly<Record<string, string>> = {
  'perfect-sunday': 'Your perfect Sunday sounds good. What would you add to it?',
  'weirdly-good-at': "I have to ask about the thing you're weirdly good at.",
  'win-me-over': 'Noted how to win you over. Where should I start?',
  'green-flag': "Good green flag. What's one you've spotted lately?",
  'obsessed-with': "Tell me more about what you're obsessed with right now.",
  'first-date': 'Your ideal first date sounds good. What makes it work?',
  'hate-about-apps': 'Same. So what made you try one more app?',
};

/** An opener for a trait two people share, for when they sit low or high on it. */
const TRAIT_OPENERS: Readonly<Record<string, readonly [string, string]>> = {
  humor: ["What's something you take more seriously than most people?", "What's the last thing that made you properly laugh?"],
  lifestyle: ['Perfect night in: what are we eating and watching?', 'Perfect night out: where do we start?'],
  openness: ["What's a favourite you never get tired of?", "What's something new you tried recently?"],
  ambition: ['What do you do to switch off?', "What are you working on that you're excited about?"],
  values: ["What's something you care about more than most people do?", "What's something you care about more than most people do?"],
};

const FALLBACK_OPENER = 'What made you try an app for people who hate dating apps?';
const SHARED = 0.15;
const MAX_OPENERS = 3;

/**
 * Three ways to start: about two of the partner's prompts first, then about
 * traits the two share (closest first), then a fallback that always fits.
 */
export function suggestOpeners(
  partnerPrompts: ReadonlyArray<{ key: string }>,
  viewerTraits: Readonly<Record<string, number>>,
  partnerTraits: Readonly<Record<string, number>>,
): string[] {
  const openers = partnerPrompts.flatMap((prompt) => PROMPT_OPENERS[prompt.key] ?? []).slice(0, 2);

  const shared = Object.keys(TRAIT_OPENERS)
    .flatMap((key) => {
      const mine = viewerTraits[key];
      const theirs = partnerTraits[key];
      if (mine === undefined || theirs === undefined || Math.abs(mine - theirs) > SHARED) return [];
      return [{ key, gap: Math.abs(mine - theirs), level: (mine + theirs) / 2 }];
    })
    .sort((a, b) => a.gap - b.gap || a.key.localeCompare(b.key));
  for (const { key, level: together } of shared) openers.push(TRAIT_OPENERS[key]![together < 0.5 ? 0 : 1]!);
  openers.push(FALLBACK_OPENER);

  return [...new Set(openers)].slice(0, MAX_OPENERS);
}
