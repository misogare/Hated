/**
 * The demo's world: the questionnaire and prompts the API would serve, the
 * institutions it knows, and the made-up people a visitor can be matched with.
 * Everyone here is fictional, and their photos are painted (see portraits.ts).
 */

import type { Prompt, Question } from '@hated/api/contract';

/** The seeded FirstDate questionnaire (packages/db/src/seed-data.ts). */
export const QUESTIONNAIRE = { id: 'firstdate-2026', title: 'FirstDate' } as const;

export const QUESTIONS: Question[] = [
  { key: 'values', prompt: 'How much do shared values shape your day-to-day life?', kind: 'SCALE', traitKey: 'values', options: { min: 0, max: 1 } },
  {
    key: 'lifestyle',
    prompt: 'How would you describe your social energy?',
    kind: 'SCALE',
    traitKey: 'lifestyle',
    options: { min: 0, max: 1, left: 'homebody', right: 'always out' },
  },
  {
    key: 'ambition',
    prompt: 'How driven are you about career or craft?',
    kind: 'SCALE',
    traitKey: 'ambition',
    options: { min: 0, max: 1, left: 'easygoing', right: 'very driven' },
  },
  { key: 'humor', prompt: 'How much do you lead with humor?', kind: 'SCALE', traitKey: 'humor', options: { min: 0, max: 1 } },
  { key: 'openness', prompt: 'How open are you to new experiences?', kind: 'SCALE', traitKey: 'openness', options: { min: 0, max: 1 } },
  {
    key: 'weekend',
    prompt: 'What does an ideal weekend look like?',
    kind: 'SINGLE_CHOICE',
    traitKey: null,
    options: { choices: ['outdoors', 'culture', 'quiet', 'social'] },
  },
];

/** The prompts a profile can answer (packages/db/src/profile-words.ts). */
export const PROMPTS: Prompt[] = [
  { key: 'perfect-sunday', label: 'A perfect Sunday' },
  { key: 'weirdly-good-at', label: "I'm weirdly good at" },
  { key: 'win-me-over', label: 'The way to win me over' },
  { key: 'green-flag', label: 'A green flag I look for' },
  { key: 'obsessed-with', label: 'Currently obsessed with' },
  { key: 'first-date', label: 'An ideal first date' },
  { key: 'hate-about-apps', label: 'What I hate about dating apps' },
];

/** Some of the institutions the API verifies, by email domain. Any other address is the demo's own. */
const INSTITUTIONS: Record<string, string> = {
  'harvard.edu': 'Harvard University',
  'mit.edu': 'Massachusetts Institute of Technology',
  'stanford.edu': 'Stanford University',
  'berkeley.edu': 'University of California, Berkeley',
  'vu.edu.au': 'Victoria University',
  'nasa.gov': 'National Aeronautics and Space Administration',
  'nih.gov': 'National Institutes of Health',
  'cdc.gov': 'Centers for Disease Control and Prevention',
};

/** The institution an address belongs to: its domain or any parent of it, as the API checks. */
export function institutionFor(email: string): { name: string; domain: string } {
  const host = email.slice(email.lastIndexOf('@') + 1);
  const parts = host.split('.');
  for (let index = 0; index < parts.length - 1; index += 1) {
    const domain = parts.slice(index).join('.');
    const name = INSTITUTIONS[domain];
    if (name !== undefined) return { name, domain };
  }
  return { name: 'Demo University', domain: host };
}

/** How a portrait is painted: the person's look, the same in each of their photos. */
export interface Look {
  skin: string;
  hair: string;
  longHair: boolean;
  top: string;
  backdrop: readonly [string, string];
}

export interface Person {
  id: string;
  displayName: string;
  age: number;
  gender: 'woman' | 'man' | 'nonbinary';
  institution: string;
  bio: string;
  prompts: { key: string; answer: string }[];
  /** Their questionnaire, by trait, in [0, 1]. */
  traits: Record<string, number>;
  weekend: string;
  look: Look;
  photoCount: 2 | 3;
  /** What they write back once the two are talking, one line per message from the visitor. */
  replies: string[];
}

