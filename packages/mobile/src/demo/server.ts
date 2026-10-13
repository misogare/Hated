/**
 * The demo's stand-in for the API, running in the browser. The web build for
 * GitHub Pages sets EXPO_PUBLIC_DEMO=1, and the app then talks to this instead
 * of a server: one account, kept in this browser's localStorage, matched with
 * the made-up people in people.ts, who play their part (they say hello back
 * and answer in the chat). Rounds are weekly, so home can skip ahead to the
 * next one.
 *
 * It answers with the API's own shapes and errors (contract.ts), so every
 * screen works unchanged.
 */

import type * as Api from '@hated/api/contract';

import { ApiError, type ApiClient, type ClientOptions, type PhotoSource } from '@/api/client';

import { keepPhoto } from './images';
import { PEOPLE, PEOPLE_BY_ID, PROMPTS, QUESTIONNAIRE, QUESTIONS, institutionFor, type Person } from './people';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, lookFor, portrait } from './portraits';
import { describePerson, explainMatch, suggestOpeners } from './words';

/** The code every sign-in takes: no email is sent. */
export const DEMO_CODE = '123456';

const STORAGE_KEY = 'hated.demo';
const SESSION_TOKEN = 'demo-session';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HELLO_WINDOW_MS = DAY_MS;
/** How long a match who says hello back takes to do it. */
const HELLO_BACK_MS = 4500;
const MAX_PHOTOS = 6;
const MAX_TRIES = 5;

/**
 * When the other person says hello: before the visitor does, a few seconds
 * after, or not at all (their match then closes when its 24 hours are up).
 * The first matches take turns, so a visitor sees each way it can go.
 */
type Hello = 'first' | 'after' | 'never';
const HELLOS: readonly Hello[] = ['after', 'first', 'never'];

interface OwnPhoto {
  id: string;
  width: number;
  height: number;
  full: string;
  blurred: string;
}

interface Message {
  id: string;
  body: string;
  sentAt: string;
  mine: boolean;
  read: boolean;
}

interface DemoMatch {
  id: string;
  roundId: string;
  partnerId: string;
  hello: Hello;
  saidHello: boolean;
  partnerSaidHello: boolean;
  passed: boolean;
  messages: Message[];
}

interface Round {
  id: string;
  publishedAt: string;
  /** Null: the visitor was in the round but nobody new fitted. */
  matchId: string | null;
}

interface Account {
  email: string;
  institution: { name: string; domain: string };
  profile: { displayName: string; birthDate: string; gender: string; seeking: string[]; isActive: boolean } | null;
  bio: string | null;
  prompts: { key: string; answer: string }[];
  answers: Record<string, Api.AnswerValue>;
  desires: Record<string, Api.Desire>;
  photos: OwnPhoto[];
  notifications: Api.NotificationPrefs;
  rounds: Round[];
  matches: DemoMatch[];
  /** The last number used in an id. */
  counter: number;
}

interface Stored {
  version: 1;
  account: Account | null;
}

function load(): Account | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    if (stored?.version !== 1) return null;
    // Saved before reminders existed: they're on, as for everyone.
    if (stored.account !== null) (stored.account.notifications as Partial<Api.NotificationPrefs>).reminders ??= true;
    return stored.account;
  } catch {
    return null;
  }
}

let account: Account | null = load();

function save(): void {
  try {
    if (account === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, account } satisfies Stored));
  } catch {
    // Full or blocked storage: the demo carries on in memory until the page reloads.
  }
}

function nextId(prefix: string): string {
  if (account === null) return `${prefix}-0`;
  account.counter += 1;
  return `${prefix}-${account.counter}`;
}

const listeners = new Set<(event: Api.LiveEvent) => void>();

/** Say what changed, as the live connection would, a moment after the change. */
function emit(event: Api.LiveEvent): void {
  setTimeout(() => {
    for (const listener of listeners) listener(event);
  }, 0);
}

