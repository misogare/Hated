# @hated/db

Persistence for HateD: a Prisma schema and a generated, type-safe client over
PostgreSQL. The matching engine itself lives in `@hated/core`; this package is
only the storage shape.

## Local setup

1. Start Postgres (from the repo root):

   ```bash
   docker compose up -d
   ```

2. Create the env file and install:

   ```bash
   cd packages/db
   cp .env.example .env
   npm install
   ```

3. Apply migrations (creates the schema):

   ```bash
   npm run migrate
   ```

4. Seed the institution allowlist and sample questionnaire:

   ```bash
   npm run seed
   ```

Other scripts: `generate` (regenerate the client), `push` (schema → DB without a
migration), `studio`, `migrate:deploy`, `round` (run one match round — see
below), `round:inspect` (read one back), `compare` (fairness objectives
side by side), `send-code` (email a verification code), `verify-code`
(redeem one), `mail:check` (test the email transport), `typecheck`.

### Seed data

`npm run seed` (via `prisma db seed` → `tsx src/seed.ts`) upserts:

- the trusted-institution allowlist (`Institution` rows for a few `.edu`/`.gov`
  domains), and
- one `FirstDate` questionnaire with a `SCALE` question per scored trait plus a
  sample choice question.

Every write is an upsert keyed on the schema's unique columns, so re-running is
idempotent. The data itself lives in `src/seed-data.ts`, separate from the
seeding logic, so it can be unit-tested without a database.

### Demo population

A round needs at least two compatible people. `npm run seed:demo` (from the
repo root) adds 24 fictional, fully onboarded members at "HateD Demo
University" (`demo.example.edu`), with a deterministic mix of genders and
who they are open to, so a round on your machine produces real matches. Each
has a line, two prompt answers and two or three painted portraits (never
pictures of real people), kept where the API keeps photos. Re-seeding replaces
the demo members, and with them any matches and chats you had with them:

```bash
npm run seed:demo                     # replace the demo population
npm run round -- --status PUBLISHED   # match everyone and publish
npm run seed:demo -- --clear          # remove the demo members again
```

`example.edu` is reserved by IANA for documentation, so no email to a demo
address reaches anyone. To sign in as a demo member (to answer your own chat,
say), run the API with `MAIL_TRANSPORT=console` and read the code from its log.

> Prisma ORM 7 requires Node `20.19+`, `22.12+`, or `24.0+`.

## TypeScript project references

`@hated/core` is a `composite` project and `@hated/db` lists it under
`references`, so the two typecheck together through the compiler's build graph
rather than a manual pre-step:

- `npm run typecheck` — `tsc -b --emitDeclarationOnly`: checks both projects and
  emits only the `.d.ts` files the dependent needs (no JavaScript).
- `npm run build` — `tsc -b`: emits JavaScript plus declarations to `dist/`.

The repo root has a solution-style `tsconfig.json` referencing both packages, so
the root `npm run typecheck` and `npm run build` both drive the whole graph in
dependency order (`@hated/core` first, then `@hated/db`) and stay incremental on
re-runs, instead of shelling out to each workspace in turn.

`dist/` and `*.tsbuildinfo` are gitignored.

## Schema overview

| Domain | Models |
| --- | --- |
| Identity + profile | `User`, `Profile`, `ProfileSeeking`, `ProfileTrait`, `ProfileDesire`, `ProfileBlock`, `Photo`, `ProfilePrompt` |
| FirstDate questionnaire | `Questionnaire`, `Question`, `QuestionnaireResponse`, `Answer` |
| Match round | `MatchRound`, `MatchRoundParticipant`, `Match` |
| Institution verification | `Institution`, `InstitutionVerification` |

### Notes

- Genders are stored as plain strings, not an enum. `@hated/core` treats a gender
  as an opaque tag, so the taxonomy can change without a migration.
- `Profile.seeking` having no rows means "open to everyone", matching the
  engine's empty-`seeking` semantics.
