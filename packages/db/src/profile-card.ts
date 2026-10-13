/**
 * What a match reads about someone, beyond their name and age: their line,
 * their prompt answers, highlights from their questionnaire and their photos.
 * Shared by the person's own account (a preview of their profile) and the
 * match view (their match's).
 */

import { describePerson } from './descriptions.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { PhotoView } from './photos.js';
import { toPromptAnswers, type PromptAnswer } from './profile-words.js';

export interface ProfileCard {
  bio: string | null;
  prompts: PromptAnswer[];
  highlights: string[];
  /** Main first. */
  photos: PhotoView[];
  /** The traits behind the highlights, for callers that compare two people. */
  traits: Record<string, number>;
}

/** The questionnaire answer that names an ideal weekend. */
const WEEKEND_QUESTION = 'weekend';

/** `approvedOnly`: the card as a match sees it, with only the photos that passed review. */
export async function profileCard(prisma: PrismaClient, profileId: string, options: { approvedOnly?: boolean } = {}): Promise<ProfileCard> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: {
      bio: true,
      prompts: { orderBy: { position: 'asc' }, select: { key: true, answer: true } },
      photos: {
        where: options.approvedOnly ? { status: 'APPROVED' } : {},
        orderBy: { position: 'asc' },
        select: { id: true, width: true, height: true },
      },
      traits: { select: { key: true, value: true } },
      responses: {
        orderBy: { submittedAt: 'desc' },
        take: 1,
        select: { answers: { where: { question: { key: WEEKEND_QUESTION } }, select: { valueText: true } } },
      },
    },
  });
  const traits = Object.fromEntries(profile.traits.map((trait) => [trait.key, trait.value]));
  const weekend = profile.responses[0]?.answers[0]?.valueText ?? null;
  return {
    bio: profile.bio,
    prompts: toPromptAnswers(profile.prompts),
    highlights: describePerson(traits, weekend),
    photos: profile.photos,
    traits,
  };
}
