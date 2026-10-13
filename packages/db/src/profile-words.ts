/**
 * The words on a profile: one line about themselves, and answers to a few of
 * the app's prompts. With the photos and the highlights worked out from the
 * questionnaire, they are what a match reads before deciding to say hello.
 */

import type { PrismaClient } from './generated/prisma/client.js';

/** The prompts people can answer. Keys are stored; labels can be reworded freely. */
export const PROMPTS = [
  { key: 'perfect-sunday', label: 'A perfect Sunday' },
  { key: 'weirdly-good-at', label: "I'm weirdly good at" },
  { key: 'win-me-over', label: 'The way to win me over' },
  { key: 'green-flag', label: 'A green flag I look for' },
  { key: 'obsessed-with', label: 'Currently obsessed with' },
  { key: 'first-date', label: 'An ideal first date' },
  { key: 'hate-about-apps', label: 'What I hate about dating apps' },
] as const;

export const MAX_BIO_LENGTH = 120;
export const MAX_PROMPT_ANSWER_LENGTH = 150;
export const MAX_PROMPTS = 3;

export interface PromptAnswer {
  key: string;
  /** The prompt as the app shows it, e.g. "A perfect Sunday". */
  label: string;
  answer: string;
}

export interface WordsInput {
  bio: string | null;
  /** In the order to show them. A blank answer drops that prompt. */
  prompts: ReadonlyArray<{ key: string; answer: string }>;
}

export interface WordsView {
  bio: string | null;
  prompts: PromptAnswer[];
}

export type SaveWordsResult =
  | { ok: true; words: WordsView }
  | { ok: false; reason: 'no-profile' }
  | { ok: false; reason: 'invalid'; problems: string[] };

const LABELS: ReadonlyMap<string, string> = new Map(PROMPTS.map((prompt) => [prompt.key, prompt.label]));

/** Runs of whitespace, newlines included, become one space: these are one-liners. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Stored prompt answers as the app shows them, skipping any prompt that has since been retired. */
export function toPromptAnswers(rows: ReadonlyArray<{ key: string; answer: string }>): PromptAnswer[] {
  return rows.flatMap((row) => {
    const label = LABELS.get(row.key);
    return label === undefined ? [] : [{ key: row.key, label, answer: row.answer }];
  });
}

/** Everything wrong with the words, in words the app can show. Empty when valid. */
export function validateWords(input: WordsInput): string[] {
  const problems: string[] = [];
  if (input.bio !== null && tidy(input.bio).length > MAX_BIO_LENGTH) {
    problems.push(`Keep your line under ${MAX_BIO_LENGTH} characters.`);
  }
  const answered = input.prompts.filter((prompt) => tidy(prompt.answer).length > 0);
  if (answered.length > MAX_PROMPTS) problems.push(`Choose up to ${MAX_PROMPTS} prompts.`);
  const seen = new Set<string>();
  for (const prompt of answered) {
    const label = LABELS.get(prompt.key);
    if (label === undefined) problems.push(`There's no prompt called "${prompt.key}".`);
    else if (seen.has(prompt.key)) problems.push(`Answer "${label}" only once.`);
    else if (tidy(prompt.answer).length > MAX_PROMPT_ANSWER_LENGTH) {
      problems.push(`Keep your answer to "${label}" under ${MAX_PROMPT_ANSWER_LENGTH} characters.`);
    }
    seen.add(prompt.key);
  }
  return problems;
}

/** Replace the person's line and prompt answers. */
export async function saveWords(prisma: PrismaClient, userId: string, input: WordsInput): Promise<SaveWordsResult> {
  const problems = validateWords(input);
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };

  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return { ok: false, reason: 'no-profile' };

  const bio = input.bio === null ? null : tidy(input.bio) || null;
  const prompts = input.prompts
    .map((prompt) => ({ key: prompt.key, answer: tidy(prompt.answer) }))
    .filter((prompt) => prompt.answer.length > 0);

  await prisma.$transaction([
    prisma.profile.update({ where: { id: profile.id }, data: { bio } }),
    prisma.profilePrompt.deleteMany({ where: { profileId: profile.id } }),
    prisma.profilePrompt.createMany({
      data: prompts.map((prompt, position) => ({ profileId: profile.id, key: prompt.key, answer: prompt.answer, position })),
    }),
  ]);
  return { ok: true, words: { bio, prompts: toPromptAnswers(prompts) } };
}