- `Profile`'s nullable `similarityWeight` / `desireWeight` / `reciprocityWeight`
  fall back to the round's `FirstDateConfig` defaults when unset.
- `Match` has unique constraints on `(roundId, profileAId)` and
  `(roundId, profileBId)`, which enforce the product promise: at most one match
  per person per round.
- `InstitutionVerification` stores only a hash (plus optional salt) of the
  emailed one-time code, never the code itself.

## Mapping to the engine

`toEngineProfile` flattens a stored profile (plus its relations) into the
`@hated/core` `Profile` the matcher consumes:

```ts
import { toEngineProfiles, PROFILE_INCLUDE } from '@hated/db';

const rows = await prisma.profile.findMany({
  where: { isActive: true },
  include: PROFILE_INCLUDE,
});
const population = toEngineProfiles(rows);
```

For the common case, `loadEngineProfiles(prisma)` runs that query for the active
population (ordered by id, so rounds are reproducible) and maps it in one call:

```ts
import { loadEngineProfiles } from '@hated/db';

const population = await loadEngineProfiles(prisma);
// options: { ids } to restrict to a cohort, { includeInactive: true } to include paused profiles
```

Contract details worth knowing:

- **Blocks are symmetric.** The mapper unions blocks this profile made with the
  ones aimed at it, because the engine only asks whether either side blocks the
  other. Store a block once; both people become mutually unacceptable.
- **Weights are all-or-nothing.** `weights` is emitted only when all three
  weight columns are non-null; otherwise the round's `FirstDateConfig` defaults
  apply (what `resolveWeights` expects).
- **Empty `seeking` stays empty**, which the engine reads as "open to everyone".

The mapper's import from `@hated/core` is type-only, so it adds no runtime
dependency on the engine.

## Persisting a match round

`persistMatchRound(prisma, roundResult, options?)` writes a completed round in a
single transaction: the round row, one participant row per person, and one row
per pair.

```ts
import { runMatchRound } from '@hated/core';
import { loadEngineProfiles, persistMatchRound } from '@hated/db';

const population = await loadEngineProfiles(prisma);
const round = runMatchRound(population, { objective: 'egalitarian' });

await persistMatchRound(prisma, round, { seed, population });
```

- Passing `population` fills each match's directional scores (`scoreTowards`);
  without it, scores stay null but 1-based ranks are still stored.
- Unmatched participants get a coarse `unmatchedReason`:
  `no-eligible-candidates` when their preference list was empty, otherwise
  `not-selected`.
- The stored `metrics` JSON also carries a compact `fair` summary (objective,
  strategy, improvement, ...) so a round can be audited after the fact.

## Running a round from the CLI

`npm run round` (→ `tsx src/cli.ts`) is the operational entry point: it loads the
active population, runs one match round, persists it, and prints a summary. It
exercises the same load → run → persist path an API worker would, against a real
database.

```bash
# from the repo root
npm run round -- --seed 42 --objective egalitarian

# package-local
cd packages/db
npm run round -- --dry-run --json
```

| Flag | Meaning |
| --- | --- |
| `--seed <n>` | RNG seed for the fairness search (default `42`) |
| `--objective <name>` | which stable matching to ship (default `min-regret`) |
| `--status <name>` | stored round status when persisting (default `COMPUTED`) |
| `--topK <n>` / `--minScore <n>` | override the FirstDate knobs |
| `--ids <a,b,c>` | restrict the population to these profile ids |
| `--include-inactive` | include profiles with `isActive = false` |
| `--dry-run` | run the round but write nothing |
| `--json` | emit the summary as JSON (for scripting) |

It reads `DATABASE_URL` from `packages/db/.env`; run `npm run seed` first if the
institution/questionnaire tables are empty. The population itself must exist as
`Profile` rows. A dry run is useful for previewing what a scoring change does
before it is written as a round.

## Inspecting a persisted round

`npm run round:inspect <roundId>` reads a round back by id: the header and stored
metrics, every participant with their side and outcome (and, for the unmatched,
the coarse reason), and every pair with each side's rank and directional score.
It is the read-side companion to the round runner.

