/**
 * Questionnaire answers and partner preferences: the inputs FirstDate scores.
 *
 * Answers are stored as given (`Answer` rows under one `QuestionnaireResponse`
 * per person), and every SCALE question tied to a `traitKey` is also derived
 * into the `ProfileTrait` the engine reads. Skipping a question removes both,
 * so the engine scores that trait as unknown rather than as a guess.
 *
 * Desires are what a person hopes for on each trait: a target and how much it
 * matters. A weight of 0 ("don't mind") stores nothing, which the engine reads
 * as "ignore this trait".
 */

import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface QuestionView {
  key: string;
  prompt: string;
  kind: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE' | 'BOOLEAN' | 'TEXT';
  /** The engine trait a SCALE answer feeds, if any. */
  traitKey: string | null;
  /** Kind-specific options as seeded, e.g. `{ min, max, left, right }` or `{ choices }`. */
  options: unknown;
}

export interface QuestionnaireView {
  id: string;
  title: string;
  questions: QuestionView[];
}

/** A SCALE answer in [0, 1], a SINGLE_CHOICE choice, or null to skip. */
export type AnswerValue = number | string | null;

export interface DesireInput {
  /** The value hoped for, in [0, 1]. */
  target: number;
  /** How much it matters, in [0, 1]; 0 means "don't mind". */
  weight: number;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'no-profile' } | { ok: false; reason: 'invalid'; problems: string[] };

/** The questionnaire the app should show: the newest active one, questions in order. */
export async function getActiveQuestionnaire(prisma: PrismaClient): Promise<QuestionnaireView | null> {
  const questionnaire = await prisma.questionnaire.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  if (questionnaire === null) return null;
  return {
    id: questionnaire.id,
    title: questionnaire.title,
    questions: questionnaire.questions.map((question) => ({
      key: question.key,
      prompt: question.prompt,
      kind: question.kind,
      traitKey: question.traitKey,
      options: question.options,
    })),
  };
}

/**
 * Save some or all answers. Only the keys present are touched, so the app can
 * save one question at a time; `null` clears an answer.
 */
export async function saveAnswers(
  prisma: PrismaClient,
  userId: string,
  answers: Readonly<Record<string, AnswerValue>>,
  options: { now?: Date } = {},
): Promise<SaveResult> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return { ok: false, reason: 'no-profile' };

  const questionnaire = await prisma.questionnaire.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    include: { questions: true },
  });
  if (questionnaire === null) return { ok: false, reason: 'invalid', problems: ['There is no questionnaire to answer.'] };

  const byKey = new Map(questionnaire.questions.map((question) => [question.key, question]));
  const problems: string[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const question = byKey.get(key);
    if (question === undefined) problems.push(`Unknown question "${key}".`);
    else {
      const problem = checkAnswer(question.kind, question.options, value);
      if (problem !== null) problems.push(`${key}: ${problem}`);
    }
  }
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };

  const now = options.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    const response = await tx.questionnaireResponse.upsert({
      where: { profileId_questionnaireId: { profileId: profile.id, questionnaireId: questionnaire.id } },
      create: { profileId: profile.id, questionnaireId: questionnaire.id, submittedAt: now, derivedAt: now },
      update: { submittedAt: now, derivedAt: now },
      select: { id: true },
    });

    for (const [key, value] of Object.entries(answers)) {
      const question = byKey.get(key)!;
      const where = { responseId_questionId: { responseId: response.id, questionId: question.id } };
      if (value === null) {
        await tx.answer.deleteMany({ where: { responseId: response.id, questionId: question.id } });
      } else {
        const stored = typeof value === 'number' ? { valueNumber: value, valueText: null } : { valueNumber: null, valueText: value };
        await tx.answer.upsert({
          where,
          create: { responseId: response.id, questionId: question.id, ...stored },
          update: stored,
        });
      }

      if (question.kind === 'SCALE' && question.traitKey !== null) {
        if (value === null) {
          await tx.profileTrait.deleteMany({ where: { profileId: profile.id, key: question.traitKey } });
        } else {
          await tx.profileTrait.upsert({
            where: { profileId_key: { profileId: profile.id, key: question.traitKey } },
            create: { profileId: profile.id, key: question.traitKey, value: value as number },
            update: { value: value as number },
          });
        }
      }
    }
  });
  return { ok: true };
}

/** The person's saved answers by question key; unanswered questions are absent. */
export async function getAnswers(prisma: PrismaClient, userId: string): Promise<Record<string, AnswerValue>> {
  const answers = await prisma.answer.findMany({
    where: { response: { profile: { userId }, questionnaire: { isActive: true } } },
    include: { question: { select: { key: true } } },
  });
  return Object.fromEntries(answers.map((answer) => [answer.question.key, answer.valueNumber ?? answer.valueText]));
}

/** Replace what the person hopes for on the given traits; other traits are untouched. */
export async function saveDesires(
  prisma: PrismaClient,
  userId: string,
  desires: Readonly<Record<string, DesireInput>>,
): Promise<SaveResult> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (profile === null) return { ok: false, reason: 'no-profile' };

  const known = await traitKeys(prisma);
  const problems: string[] = [];
  for (const [key, desire] of Object.entries(desires)) {
    if (!known.has(key)) problems.push(`Unknown trait "${key}".`);
    else if (!inUnitRange(desire.target) || !inUnitRange(desire.weight)) {
      problems.push(`${key}: target and weight must be between 0 and 1.`);
    }
  }
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };

  await prisma.$transaction(async (tx) => {
    for (const [key, desire] of Object.entries(desires)) {
      if (desire.weight === 0) {
        await tx.profileDesire.deleteMany({ where: { profileId: profile.id, key } });
      } else {
        await tx.profileDesire.upsert({
          where: { profileId_key: { profileId: profile.id, key } },
          create: { profileId: profile.id, key, target: desire.target, weight: desire.weight },
          update: { target: desire.target, weight: desire.weight },
        });
      }
    }
  });
  return { ok: true };
}

/** What the person hopes for, by trait key; "don't mind" traits are absent. */
export async function getDesires(prisma: PrismaClient, userId: string): Promise<Record<string, DesireInput>> {
  const desires = await prisma.profileDesire.findMany({ where: { profile: { userId } } });
  return Object.fromEntries(desires.map((desire) => [desire.key, { target: desire.target, weight: desire.weight }]));
}

/** Why an answer does not fit its question, or null when it does. */
function checkAnswer(kind: string, options: Prisma.JsonValue, value: AnswerValue): string | null {
  if (value === null) return null;
  switch (kind) {
    case 'SCALE':
      return typeof value === 'number' && inUnitRange(value) ? null : 'expected a number between 0 and 1.';
    case 'SINGLE_CHOICE': {
      const choices = (options as { choices?: unknown } | null)?.choices;
      return typeof value === 'string' && Array.isArray(choices) && choices.includes(value)
        ? null
        : 'expected one of the listed choices.';
    }
    default:
      return `${kind.toLowerCase()} questions cannot be answered yet.`;
  }
}

/** Trait keys the active questionnaire measures: the only ones a desire can target. */
async function traitKeys(prisma: PrismaClient): Promise<Set<string>> {
  const questions = await prisma.question.findMany({
    where: { questionnaire: { isActive: true }, traitKey: { not: null } },
    select: { traitKey: true },
  });
  return new Set(questions.map((question) => question.traitKey!));
}

function inUnitRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
