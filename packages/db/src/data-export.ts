/**
 * A copy of everything HateD holds about a person, as one JSON document: the
 * right of access and the right to data portability.
 *
 * Left out on purpose, and said so in the export itself:
 * - Other people's data: their names, their messages, and anything they said
 *   about this person (reports). A conversation export carries only what this
 *   person wrote; the rest belongs to the other person.
 * - Secrets: session tokens and sign-in codes are stored only as one-way
 *   hashes, which identify nothing and would only help an attacker. Push
 *   tokens are left out too, since anyone holding one could notify the phone.
 */

import type { PrismaClient } from './generated/prisma/client.js';
import { toPrefs } from './notification-prefs.js';
import type { PhotoStore } from './photo-store.js';
import { photoKey } from './photos.js';
import { toPromptAnswers } from './profile-words.js';

export const EXPORT_VERSION = 1;

export interface AccountExport {
  format: 'hated-export';
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** What is in here and what is left out, in plain words. */
  about: string;
  account: {
    email: string;
    emailVerified: boolean;
    createdAt: string;
    notifications: { messages: boolean; hellos: boolean; rounds: boolean; reminders: boolean };
  };
  emailVerifications: Array<{
    email: string;
    institution: string | null;
    type: string;
    status: string;
    requestedAt: string;
    verifiedAt: string | null;
  }>;
  profile: {
    displayName: string;
    /** `YYYY-MM-DD`. */
    birthDate: string;
    gender: string;
    /** Empty means open to everyone. */
    openTo: string[];
    takingPartInRounds: boolean;
    /** Their line in their own words. */
    bio: string | null;
    prompts: Array<{ prompt: string; answer: string }>;
    createdAt: string;
    updatedAt: string;
  } | null;
  /** Main first, each as the JPEG HateD keeps (never the blurred copy), base64-encoded. */
  photos: Array<{ position: number; width: number; height: number; addedAt: string; jpegBase64: string | null }>;
  answers: Array<{ question: string; prompt: string; answer: unknown; firstAnsweredAt: string }>;
  /** What matching uses, worked out from the answers: each trait from 0 to 1. */
  traits: Record<string, number>;
  /** What they hope for in someone: the trait value aimed for, and how much it matters (0 to 1). */
  hopes: Record<string, { target: number; weight: number }>;
  rounds: Array<{ roundId: string; date: string; matched: boolean; reason: string | null }>;
  matches: Array<{
    matchId: string;
    roundDate: string;
    youSaidHelloAt: string | null;
    /** When HateD reminded them that the time to say hello was running out. */
    remindedAt: string | null;
    /** Both said hello. */
    conversationOpened: boolean;
    /** They passed on or reported this match. */
    youEndedIt: boolean;
    messagesYouSent: Array<{ sentAt: string; body: string }>;
  }>;
  reportsYouMade: Array<{ matchId: string | null; reason: string; details: string | null; madeAt: string; reviewed: boolean }>;
  signIns: Array<{ signedInAt: string; expiresAt: string; signedOutAt: string | null }>;
  notificationDevices: Array<{ platform: string; registeredAt: string }>;
}

const ABOUT =
  'Everything HateD holds about you, your photos included (as base64-encoded JPEG). Left out: other people\'s names and messages, and reports other people made ' +
  '(that is their data), and security secrets such as sign-in codes and session keys, which are stored only as ' +
  'one-way hashes, and the addresses that let us send notifications to your phone.';

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date === null ? null : date.toISOString());