/** Whatever has been asked of the demo, it waits a moment, like a request would. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 120));
}

function fail(status: number, error: string, extra: Omit<Api.ApiError, 'error'> = {}): never {
  throw new ApiError(status, error, { error, ...extra });
}

// --- Reading the account the way the API shows it ----------------------------

const SCALE_KEYS = QUESTIONS.filter((question) => question.kind === 'SCALE' && question.traitKey !== null).map((question) => question.traitKey!);
const PROMPT_LABELS: ReadonlyMap<string, string> = new Map(PROMPTS.map((prompt) => [prompt.key, prompt.label]));
const GENDERS = new Set(['woman', 'man', 'nonbinary', 'another']);
const SEEKABLE = new Set(['woman', 'man', 'nonbinary']);
const REPORT_REASONS = new Set(['harassment', 'inappropriate', 'spam', 'unsafe', 'other']);

function traitsOf(answers: Readonly<Record<string, Api.AnswerValue>>): Record<string, number> {
  return Object.fromEntries(SCALE_KEYS.flatMap((key) => (typeof answers[key] === 'number' ? [[key, answers[key]]] : [])));
}

function weekendOf(answers: Readonly<Record<string, Api.AnswerValue>>): string | null {
  return typeof answers.weekend === 'string' ? answers.weekend : null;
}

function labelled(prompts: readonly { key: string; answer: string }[]): Api.PromptAnswer[] {
  return prompts.map(({ key, answer }) => ({ key, label: PROMPT_LABELS.get(key) ?? key, answer }));
}

/** Whole years since a `YYYY-MM-DD` birthday, by calendar date. */
function ageOn(birthDate: string, now = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number];
  const before = now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day);
  return now.getFullYear() - year - (before ? 1 : 0);
}

function viewAccount(own: Account): Api.Account {
  return {
    userId: 'demo',
    email: own.email,
    emailVerified: true,
    institution: own.institution,
    profile:
      own.profile === null
        ? null
        : {
            ...own.profile,
            age: ageOn(own.profile.birthDate),
            bio: own.bio,
            prompts: labelled(own.prompts),
            highlights: describePerson(traitsOf(own.answers), weekendOf(own.answers)),
          },
    photos: own.photos.map(({ id, width, height }) => ({ id, width, height })),
    onboarding: { profile: own.profile !== null, answers: Object.keys(own.answers).length > 0, photos: own.photos.length >= 2 },
    notifications: { ...own.notifications },
  };
}

function roundOf(own: Account, match: DemoMatch): Round {
  return own.rounds.find((round) => round.id === match.roundId)!;
}

function personOf(match: DemoMatch): Person {
  return PEOPLE_BY_ID.get(match.partnerId)!;
}

function photosOf(person: Person): Api.Photo[] {
  return Array.from({ length: person.photoCount }, (_, index) => ({ id: `${person.id}-${index}`, width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT }));
}

function mutualOf(match: DemoMatch): boolean {
  return match.saidHello && match.partnerSaidHello;
}

function deadlineOf(own: Account, match: DemoMatch): number {
  return Date.parse(roundOf(own, match).publishedAt) + HELLO_WINDOW_MS;
}

function expiredOf(own: Account, match: DemoMatch): boolean {
  return !mutualOf(match) && Date.now() > deadlineOf(own, match);
}

function unreadOf(match: DemoMatch): number {
  return match.messages.filter((message) => !message.mine && !message.read).length;
}

function viewMatch(own: Account, match: DemoMatch): Api.Match {
  const person = personOf(match);
  const traits = traitsOf(own.answers);
  const mutual = mutualOf(match);
  return {
    matchId: match.id,
    partner: {
      displayName: person.displayName,
      age: person.age,
      institution: person.institution,
      bio: person.bio,
      prompts: labelled(person.prompts),
      highlights: describePerson(person.traits, person.weekend),
      photos: match.passed ? [] : photosOf(person),
    },
    photosUnlocked: mutual && !match.passed,
    reasons: explainMatch(traits, own.desires, person.traits),
    openers: suggestOpeners(person.prompts, traits, person.traits),
    helloDeadline: new Date(deadlineOf(own, match)).toISOString(),
    expired: expiredOf(own, match),
    saidHello: match.saidHello,
    mutual,
    passed: match.passed,
    unread: unreadOf(match),
  };
}

