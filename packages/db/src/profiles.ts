/**
 * The account and profile a person edits in the app: who they are, who they
 * are open to, and whether they are in the next round.
 *
 * Gender ids are opaque strings, as everywhere in HateD; the app decides the
 * vocabulary. An empty `seeking` list means "open to everyone", matching the
 * engine.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { toPrefs, type NotificationPrefs } from './notification-prefs.js';
import { MIN_PHOTOS, type PhotoView } from './photos.js';
import { profileCard } from './profile-card.js';
import type { PromptAnswer } from './profile-words.js';

/** Nobody under this age can hold a profile. */
export const MIN_AGE = 18;

const MAX_NAME_LENGTH = 40;
const MAX_GENDER_LENGTH = 40;
const MAX_SEEKING = 10;

export interface ProfileInput {
  displayName: string;
  /** Calendar date of birth. Only the UTC date part is used. */
  birthDate: Date;
  gender: string;
  /** Genders this person is open to; empty means everyone. */
  seeking: readonly string[];
}

export type SaveProfileResult =
  | { ok: true; profileId: string }
  | { ok: false; reason: 'invalid'; problems: string[] };

export interface AccountView {
  userId: string;
  email: string;
  emailVerified: boolean;
  /** The institution of the most recent verified address, if any. */
  institution: { name: string; domain: string } | null;
  profile: {
    displayName: string;
    /** `YYYY-MM-DD`. */
    birthDate: string;
    age: number;
    gender: string;
    seeking: string[];
    isActive: boolean;
    /** Their line in their own words. */
    bio: string | null;
    prompts: PromptAnswer[];
    /** What a match reads about them, worked out from their questionnaire. */
    highlights: string[];
  } | null;
  /** Their photos, main first. */
  photos: PhotoView[];
  /** Which onboarding steps are done, so the app knows where to resume. */
  onboarding: { profile: boolean; answers: boolean; photos: boolean };
  /** Which push notifications they want. */
  notifications: NotificationPrefs;
}

/** Whole years between a birth date and `now`, by UTC calendar date. */
export function ageOn(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Everything wrong with a profile, in words the app can show. Empty when valid. */
export function validateProfileInput(input: ProfileInput, now: Date): string[] {
  const problems: string[] = [];
  const name = input.displayName.trim();
  if (name.length === 0) problems.push('Add your first name.');
  else if (name.length > MAX_NAME_LENGTH) problems.push(`Keep your name under ${MAX_NAME_LENGTH} characters.`);

  if (Number.isNaN(input.birthDate.getTime())) {
    problems.push('Add your birthday.');
  } else {
    const age = ageOn(input.birthDate, now);
    if (age < MIN_AGE) problems.push(`You need to be ${MIN_AGE} or over to use HateD.`);
    else if (age > 120) problems.push('Check your birthday.');
  }

  const gender = input.gender.trim();
  if (gender.length === 0 || gender.length > MAX_GENDER_LENGTH) problems.push('Choose how you identify.');

  if (input.seeking.length > MAX_SEEKING || input.seeking.some((id) => id.trim().length === 0)) {
    problems.push('Choose who you are open to meeting.');
  }
  return problems;
}

/** Create or update the person's profile, replacing who they are open to. */
export async function saveProfile(
  prisma: PrismaClient,
  userId: string,
  input: ProfileInput,
  options: { now?: Date } = {},
): Promise<SaveProfileResult> {
  const problems = validateProfileInput(input, options.now ?? new Date());
  if (problems.length > 0) return { ok: false, reason: 'invalid', problems };

  const data = {
    displayName: input.displayName.trim(),
    birthDate: utcDate(input.birthDate),
    genderId: input.gender.trim(),
  };
  const seeking = [...new Set(input.seeking.map((id) => id.trim()))];

  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.profile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: { id: true },
    });
    await tx.profileSeeking.deleteMany({ where: { profileId: saved.id } });
    if (seeking.length > 0) {
      await tx.profileSeeking.createMany({
        data: seeking.map((genderId) => ({ profileId: saved.id, genderId })),
      });
    }
    return saved;
  });
  return { ok: true, profileId: profile.id };
}

/** Opt in or out of upcoming rounds. False when the person has no profile yet. */
export async function setProfileActive(prisma: PrismaClient, userId: string, isActive: boolean): Promise<boolean> {
  const { count } = await prisma.profile.updateMany({ where: { userId }, data: { isActive } });
  return count > 0;
}

/** Everything the app needs to render the signed-in person, or null if unknown. */
export async function getAccount(
  prisma: PrismaClient,
  userId: string,
  options: { now?: Date } = {},
): Promise<AccountView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: { include: { seeking: true, responses: { select: { id: true }, take: 1 } } },
      verifications: {
        where: { status: 'VERIFIED' },
        orderBy: { verifiedAt: 'desc' },
        take: 1,
        include: { institution: { select: { name: true, domain: true } } },
      },
    },
  });
  if (user === null) return null;

  const profile = user.profile;
  const institution = user.verifications[0]?.institution ?? null;
  const card = profile === null ? null : await profileCard(prisma, profile.id);
  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    institution,
    profile:
      profile === null
        ? null
        : {
            displayName: profile.displayName,
            birthDate: profile.birthDate.toISOString().slice(0, 10),
            age: ageOn(profile.birthDate, options.now ?? new Date()),
            gender: profile.genderId,
            seeking: profile.seeking.map((row) => row.genderId),
            isActive: profile.isActive,
            bio: card?.bio ?? null,
            prompts: card?.prompts ?? [],
            highlights: card?.highlights ?? [],
          },
    photos: card?.photos ?? [],
    onboarding: {
      profile: profile !== null,
      answers: (profile?.responses.length ?? 0) > 0,
      photos: (card?.photos.length ?? 0) >= MIN_PHOTOS,
    },
    notifications: toPrefs(user),
  };
}

/** Midnight UTC on the date's UTC calendar day, so a birthday never shifts by time zone. */
function utcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
