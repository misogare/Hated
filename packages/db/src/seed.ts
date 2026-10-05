/**
 * `prisma db seed` entry point.
 *
 * Idempotent: every write is an upsert keyed on the schema's unique columns, so
 * re-running converges on the same rows instead of duplicating them.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from './generated/prisma/client.js';
import { createPrismaClient } from './index.js';
import { SEED_INSTITUTIONS, SEED_QUESTIONNAIRE, SEED_QUESTIONS } from './seed-data.js';

export interface SeedSummary {
  institutions: number;
  questions: number;
}

/**
 * Upsert the starter data. Accepts a client so callers can pass one already
 * bound to a transaction or a test double.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<SeedSummary> {
  await seedInstitutions(prisma);
  const questionnaire = await seedQuestionnaire(prisma);
  await seedQuestions(prisma, questionnaire.id);

  return { institutions: SEED_INSTITUTIONS.length, questions: SEED_QUESTIONS.length };
}

async function seedInstitutions(prisma: PrismaClient): Promise<void> {
  for (const institution of SEED_INSTITUTIONS) {
    await prisma.institution.upsert({
      where: { domain: institution.domain },
      create: {
        domain: institution.domain,
        name: institution.name,
        type: institution.type,
      },
      update: { name: institution.name, type: institution.type, isActive: true },
    });
  }
}

async function seedQuestionnaire(prisma: PrismaClient): Promise<{ id: string }> {
  return prisma.questionnaire.upsert({
    where: {
      key_version: { key: SEED_QUESTIONNAIRE.key, version: SEED_QUESTIONNAIRE.version },
    },
    create: {
      key: SEED_QUESTIONNAIRE.key,
      version: SEED_QUESTIONNAIRE.version,
      title: SEED_QUESTIONNAIRE.title,
      description: SEED_QUESTIONNAIRE.description,
      isActive: true,
    },
    update: {
      title: SEED_QUESTIONNAIRE.title,
      description: SEED_QUESTIONNAIRE.description,
      isActive: true,
    },
    select: { id: true },
  });
}

async function seedQuestions(prisma: PrismaClient, questionnaireId: string): Promise<void> {
  for (const [position, question] of SEED_QUESTIONS.entries()) {
    const fields = {
      prompt: question.prompt,
      kind: question.kind,
      position,
      traitKey: question.traitKey ?? null,
      options: question.options,
    };

    await prisma.question.upsert({
      where: { questionnaireId_key: { questionnaireId, key: question.key } },
      create: { questionnaireId, key: question.key, ...fields },
      update: fields,
    });
  }
}

/** True when this module is the process entry point (i.e. not imported by a test). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const summary = await seedDatabase(prisma);
    console.log(
      `Seeded ${summary.institutions} institutions and ${summary.questions} questions.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (isMainModule()) {
  await main();
}