function summarize(own: Account, match: DemoMatch): Api.MatchSummary {
  const person = personOf(match);
  const last = match.messages.at(-1);
  return {
    matchId: match.id,
    roundId: match.roundId,
    publishedAt: roundOf(own, match).publishedAt,
    partner: { displayName: person.displayName, age: person.age, institution: person.institution, photo: match.passed ? null : photosOf(person)[0]! },
    saidHello: match.saidHello,
    mutual: mutualOf(match),
    passed: match.passed,
    photosUnlocked: mutualOf(match) && !match.passed,
    helloDeadline: new Date(deadlineOf(own, match)).toISOString(),
    expired: expiredOf(own, match),
    lastMessage: last === undefined ? null : { body: last.body, sentAt: last.sentAt, mine: last.mine },
    unread: unreadOf(match),
  };
}

/** Rounds close on Sundays at 8 pm, in the visitor's own time zone. */
function nextRoundAt(now = new Date()): Date {
  const next = new Date(now);
  next.setHours(20, 0, 0, 0);
  next.setDate(next.getDate() + ((7 - next.getDay()) % 7));
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

// --- What the made-up people do ---------------------------------------------

/** Replies on their way, by match, so quick messages get answered in order. */
const replying = new Map<string, number>();

function findMatch(matchId: string): DemoMatch | undefined {
  return account?.matches.find((match) => match.id === matchId);
}

function helloBack(matchId: string, delayMs: number): void {
  setTimeout(() => {
    const match = findMatch(matchId);
    if (match === undefined || match.passed || match.partnerSaidHello) return;
    match.partnerSaidHello = true;
    save();
    emit({ type: 'mutual', matchId });
  }, delayMs);
}

function reply(matchId: string): void {
  const match = findMatch(matchId);
  if (match === undefined) return;
  const person = personOf(match);
  const pending = replying.get(matchId) ?? 0;
  const line = person.replies[match.messages.filter((message) => !message.mine).length + pending];
  if (line === undefined) return;
  replying.set(matchId, pending + 1);
  const delay = 1600 + Math.random() * 1400 + pending * 2200;
  // They're seen typing for a moment before the message lands.
  setTimeout(() => emit({ type: 'typing', matchId }), Math.max(0, delay - 1800));
  setTimeout(
    () => {
      replying.set(matchId, (replying.get(matchId) ?? 1) - 1);
      const current = findMatch(matchId);
      if (current === undefined || current.passed) return;
      current.messages.push({ id: nextId('message'), body: line, sentAt: new Date().toISOString(), mine: false, read: false });
      save();
      emit({ type: 'message', matchId });
    },
    delay,
  );
}

/** After a reload, a hello back that was on its way still arrives. */
for (const match of account?.matches ?? []) {
  if (match.hello === 'after' && match.saidHello && !match.partnerSaidHello && !match.passed) helloBack(match.id, 1500);
}

function newAccount(email: string): Account {
  const look = lookFor(email);
  return {
    email,
    institution: institutionFor(email),
    profile: null,
    bio: null,
    prompts: [],
    answers: {},
    desires: {},
    // Two painted photos to start with, so nobody has to upload their own to try it.
    photos: [0, 1].map((index) => ({
      id: `photo-${index + 1}`,
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      full: portrait(look, index, email, 'full'),
      blurred: portrait(look, index, email, 'blurred'),
    })),
    notifications: { messages: true, hellos: true, rounds: true, reminders: true },
    rounds: [],
    matches: [],
    counter: 2,
  };
}

/**
 * A week goes by and the next round closes: everything so far moves a week
 * into the past (so a match nobody said hello to in time closes), and the
 * visitor, if taking part, is matched with someone new who fits who they're
 * open to meeting.
 */
async function skipToNextRound(): Promise<void> {
  await pause();
  const own = account;
  if (own === null || own.profile === null) return;
  const back = (iso: string) => new Date(Date.parse(iso) - WEEK_MS).toISOString();
  for (const round of own.rounds) round.publishedAt = back(round.publishedAt);
  for (const match of own.matches) for (const message of match.messages) message.sentAt = back(message.sentAt);

  const roundId = nextId('round');
  if (own.profile.isActive) {
    const met = new Set(own.matches.map((match) => match.partnerId));
    const seeking = own.profile.seeking;
    const partner = PEOPLE.find((person) => !met.has(person.id) && (seeking.length === 0 || seeking.includes(person.gender)));
    let matchId: string | null = null;
    if (partner !== undefined) {
      const hello = HELLOS[own.matches.length] ?? 'after';
      matchId = nextId('match');
      own.matches.push({ id: matchId, roundId, partnerId: partner.id, hello, saidHello: false, partnerSaidHello: hello === 'first', passed: false, messages: [] });
    }
    own.rounds.push({ id: roundId, publishedAt: new Date().toISOString(), matchId });
  }
  save();
  emit({ type: 'round', roundId });
}

// --- The client the app uses -------------------------------------------------

let verification: { id: string; email: string; tries: number } | null = null;

/** An `ApiClient` backed by the demo, for the session to use in place of the API. */
export function createDemoClient(options: ClientOptions): ApiClient {
  /** The signed-in account, or a 401 as the API would answer (which signs this device out). */
  function signedIn(): Account {
    const token = options.token();
    if (token === SESSION_TOKEN && account !== null) return account;
    if (token !== null) options.onUnauthorized();
    return fail(401, 'unauthorized');
  }

  async function ownMatch(matchId: string): Promise<{ own: Account; match: DemoMatch }> {
    await pause();
    const own = signedIn();
    const match = own.matches.find((candidate) => candidate.id === matchId);
    return match === undefined ? fail(404, 'not-found') : { own, match };
  }

  /** A conversation can be read and written once both said hello, until someone passes. */
  async function openConversation(matchId: string): Promise<DemoMatch> {
    const { match } = await ownMatch(matchId);
    if (match.passed) fail(409, 'passed');
    if (!mutualOf(match)) fail(403, 'not-mutual');
    return match;
  }

  return {
    async sendCode(email) {
      await pause();
      const normalized = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(normalized)) fail(422, 'invalid', { problems: ['Enter your whole email address.'] });
      verification = { id: `verification-${Date.now()}`, email: normalized, tries: 0 };
      return { verificationId: verification.id, email: normalized, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    },

    async verifyCode(verificationId, code) {
      await pause();
      const pending = verification;
      if (pending === null || pending.id !== verificationId) return fail(400, 'expired');
      if (code !== DEMO_CODE) {
        pending.tries += 1;
        if (pending.tries >= MAX_TRIES) {
          verification = null;
          fail(400, 'too-many-attempts');
        }
        fail(401, 'invalid-code', { attemptsRemaining: MAX_TRIES - pending.tries });
      }
      verification = null;
      // The same address picks up where it left off; another one starts afresh.
      if (account?.email !== pending.email) account = newAccount(pending.email);
      save();
      return { token: SESSION_TOKEN, expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() };
    },

    async signOut() {
      await pause();
    },

    async registerPushToken() {
      await pause();
    },

    async me() {
      await pause();
      return viewAccount(signedIn());
    },

    async deleteAccount() {
      await pause();
      signedIn();
      account = null;
      save();
    },

    async exportData() {
      await pause();
      const own = signedIn();
      const data: Api.DataExport & Record<string, unknown> = {
        format: 'hated-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        about: "Everything this HateD demo holds about you. It lives only in this browser's storage.",
        account: viewAccount(own),
        answers: own.answers,
        desires: own.desires,
        matches: own.matches.map((match) => ({ ...summarize(own, match), messages: match.messages.map(({ id, body, sentAt, mine }) => ({ id, body, sentAt, mine })) })),
      };
      return data;
    },

    async setNotifications(changes) {
      await pause();
      const own = signedIn();
      own.notifications = { ...own.notifications, ...changes };
      save();
      return { ...own.notifications };
    },

    async saveProfile(profile) {
      await pause();
      const own = signedIn();
      const problems: string[] = [];
      const displayName = profile.displayName.trim();
      if (displayName.length === 0) problems.push('Add your first name.');
      else if (displayName.length > 40) problems.push('Keep your name under 40 characters.');
      const date = new Date(`${profile.birthDate}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== profile.birthDate) problems.push('Add your birthday.');
      else if (ageOn(profile.birthDate) < 18) problems.push('You need to be 18 or over to use HateD.');
      else if (ageOn(profile.birthDate) > 120) problems.push('Check your birthday.');
      if (!GENDERS.has(profile.gender)) problems.push('Choose how you identify.');
      if (profile.seeking.some((id) => !SEEKABLE.has(id))) problems.push('Choose who you are open to meeting.');
      if (problems.length > 0) fail(422, 'invalid', { problems });
      own.profile = { displayName, birthDate: profile.birthDate, gender: profile.gender, seeking: [...profile.seeking], isActive: own.profile?.isActive ?? true };
      save();
      return viewAccount(own);
    },

    async setActive(active) {
      await pause();
      const own = signedIn();
      if (own.profile === null) fail(422, 'invalid', { problems: ['Finish your profile first.'] });
      own.profile.isActive = active;
      save();
      return { active };
    },

    async questionnaire() {
      await pause();
      signedIn();
      return { id: QUESTIONNAIRE.id, title: QUESTIONNAIRE.title, questions: QUESTIONS };
    },

    async answers() {
      await pause();
      return { answers: { ...signedIn().answers } };
    },

    async saveAnswers(answers) {
      await pause();
      const own = signedIn();
      for (const [key, value] of Object.entries(answers)) {
        if (!QUESTIONS.some((question) => question.key === key)) fail(422, 'invalid', { problems: [`Unknown question "${key}".`] });
        if (value === null) delete own.answers[key];
        else own.answers[key] = value;
      }
      save();
    },

    async desires() {
      await pause();
      return { desires: { ...signedIn().desires } };
    },

    async saveDesires(desires) {
      await pause();
      const own = signedIn();
      for (const [key, desire] of Object.entries(desires)) {
        if (!SCALE_KEYS.includes(key)) fail(422, 'invalid', { problems: [`Unknown trait "${key}".`] });
        if ([desire.target, desire.weight].some((value) => !(value >= 0 && value <= 1))) {
          fail(422, 'invalid', { problems: [`${key}: target and weight must be between 0 and 1.`] });
        }
        own.desires[key] = { target: desire.target, weight: desire.weight };
      }
      save();
    },

    async home() {
      await pause();
      const own = signedIn();
      const latest = own.rounds.at(-1);
      const match = latest === undefined || latest.matchId === null ? undefined : findMatch(latest.matchId);
      const result: Api.RoundResult =
        latest === undefined
          ? { status: 'none' }
          : match === undefined
            ? { status: 'unmatched', roundId: latest.id, publishedAt: latest.publishedAt, reason: 'no-eligible-candidates' }
            : { status: 'matched', roundId: latest.id, publishedAt: latest.publishedAt, match: viewMatch(own, match) };
      return {
        nextRoundAt: nextRoundAt().toISOString(),
        isActive: own.profile?.isActive ?? false,
        result,
        unreadTotal: own.matches.reduce((total, candidate) => total + unreadOf(candidate), 0),
        feedbackDue: null,
      };
    },

    async sayHello(matchId) {
      const { match, own } = await ownMatch(matchId);
      if (match.passed) fail(409, 'passed');
      if (expiredOf(own, match)) fail(409, 'expired');
      if (!match.saidHello) {
        match.saidHello = true;
        if (match.hello === 'after' && !match.partnerSaidHello) helloBack(match.id, HELLO_BACK_MS);
        save();
      }
      return { mutual: mutualOf(match) };
    },

    async pass(matchId) {
      const { match } = await ownMatch(matchId);
      if (match.passed) fail(409, 'passed');
      match.passed = true;
      save();
    },

    async messages(matchId, after) {
      const match = await openConversation(matchId);
      for (const message of match.messages) if (!message.mine) message.read = true;
      save();
      const start = after === undefined ? 0 : match.messages.findIndex((message) => message.id === after) + 1;
      return { messages: match.messages.slice(start).map(({ id, body, sentAt, mine }) => ({ id, body, sentAt, mine })) };
    },

    async sendMessage(matchId, body) {
      const match = await openConversation(matchId);
      const text = body.trim();
      if (text.length === 0) fail(422, 'invalid', { problems: ['Write something first.'] });
      if (text.length > 2000) fail(422, 'invalid', { problems: ['Keep it under 2,000 characters.'] });
      const message: Message = { id: nextId('message'), body: text, sentAt: new Date().toISOString(), mine: true, read: true };
      match.messages.push(message);
      save();
      reply(match.id);
      return { message: { id: message.id, body: message.body, sentAt: message.sentAt, mine: true } };
    },

    async typing(matchId) {
      await openConversation(matchId);
    },

    async matches() {
      await pause();
      const own = signedIn();
      return { matches: [...own.matches].reverse().map((match) => summarize(own, match)) };
    },

    async report(matchId, report) {
      const { match } = await ownMatch(matchId);
      if (!REPORT_REASONS.has(report.reason)) fail(422, 'invalid', { problems: ['Choose a reason.'] });
      match.passed = true;
      save();
    },

    async match(matchId) {
      const { own, match } = await ownMatch(matchId);
      const round = roundOf(own, match);
      return { roundId: round.id, publishedAt: round.publishedAt, match: viewMatch(own, match) };
    },

    async uploadPhoto(uri) {
      await pause();
      const own = signedIn();
      if (own.photos.length >= MAX_PHOTOS) fail(422, 'too-many', { problems: [`You can have up to ${MAX_PHOTOS} photos.`] });
      const kept = await keepPhoto(uri).catch(() => fail(422, 'invalid', { problems: ["That file couldn't be read as a photo."] }));
      own.photos.push({ id: nextId('photo'), ...kept });
      save();
      return { photos: viewAccount(own).photos };
    },

    async deletePhoto(photoId) {
      await pause();
      const own = signedIn();
      if (!own.photos.some((photo) => photo.id === photoId)) fail(404, 'not-found');
      own.photos = own.photos.filter((photo) => photo.id !== photoId);
      save();
      return { photos: viewAccount(own).photos };
    },

    async reorderPhotos(ids) {
      await pause();
      const own = signedIn();
      const byId = new Map(own.photos.map((photo) => [photo.id, photo]));
      if (ids.length !== byId.size || ids.some((id) => !byId.has(id))) fail(422, 'invalid', { problems: ['Send every photo id once, main first.'] });
      own.photos = ids.map((id) => byId.get(id)!);
      save();
      return { photos: viewAccount(own).photos };
    },

    async saveWords(words) {
      await pause();
      const own = signedIn();
      const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
      const bio = words.bio === null || tidy(words.bio) === '' ? null : tidy(words.bio);
      const prompts = words.prompts.map(({ key, answer }) => ({ key, answer: tidy(answer) })).filter(({ answer }) => answer !== '');
      const problems: string[] = [];
      if (bio !== null && bio.length > 120) problems.push('Keep your line to 120 characters.');
      if (prompts.length > 3) problems.push('Choose up to 3 prompts.');
      if (prompts.some(({ key }) => !PROMPT_LABELS.has(key))) problems.push('Choose prompts from the list.');
      if (new Set(prompts.map(({ key }) => key)).size !== prompts.length) problems.push('Answer each prompt once.');
      if (prompts.some(({ answer }) => answer.length > 150)) problems.push('Keep each answer to 150 characters.');
      if (problems.length > 0) fail(422, 'invalid', { problems });
      own.bio = bio;
      own.prompts = prompts;
      save();
      return { bio, prompts: labelled(prompts) };
    },

    async prompts() {
      await pause();
      signedIn();
      return { prompts: PROMPTS };
    },

    photoSource(photoId, variant): PhotoSource {
      const own = account?.photos.find((photo) => photo.id === photoId);
      if (own !== undefined) return { uri: variant === 'full' ? own.full : own.blurred, headers: {}, cacheKey: `${photoId}-${variant}` };
      // A match's photo, `<person>-<index>`: in full only once both have said hello, as the API decides.
      const split = photoId.lastIndexOf('-');
      const person = PEOPLE_BY_ID.get(photoId.slice(0, split));
      const match = account?.matches.find((candidate) => candidate.partnerId === person?.id && !candidate.passed);
      if (person === undefined || match === undefined) return { uri: '', headers: {}, cacheKey: photoId };
      const shown = variant === 'full' && mutualOf(match) ? 'full' : 'blurred';
      return { uri: portrait(person.look, Number(photoId.slice(split + 1)), person.id, shown), headers: {}, cacheKey: `${photoId}-${shown}` };
    },
  };
}

/** What only the demo can do: hear its live events, and skip a week ahead to the next round. */
export const demo = {
  subscribe(listener: (event: Api.LiveEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  skipToNextRound,
};
