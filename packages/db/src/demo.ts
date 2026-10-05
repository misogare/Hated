/**
 * A demo population for development: believable, fictional members so a round
 * on a laptop has someone to match, a reveal to open and a chat to try.
 *
 * Everyone lives at "HateD Demo University" on `demo.example.edu`. The
 * `example.edu` domain is reserved by IANA for documentation, so no email to a
 * demo address can reach anyone. Demo members are created through the same
 * services the app uses (profile, answers, desires) and are deterministic for a
 * given seed. To sign in as one, run the API with MAIL_TRANSPORT=console and
 * read the code from its log.
 */

import { createRng, type Rng } from '@hated/core';

import { saveAnswers, saveDesires } from './answers.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { saveProfile } from './profiles.js';

export const DEMO_DOMAIN = 'demo.example.edu';
const DEMO_INSTITUTION = 'HateD Demo University';

export interface DemoOptions {
  /** How many members. Default 24. */
  count?: number;
  /** Seed for every random choice, so the same seed gives the same people. Default 7. */
  seed?: number;
  now?: Date;
}

export interface DemoSummary {
  created: number;
  /** Counts by "gender seeking …", e.g. "woman → man". */
  mix: Record<string, number>;
}

const NAMES = {
  woman: ['Maya', 'Priya', 'Chloe', 'Zara', 'Sofia', 'Amelia', 'Leila', 'Hannah', 'Ruby', 'Isla', 'Grace', 'Nina', 'Ava', 'Mei'],
  man: ['Liam', 'Noah', 'Arjun', 'Mateo', 'Ethan', 'Kai', 'Omar', 'Lucas', 'Theo', 'Ravi', 'Leo', 'Tom'],
  nonbinary: ['Sam', 'Jordan', 'Alex', 'Riley', 'Quinn', 'Rowan'],
} as const;

/**
 * Who is open to whom, repeated to fill the population. Weighted so that
 * every common pairing has someone on both sides.
 */
const MIX: ReadonlyArray<{ gender: keyof typeof NAMES; seeking: string[] }> = [
  { gender: 'woman', seeking: ['man'] },
  { gender: 'man', seeking: ['woman'] },
  { gender: 'woman', seeking: ['man'] },
  { gender: 'man', seeking: ['woman'] },
  { gender: 'woman', seeking: [] },
  { gender: 'nonbinary', seeking: [] },
  { gender: 'woman', seeking: ['man'] },
  { gender: 'man', seeking: ['woman'] },
  { gender: 'woman', seeking: ['woman'] },
  { gender: 'man', seeking: ['man'] },
  { gender: 'woman', seeking: ['man', 'nonbinary'] },
  { gender: 'nonbinary', seeking: ['woman', 'nonbinary'] },
];

/** Replace the demo population with a fresh one. Real accounts are never touched. */
export async function seedDemoPopulation(prisma: PrismaClient, options: DemoOptions = {}): Promise<DemoSummary> {
  const count = options.count ?? 24;
  const now = options.now ?? new Date();
  const rng = createRng(options.seed ?? 7);

  await clearDemoPopulation(prisma);
  const institution = await prisma.institution.upsert({
    where: { domain: DEMO_DOMAIN },
    create: { domain: DEMO_DOMAIN, name: DEMO_INSTITUTION, type: 'EDU' },
    update: { name: DEMO_INSTITUTION, isActive: true },
  });
  const questionnaire = await prisma.questionnaire.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  if (questionnaire === null) throw new Error('No active questionnaire. Run `npm run seed` first.');

  const used = { woman: 0, man: 0, nonbinary: 0 };
  const mix: Record<string, number> = {};
  for (let index = 0; index < count; index++) {
    const { gender, seeking } = MIX[index % MIX.length]!;
    const names = NAMES[gender];
    const name = names[used[gender]++ % names.length]!;
    const email = `${name.toLowerCase()}.${index + 1}@${DEMO_DOMAIN}`;
    const label = `${gender} → ${seeking.length === 0 ? 'everyone' : seeking.join(' or ')}`;
    mix[label] = (mix[label] ?? 0) + 1;

    const user = await prisma.user.create({ data: { email, emailVerified: true } });
    await prisma.institutionVerification.create({
      data: {
        userId: user.id,
        email,
        domain: DEMO_DOMAIN,
        type: 'EDU',
        status: 'VERIFIED',
        codeHash: 'demo',
        expiresAt: now,
        verifiedAt: now,
        consumedAt: now,
        institutionId: institution.id,
      },
    });

    const age = 19 + Math.floor(rng.next() * 12);
    const birthDate = new Date(Date.UTC(now.getUTCFullYear() - age - 1, Math.floor(rng.next() * 12), 1 + Math.floor(rng.next() * 28)));
    const profile = await saveProfile(prisma, user.id, { displayName: name, birthDate, gender, seeking }, { now });
    if (!profile.ok) throw new Error(`demo profile for ${name} was refused: ${profile.problems.join(' ')}`);

    const answers: Record<string, number | string> = {};
    const desires: Record<string, { target: number; weight: number }> = {};
    for (const question of questionnaire.questions) {
      if (question.kind === 'SCALE') {
        answers[question.key] = round2(0.1 + 0.8 * rng.next());
        // Most people care about two or three traits, some more than others.
        if (question.traitKey !== null && rng.next() < 0.5) {
          desires[question.traitKey] = { target: round2(0.15 + 0.7 * rng.next()), weight: rng.next() < 0.6 ? 0.5 : 1 };
        }
      } else if (question.kind === 'SINGLE_CHOICE') {
        const choices = (question.options as { choices?: string[] } | null)?.choices ?? [];
        if (choices.length > 0) answers[question.key] = pick(rng, choices);
      }
    }
    const saved = await saveAnswers(prisma, user.id, answers, { now });
    if (!saved.ok) throw new Error(`demo answers for ${name} were refused`);
    if (Object.keys(desires).length > 0) await saveDesires(prisma, user.id, desires);
  }

  return { created: count, mix };
}

/** Delete every demo account (and, by cascade, their profiles, rounds entries and messages). */
export async function clearDemoPopulation(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.user.deleteMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } });
  return count;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