/** The person's data, or null if there is no such account. */
export async function exportAccount(
  prisma: PrismaClient,
  store: PhotoStore,
  userId: string,
  options: { now?: Date } = {},
): Promise<AccountExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      verifications: { orderBy: { createdAt: 'asc' }, include: { institution: { select: { name: true } } } },
      sessions: { orderBy: { createdAt: 'asc' } },
      pushTokens: { orderBy: { createdAt: 'asc' }, select: { platform: true, createdAt: true } },
      profile: {
        include: {
          seeking: true,
          prompts: { orderBy: { position: 'asc' } },
          photos: { orderBy: { position: 'asc' } },
          traits: { orderBy: { key: 'asc' } },
          desires: { orderBy: { key: 'asc' } },
          blocksMade: { select: { blockedId: true } },
          responses: {
            include: {
              answers: { include: { question: { select: { key: true, prompt: true, position: true } } } },
            },
          },
          roundEntries: { include: { round: { select: { id: true, status: true, startedAt: true, completedAt: true } } } },
          reportsMade: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  if (user === null) return null;

  const profile = user.profile;
  const matches =
    profile === null
      ? []
      : await prisma.match.findMany({
          where: { OR: [{ profileAId: profile.id }, { profileBId: profile.id }], round: { status: 'PUBLISHED' } },
          include: {
            round: { select: { startedAt: true, completedAt: true } },
            messages: { where: { senderId: profile.id }, orderBy: { createdAt: 'asc' } },
            reminders: { where: { profileId: profile.id }, select: { sentAt: true } },
          },
          orderBy: { round: { startedAt: 'asc' } },
        });
  const photos = await Promise.all(
    (profile?.photos ?? []).map(async (photo) => ({
      position: photo.position,
      width: photo.width,
      height: photo.height,
      addedAt: iso(photo.createdAt),
      jpegBase64: (await store.get(photoKey(photo.id, 'full')))?.toString('base64') ?? null,
    })),
  );
  const roundDate = (round: { startedAt: Date; completedAt: Date | null }) => iso(round.completedAt ?? round.startedAt);
  const blocked = new Set(profile?.blocksMade.map((block) => block.blockedId) ?? []);

  return {
    format: 'hated-export',
    version: EXPORT_VERSION,
    exportedAt: iso(options.now ?? new Date()),
    about: ABOUT,
    account: {
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: iso(user.createdAt),
      notifications: toPrefs(user),
    },
    emailVerifications: user.verifications.map((verification) => ({
      email: verification.email,
      institution: verification.institution?.name ?? null,
      type: verification.type,
      status: verification.status,
      requestedAt: iso(verification.createdAt),
      verifiedAt: isoOrNull(verification.verifiedAt),
    })),
    profile:
      profile === null
        ? null
        : {
            displayName: profile.displayName,
            birthDate: iso(profile.birthDate).slice(0, 10),
            gender: profile.genderId,
            openTo: profile.seeking.map((row) => row.genderId),
            takingPartInRounds: profile.isActive,
            bio: profile.bio,
            prompts: toPromptAnswers(profile.prompts).map((prompt) => ({ prompt: prompt.label, answer: prompt.answer })),
            createdAt: iso(profile.createdAt),
            updatedAt: iso(profile.updatedAt),
          },
    photos,
    answers: (profile?.responses ?? [])
      .flatMap((response) => response.answers)
      .sort((a, b) => a.question.position - b.question.position)
      .map((answer) => ({
        question: answer.question.key,
        prompt: answer.question.prompt,
        answer: answer.valueJson ?? answer.valueNumber ?? answer.valueText,
        firstAnsweredAt: iso(answer.createdAt),
      })),
    traits: Object.fromEntries((profile?.traits ?? []).map((trait) => [trait.key, trait.value])),
    hopes: Object.fromEntries((profile?.desires ?? []).map((desire) => [desire.key, { target: desire.target, weight: desire.weight }])),
    rounds: (profile?.roundEntries ?? [])
      .filter((entry) => entry.round.status === 'PUBLISHED')
      .sort((a, b) => a.round.startedAt.getTime() - b.round.startedAt.getTime())
      .map((entry) => ({ roundId: entry.round.id, date: roundDate(entry.round), matched: entry.matched, reason: entry.unmatchedReason })),
    matches: matches.map((match) => {
      const isA = match.profileAId === profile?.id;
      const mine = isA ? match.helloAAt : match.helloBAt;
      const theirs = isA ? match.helloBAt : match.helloAAt;
      return {
        matchId: match.id,
        roundDate: roundDate(match.round),
        youSaidHelloAt: isoOrNull(mine),
        remindedAt: isoOrNull(match.reminders[0]?.sentAt ?? null),
        conversationOpened: mine !== null && theirs !== null,
        youEndedIt: blocked.has(isA ? match.profileBId : match.profileAId),
        messagesYouSent: match.messages.map((message) => ({ sentAt: iso(message.createdAt), body: message.body })),
      };
    }),
    reportsYouMade: (profile?.reportsMade ?? []).map((report) => ({
      matchId: report.matchId,
      reason: report.reason,
      details: report.details,
      madeAt: iso(report.createdAt),
      reviewed: report.resolvedAt !== null,
    })),
    signIns: user.sessions.map((session) => ({
      signedInAt: iso(session.createdAt),
      expiresAt: iso(session.expiresAt),
      signedOutAt: isoOrNull(session.revokedAt),
    })),
    notificationDevices: user.pushTokens.map((device) => ({ platform: device.platform, registeredAt: iso(device.createdAt) })),
  };
}