```bash
# from the repo root (round id printed by `npm run round`)
npm run round:inspect -- cmup7rdbl0000t8j5kp3u9glk

# machine-readable, or several rounds at once
npm run round:inspect -- <id1> <id2> --json
```

A missing id prints an error and exits non-zero. The underlying loader,
`getRoundReport(prisma, roundId)`, is exported too (returns `null` for an
unknown id), so an API route can reuse it instead of the CLI.

## Comparing fairness objectives

`npm run compare` runs the stored population through every fairness objective and
prints them side by side. Match rate is identical across objectives (by the Rural
Hospitals theorem every stable matching matches the same people), so the table
isolates equitability: which objective gives the two sides the most even outcome,
and how much the rotation search improved on plain Gale-Shapley.

```bash
# from the repo root
npm run compare -- --seed 42
npm run compare -- --objectives egalitarian,min-regret --json
```

| Flag | Meaning |
| --- | --- |
| `--objectives <a,b,c>` | objectives to compare (default: all five) |
| `--seed <n>` | RNG seed for the fairness search (default `42`) |
| `--topK <n>` / `--minScore <n>` | FirstDate knobs (defaults `32` / `0.35`) |
| `--latticeSample <n>` | stable matchings sampled per objective (default `128`) |
| `--exhaustive <n>` / `--restarts <n>` / `--randomSteps <n>` | fairness-search effort |
| `--ids <a,b,c>` / `--include-inactive` | population selection, as elsewhere |
| `--json` | emit the rows as JSON |

The columns are `match%`, `meanCost`, `worst`, `gap`, `firstCh`, `improve`,
`span`, `range`, `exRot`, and `depth`; the footer names the objective with the
smallest side gap and the one with the lowest mean cost. It reuses the engine's
`runSweep` with a single `(topK, minScore)` cell, so the numbers match
`@hated/core`'s.

## Institution verification

`requestVerificationCode` (`src/verification.ts`) implements the `.edu` / `.gov`
one-time-code flow end to end: it checks the domain against the institution
allowlist, stores a code, and emails it. The code is never stored in the clear:
the service keeps a scrypt hash plus a per-request salt.

Domain matching is subdomain-aware: an address is accepted when its domain is
registered, **or is a subdomain of a registered domain**. Registering `vu.edu.au`
thus admits `live.vu.edu.au` (student portals commonly live on a subdomain).
Academic domains are regional — `.edu` (US), `.edu.au` (Australia), `.ac.uk`
(UK) — so register the institution's apex domain rather than enumerating
subdomains. The boundary is a dot label, so `notvu.edu.au` never matches
`vu.edu.au`.

```ts
import {
  createMailer,
  createPrismaClient,
  requestVerificationCode,
  resolveMailConfig,
  verifyCode,
} from '@hated/db';

const prisma = createPrismaClient();
const mailer = createMailer(resolveMailConfig(process.env)); // SMTP, Resend, or console

const sent = await requestVerificationCode(
  prisma,
  { userId, email },
  { mailer, appName: 'HateD' },
);
if (!sent.ok) return; // 'unsupported-domain' | 'delivery-failed'

// ...later, when the user submits the code:
const result = await verifyCode(prisma, { verificationId: sent.verificationId, code: submitted });
```

### Email delivery

Email goes through a one-method `Mailer` interface (`src/mailer.ts`), so the flow
isn't coupled to a provider:

- `createSmtpMailer({ host, port, user, pass, from })` (`src/smtp-mailer.ts`)
  sends through any SMTP relay — Brevo, Gmail, SMTP2GO, … — via `nodemailer`.
  Port 587 must upgrade with STARTTLS (credentials never go in the clear), 465
  uses implicit TLS, and every phase times out after 15 s instead of nodemailer's
  minutes-long defaults.