export const PEOPLE: readonly Person[] = [
  {
    id: 'maya',
    displayName: 'Maya',
    age: 26,
    gender: 'woman',
    institution: 'Victoria University',
    bio: 'Will trade you a sourdough starter for a good book recommendation.',
    prompts: [
      { key: 'perfect-sunday', answer: "Farmers market at nine, a long lunch, then a film I've already seen twice." },
      { key: 'weirdly-good-at', answer: 'Guessing the ending of any detective show by the second episode.' },
    ],
    traits: { values: 0.7, lifestyle: 0.45, ambition: 0.6, humor: 0.85, openness: 0.7 },
    weekend: 'culture',
    look: { skin: '#C98D66', hair: '#21160F', longHair: true, top: '#B83A5E', backdrop: ['#D9A089', '#B97A63'] },
    photoCount: 3,
    replies: [
      'Hi! Glad you said hello. I was oddly nervous breaking that seal.',
      "Okay, important question first: what's the last book you couldn't put down?",
      'Good answer. Coffee this week? I know a place with terrible chairs and perfect croissants.',
    ],
  },
  {
    id: 'theo',
    displayName: 'Theo',
    age: 27,
    gender: 'man',
    institution: 'Massachusetts Institute of Technology',
    bio: 'Builds tiny robots by day and burns pancakes by night. Learning to sail, badly.',
    prompts: [
      { key: 'obsessed-with', answer: 'Restoring a 1970s film camera. Three rolls in, one decent photo.' },
      { key: 'first-date', answer: 'A walk somewhere with a view, then whichever food truck has the longest line.' },
    ],
    traits: { values: 0.55, lifestyle: 0.6, ambition: 0.8, humor: 0.75, openness: 0.85 },
    weekend: 'outdoors',
    look: { skin: '#E3B08C', hair: '#5A3A22', longHair: false, top: '#2F4858', backdrop: ['#8FA3A0', '#6E8480'] },
    photoCount: 3,
    replies: [
      "Hey! I'm glad the envelope picked you. Hello properly this time.",
      "I have to know: what's something you're weirdly proud of?",
      "Ha, that's great. Want to get dumplings and argue about the best view in town?",
    ],
  },
  {
    id: 'ines',
    displayName: 'Inés',
    age: 28,
    gender: 'woman',
    institution: 'Stanford University',
    bio: "Marine biologist. I will tell you an octopus fact you didn't ask for.",
    prompts: [
      { key: 'green-flag', answer: 'Asks a follow-up question and actually listens to the answer.' },
      { key: 'hate-about-apps', answer: 'Forty half-conversations at once. One good one beats all of them.' },
    ],
    traits: { values: 0.8, lifestyle: 0.3, ambition: 0.7, humor: 0.6, openness: 0.75 },
    weekend: 'outdoors',
    look: { skin: '#A9704D', hair: '#3B2418', longHair: true, top: '#E8A33D', backdrop: ['#7E8FB0', '#5D6D8E'] },
    photoCount: 2,
    replies: [
      'Hello! I was hoping you would open that envelope.',
      'Octopus fact, as promised: they have three hearts. Your turn, tell me something true.',
      "Okay, you win this round. The aquarium does late nights on Thursdays, if you're curious.",
    ],
  },
  {
    id: 'daniel',
    displayName: 'Daniel',
    age: 29,
    gender: 'man',
    institution: 'National Aeronautics and Space Administration',
    bio: 'Flight software engineer. Weekends are for climbing, curry and terrible puns.',
    prompts: [
      { key: 'weirdly-good-at', answer: 'Parallel parking on the first try, every time. Witnesses available.' },
      { key: 'win-me-over', answer: "Recommend me a song I've never heard and be right about it." },
    ],
    traits: { values: 0.6, lifestyle: 0.5, ambition: 0.85, humor: 0.9, openness: 0.6 },
    weekend: 'outdoors',
    look: { skin: '#7F4D34', hair: '#1E1A1A', longHair: false, top: '#5E7D5A', backdrop: ['#C9B27C', '#A88F5A'] },
    photoCount: 2,
    replies: [
      'Hello! Houston, we have a match.',
      "Sorry, I had to. So what's the song I've never heard?",
      "Adding it to the queue. Climbing gym on Saturday? I'll bring snacks and fewer puns.",
    ],
  },
  {
    id: 'priya',
    displayName: 'Priya',
    age: 25,
    gender: 'woman',
    institution: 'University of California, Berkeley',
    bio: 'Urban planning PhD, so yes, I have opinions about your bike lanes.',
    prompts: [
      { key: 'perfect-sunday', answer: "Long run, longer brunch, then a nap I'll pretend wasn't planned." },
      { key: 'green-flag', answer: "Is kind to waiters and remembers their friends' birthdays." },
    ],
    traits: { values: 0.65, lifestyle: 0.7, ambition: 0.75, humor: 0.7, openness: 0.65 },
    weekend: 'social',
    look: { skin: '#C98D66', hair: '#21160F', longHair: true, top: '#7E8FB0', backdrop: ['#D4886A', '#AD6A4F'] },
    photoCount: 3,
    replies: [
      'Hi! Okay, this is much nicer than swiping.',
      'Tell me your favourite street in the city and why. I promise not to lecture.',
      "That's a good one. Brunch on Sunday? I'll leave the run out of it.",
    ],
  },
  {
    id: 'kenji',
    displayName: 'Kenji',
    age: 26,
    gender: 'man',
    institution: 'Victoria University',
    bio: 'Nurse on night shifts, so I know every bakery in the city that opens at 5 am.',
    prompts: [
      { key: 'obsessed-with', answer: 'Perfecting a ramen broth. Batch eleven is almost there.' },
      { key: 'first-date', answer: 'Cheap dumplings, then a walk with nowhere in particular to be.' },
    ],
    traits: { values: 0.7, lifestyle: 0.35, ambition: 0.5, humor: 0.65, openness: 0.55 },
    weekend: 'quiet',
    look: { skin: '#F1C7A5', hair: '#21160F', longHair: false, top: '#3A1E2A', backdrop: ['#B58DA0', '#8F6A7C'] },
    photoCount: 2,
    replies: [
      'Hello! Just finished a shift, so this is a very good surprise.',
      "What's your comfort food? Mine's obviously ramen.",
      "Noted. Batch twelve is this weekend if you're brave enough to taste-test.",
    ],
  },
  {
    id: 'robin',
    displayName: 'Robin',
    age: 24,
    gender: 'nonbinary',
    institution: 'Harvard University',
    bio: 'Studying music and maths, mostly where they overlap. Plays cello badly in public.',
    prompts: [
      { key: 'win-me-over', answer: 'Bring snacks to a museum and an opinion about the art.' },
      { key: 'perfect-sunday', answer: 'Records on, pancakes going, and a crossword we will not finish.' },
    ],
    traits: { values: 0.75, lifestyle: 0.4, ambition: 0.55, humor: 0.8, openness: 0.9 },
    weekend: 'culture',
    look: { skin: '#E3B08C', hair: '#B9874E', longHair: true, top: '#F2C4B3', backdrop: ['#E8D5C4', '#C9B29C'] },
    photoCount: 3,
    replies: [
      'Hello hello! The circles meeting thing got me a little.',
      "Museum question: what's a painting you'd steal, hypothetically?",
      'Excellent taste. Snacks and the gallery on Saturday?',
    ],
  },
  {
    id: 'sasha',
    displayName: 'Sasha',
    age: 27,
    gender: 'nonbinary',
    institution: 'National Institutes of Health',
    bio: "Lab by day, garden by evening. My tomatoes have names and I won't apologise.",
    prompts: [
      { key: 'green-flag', answer: 'Gets excited about something niche and explains it with their hands.' },
      { key: 'hate-about-apps', answer: "The swiping. It's a person, not a deck of cards." },
    ],
    traits: { values: 0.85, lifestyle: 0.3, ambition: 0.6, humor: 0.55, openness: 0.7 },
    weekend: 'quiet',
    look: { skin: '#5C3626', hair: '#1E1A1A', longHair: true, top: '#5E7D5A', backdrop: ['#C9B27C', '#A88F5A'] },
    photoCount: 2,
    replies: [
      "Hi! I'm glad we both said hello.",
      "Tell me about something niche you love. I'll listen properly.",
      'I love that. Come meet the tomatoes sometime? They are very well behaved.',
    ],
  },
];

export const PEOPLE_BY_ID: ReadonlyMap<string, Person> = new Map(PEOPLE.map((person) => [person.id, person]));
