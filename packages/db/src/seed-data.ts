/**
 * Starter data installed by `prisma db seed`: the trusted-institution allowlist
 * and one FirstDate questionnaire.
 *
 * Kept separate from the seeding logic (see `seed.ts`) so the data can be
 * unit-tested without a database. The `Prisma` import is type-only, so this
 * module stays lightweight at runtime.
 */

import type { Prisma } from './generated/prisma/client.js';
import { QuestionKind, VerificationType } from './generated/prisma/enums.js';

export interface SeedInstitution {
  domain: string;
  name: string;
  type: VerificationType;
}

export interface SeedQuestion {
  key: string;
  prompt: string;
  kind: QuestionKind;
  /** Trait this answer feeds into, when the question is scored. */
  traitKey?: string;
  /** Choice labels / scale bounds, when the kind needs them. */
  options?: Prisma.InputJsonValue;
}

export const SEED_QUESTIONNAIRE = {
  key: 'firstdate-2026',
  version: 1,
  title: 'FirstDate',
  description:
    'Self-reported traits and preferences that FirstDate turns into ranked partner lists.',
} as const;

/**
 * Domains allowed to verify as trusted institutions.
 *
 * This is an identity gate (anti-catfish / anti-bot), not an affinity signal:
 * it bounds the pool to verified people, it does not make anyone a better match.
 *
 * Academic domains are regional: the US uses `.edu`, Australia `.edu.au`,
 * the UK `.ac.uk`, and so on. Register the institution's apex domain; its
 * subdomains are accepted too, so `vu.edu.au` covers `live.vu.edu.au`.
 */
export const SEED_INSTITUTIONS: readonly SeedInstitution[] = [
  { domain: 'harvard.edu', name: 'Harvard University', type: VerificationType.EDU },
  { domain: 'mit.edu', name: 'Massachusetts Institute of Technology', type: VerificationType.EDU },
  { domain: 'stanford.edu', name: 'Stanford University', type: VerificationType.EDU },
  { domain: 'berkeley.edu', name: 'University of California, Berkeley', type: VerificationType.EDU },
  { domain: 'vu.edu.au', name: 'Victoria University', type: VerificationType.EDU },
  {
    domain: 'nasa.gov',
    name: 'National Aeronautics and Space Administration',
    type: VerificationType.GOV,
  },
  { domain: 'nih.gov', name: 'National Institutes of Health', type: VerificationType.GOV },
  { domain: 'cdc.gov', name: 'Centers for Disease Control and Prevention', type: VerificationType.GOV },
];

/**
 * One SCALE question per scored trait (the `traitKey`s line up with the engine's
 * trait vocabulary), plus a non-scored example choice question.
 * `position` is assigned by array index when seeding.
 */
export const SEED_QUESTIONS: readonly SeedQuestion[] = [
  {
    key: 'values',
    prompt: 'How much do shared values shape your day-to-day life?',
    kind: QuestionKind.SCALE,
    traitKey: 'values',
    options: { min: 0, max: 1 },
  },
  {
    key: 'lifestyle',
    prompt: 'How would you describe your social energy?',
    kind: QuestionKind.SCALE,
    traitKey: 'lifestyle',
    options: { min: 0, max: 1, left: 'homebody', right: 'always out' },
  },
  {
    key: 'ambition',
    prompt: 'How driven are you about career or craft?',
    kind: QuestionKind.SCALE,
    traitKey: 'ambition',
    options: { min: 0, max: 1, left: 'easygoing', right: 'very driven' },
  },
  {
    key: 'humor',
    prompt: 'How much do you lead with humor?',
    kind: QuestionKind.SCALE,
    traitKey: 'humor',
    options: { min: 0, max: 1 },
  },
  {
    key: 'openness',
    prompt: 'How open are you to new experiences?',
    kind: QuestionKind.SCALE,
    traitKey: 'openness',
    options: { min: 0, max: 1 },
  },
  {
    key: 'weekend',
    prompt: 'What does an ideal weekend look like?',
    kind: QuestionKind.SINGLE_CHOICE,
    options: { choices: ['outdoors', 'culture', 'quiet', 'social'] },
  },
];