- `createResendMailer({ apiKey, from })` posts to [Resend](https://resend.com)'s
  HTTP API using the platform `fetch` — no email SDK dependency.
- `createConsoleMailer()` prints the message (and the code) for local
  development.
- `renderVerificationEmail(...)` builds the subject/text/html on its own, so you
  can snapshot it or drop in any other transport.

If the mailer throws, the pending request is expired before the error surfaces,
so a code the recipient never received cannot be redeemed.

`resolveMailConfig(env)` + `createMailer(config)` (`src/mail-config.ts`) pick
the transport from the environment, so every entry point agrees:

1. `MAIL_TRANSPORT` (`smtp` | `resend` | `console`) when set;
2. otherwise SMTP when `SMTP_HOST` is set;
3. then Resend when `RESEND_API_KEY` is set;
4. then the console mailer.

A transport that is selected but incomplete throws an error naming every missing
variable. It never falls through to the next provider, so a half-configured SMTP
setup cannot quietly keep sending through Resend.

Environment variables (see `.env.example`):

- `MAIL_TRANSPORT` — force a transport; empty means auto-detect as above.
- `MAIL_FROM` — verified sender, e.g. `HateD <codes@yourdomain.com>`.
- `RESEND_API_KEY` — Resend API key.
- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASS` — the relay
  and its login. `SMTP_PASS` is the provider's SMTP key or app password, never
  the account password.
- `SMTP_SECURE` — `true` for implicit TLS; defaults to `true` only on port 465.

Resend's sandbox sender reaches only the Resend account's own address. Brevo over
SMTP reaches anyone once a single sender address is verified, with no domain
needed. See [`docs/email-sender-domain.md`](../../docs/email-sender-domain.md) for
the Brevo setup steps, the provider comparison, the exact DNS records for each
provider, and the free-subdomain route.

### The `mail:check` helper CLI

Tests the email transport on its own: no database, no user rows. It prints the
transport it resolved (never the password or key); for SMTP it then connects,
upgrades to TLS and logs in without sending anything. With `--to` it also sends a
sample verification email (code `123456`, subject prefixed `[mail:check]`), so you
can see whether it lands in the inbox or in spam.

```bash
npm run mail:check                          # which transport, and can it log in?
npm run mail:check -- --to you@example.com  # ...and send a sample
```

| Flag | Meaning |
| --- | --- |
| `--to <addr>` | also send a sample verification email here |
| `--transport <kind>` | `smtp`, `resend`, or `console`; default `MAIL_TRANSPORT`, else auto-detect |
| `--from <addr>` / `--app <name>` | sender override / product name in the copy |

A failed step exits non-zero with the server's reply and, where it can tell, a
next step: a refused login points at the SMTP key (and, on Brevo, the authorized
IP list); a refused connection suggests port 2525 or 465; a rejected envelope
points at `MAIL_FROM`.

### The `send-code` helper CLI

```bash
# prints the code (console mailer) — no provider key needed
npm run send-code -- --email student@mit.edu --print

# real send via the configured transport (SMTP or Resend)
npm run send-code -- --email student@mit.edu
```

| Flag | Meaning |
| --- | --- |
| `--email <addr>` | recipient, must be an allowlisted `.edu`/`.gov` (required) |
| `--user <id>` | account id; default: resolved from `User` by email |
| `--transport <kind>` | `smtp`, `resend`, or `console`; default `MAIL_TRANSPORT`, else auto-detect |
| `--print` | shorthand for `--transport console` |
| `--from <addr>` / `--app <name>` | sender override / product name in the copy |
| `--ttl <minutes>` | code lifetime (default 10) |

### The `verify-code` helper CLI

Redeems a code against a stored verification — the counterpart to `send-code`.
Pass the verification id it printed (positionally or via `--id`) and the code the
user received:

```bash
npm run verify-code -- --id <verificationId> --code 123456
npm run verify-code -- <verificationId> --code 123456 --json
```

On success it prints `Code accepted`; on failure it prints the reason and exits
non-zero — `unknown`, `expired`, `too-many-attempts`, `already-verified`, or
`invalid-code` with the attempts remaining.

Guarantees (both `startVerification` and `requestVerificationCode`):

- Code is stored only as a salted scrypt hash; comparison is constant-time.
- Single use (`consumedAt`), expires after `ttlMs` (default 10 minutes).
- Locks out after `maxAttempts` wrong guesses (default 5); each failure counts.
- Issuing a new code expires any earlier pending request for the same address
  and type, so only the newest code can be redeemed.
- When the verified address is the account's own email, the same transaction
  sets `User.emailVerified` (`accountEmailVerified` in the result). A different
  address, such as a `.edu` proven by someone who signed up with Gmail, leaves it
  untouched: being a verified student and owning the login email are separate facts.

The low-level `startVerification` remains available when the caller wants to do
its own delivery. All of these take an optional `VerificationServiceOptions`
(injectable `now` clock, `ttlMs`, `maxAttempts`, `codeLength`, `scryptCost`) and
return typed results rather than throwing.

## Using the client

Prisma 7 requires a driver adapter, so construct clients through the helper:

```ts
import { createPrismaClient } from '@hated/db';

const prisma = createPrismaClient(); // reads DATABASE_URL
```

The generated client lives in `src/generated/prisma` (gitignored) and is
regenerated by the `postinstall` hook.

## Photos and words

What a match reads before saying hello, besides name and age:

- **Photos** (`addPhoto`, `deletePhoto`, `reorderPhotos`), two to six, main
  first. `processPhoto` turns an upload upright, fits it within 1080 by 1350 and
  re-encodes it as JPEG with sharp, which drops all metadata (GPS included), and
  makes a blurred copy from a 24-pixel thumbnail, so no detail survives. The
  upload itself is never kept. Files go in a `PhotoStore`: on disk in
  `packages/db/data/photos` (git ignores it; `PHOTO_DIR` moves it), and anything
  with put, get and delete can replace it.
- **Who sees which version** (`photoAccess`, `readPhoto`): your own in full; a
  match's blurred until both said hello, then in full; nothing for strangers,
  unpublished rounds or ended matches.
- **Words** (`saveWords`): one line (up to 120 characters) and up to three
  answers (150 characters each) to the prompts in `PROMPTS`.
- **Highlights** (`describePerson`): plain phrases from the questionnaire, most
  telling first ("Humor comes first", "Weekends outdoors"). `suggestOpeners`
  turns the partner's prompts and shared traits into three conversation openers.

The account view carries all of this, and onboarding counts the profile as
finished at two photos. The match view (`getLatestResult`, `getMatch`) carries
the partner's, with `photosUnlocked`.

## Reviewing reports

People can report a match from the app; reporting also ends that match. Open
reports are listed oldest first, with who reported whom, the reason, any
details, and how many reports the same person has had in total:

```bash
npm run reports                    # open reports
npm run reports -- --all           # include reviewed ones
npm run reports -- --resolve <id>  # mark one as reviewed
```

A report outlives its author: if the person who reported deletes their account,
the report stays and shows as from `(a deleted account)`.

## Deleting an account

`deleteAccount(prisma, userId)` erases a person, for good (the right to
erasure). One delete of the user row cascades to everything that is theirs:
profile, answers, traits and hopes; sessions, push tokens and email
verifications; their place in past rounds; their matches with every message in
them; and reports about them. Their partner in a match simply stops seeing it
(the result reads as `none`, not a "no match" that never happened). Reports
they made about someone else stay without their name, so the team can still act
on them. Round totals are counts, not people, and stay as they were. The
address is free to sign up again afterwards.

## Exporting an account

`exportAccount(prisma, userId)` returns everything HateD holds about a person
as one JSON document (`format: "hated-export"`, `version: 1`), for the rights
of access and data portability: the account and notification settings, email
verifications, profile, answers, the traits and hopes matching uses, rounds,
matches with the messages they sent, reports they made, sign-ins and
notification devices.

Left out on purpose, and said so in the export's `about`: other people's data
(their names, their messages, and reports they made about this person), and
secrets (sign-in codes and session tokens, which are only stored as hashes,
and push tokens, which would let anyone notify the phone).
