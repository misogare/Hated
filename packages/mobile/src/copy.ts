/**
 * Words the app puts around data: the gender vocabulary, and the phrases that
 * make questionnaire sliders feel human. Keyed by the questionnaire's trait
 * keys; a question this file doesn't know still works, just with plainer copy.
 */

import type { Question } from '@hated/api/contract';

/** Opaque gender ids sent to the API, and how they read in each place. */
export const GENDERS = [
  { id: 'woman', label: 'Woman', plural: 'Women' },
  { id: 'man', label: 'Man', plural: 'Men' },
  { id: 'nonbinary', label: 'Non-binary', plural: 'Non-binary people' },
  { id: 'another', label: 'Another identity', plural: null },
] as const;

interface TraitCopy {
  /** Name on the "what are you hoping for" card. */
  title: string;
  left: string;
  right: string;
  /** Low, middle and high readings of the person's own answer. */
  phrases: [string, string, string];
}

const TRAITS: Record<string, TraitCopy> = {
  values: {
    title: 'Shared values',
    left: 'A little',
    right: 'A lot',
    phrases: ['They stay in the background', 'They matter, within reason', 'They shape almost everything'],
  },
  lifestyle: {
    title: 'Social energy',
    left: 'Homebody',
    right: 'Always out',
    phrases: ['Happiest at home', 'Depends on the week', 'Always up for going out'],
  },
  ambition: {
    title: 'Drive',
    left: 'Easygoing',
    right: 'Very driven',
    phrases: ['Work is one part of life', 'Driven, with balance', 'All in on the work'],
  },
  humor: {
    title: 'Humor',
    left: 'Rarely',
    right: 'Always',
    phrases: ['More earnest than jokey', 'Funny when it fits', 'Humor first, always'],
  },
  openness: {
    title: 'Openness',
    left: 'Prefer the familiar',
    right: 'Up for anything',
    phrases: ['Love what I know', 'Open, at my own pace', 'Say yes to almost anything'],
  },
};

/** Slider end labels: the question's own when seeded, else ours. */
export function scaleLabels(question: Question): { left: string; right: string } {
  const options = (question.options ?? {}) as { left?: string; right?: string };
  const copy = question.traitKey === null ? undefined : TRAITS[question.traitKey];
  return {
    left: capitalize(options.left ?? copy?.left ?? 'Less'),
    right: capitalize(options.right ?? copy?.right ?? 'More'),
  };
}

/** A friendly reading of a slider value in [0, 1], or null for unknown traits. */
export function scalePhrase(question: Question, value: number): string | null {
  const copy = question.traitKey === null ? undefined : TRAITS[question.traitKey];
  if (copy === undefined) return null;
  return copy.phrases[value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2];
}

export function traitTitle(question: Question): string {
  return (question.traitKey !== null && TRAITS[question.traitKey]?.title) || question.prompt;
}

export function choiceList(question: Question): string[] {
  const choices = (question.options as { choices?: unknown } | null)?.choices;
  return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === 'string') : [];
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** "Sunday at 8 pm" in the phone's own time zone. */
export function roundTime(iso: string): string {
  const date = new Date(iso);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const time = date
    .toLocaleTimeString(undefined, { hour: 'numeric', ...(date.getMinutes() === 0 ? {} : { minute: '2-digit' }) })
    .replace(/\s?([AP])\.?M\.?$/i, (_, half: string) => ` ${half.toLowerCase()}m`);
  return `${weekday} at ${time}`;
}
