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
below), `typecheck`.

### Seed data

`npm run seed` (via `prisma db seed` → `tsx src/seed.ts`) upserts:

- the trusted-institution allowlist (`Institution` rows for a few `.edu`/`.gov`
  domains), and
- one `FirstDate` questionnaire with a `SCALE` question per scored trait plus a
  sample choice question.

Every write is an upsert keyed on the schema's unique columns, so re-running is
idempotent. The data itself lives in `src/seed-data.ts`, separate from the
seeding logic, so it can be unit-tested without a database.

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
| Identity + profile | `User`, `Profile`, `ProfileSeeking`, `ProfileTrait`, `ProfileDesire`, `ProfileBlock` |
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

## Using the client

Prisma 7 requires a driver adapter, so construct clients through the helper:

```ts
import { createPrismaClient } from '@hated/db';

const prisma = createPrismaClient(); // reads DATABASE_URL
```

The generated client lives in `src/generated/prisma` (gitignored) and is
regenerated by the `postinstall` hook.
