# @hated/api

The HTTP API the mobile app talks to. A thin [Hono](https://hono.dev) layer over
`@hated/db`: each route validates its body, calls one service, and maps the
typed result to a status code. Request and response shapes live in
[`src/contract.ts`](src/contract.ts), which the app imports type-only.

## Running it

```bash
cp packages/api/.env.example packages/api/.env   # optional: port, round time
npm run api                                       # from the repo root: build, then watch
```

The database URL and mail transport come from `packages/db/.env`, so they are
configured once. The API needs Postgres running (`docker compose up -d`) and
Node 20.19+ (Prisma 7).

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | `0.0.0.0` lets a phone on the same Wi-Fi reach it. |
| `ROUND_DAY` / `ROUND_TIME` / `ROUND_TIMEZONE` | `SUN` / `20:00` / `Australia/Melbourne` | When rounds close: wall-clock time in that zone, steady across daylight saving. |
| `ROUND_AUTORUN` | `true` | Run each round automatically at its slot. `false` leaves it to `npm run round`. |

With `MAIL_TRANSPORT=console`, sign-in codes are printed to the API's log
instead of emailed, which is handy for local development.

## Endpoints

Everything except `/health`, `/auth/code` and `/auth/verify` needs
`Authorization: Bearer <token>`.

| Route | Does | Notable responses |
| --- | --- | --- |
| `POST /auth/code` `{ email }` | Email a sign-in code; first use creates the account | 422 `unsupported-domain`, 429 `rate-limited` (+ `Retry-After`), 502 `delivery-failed` |
| `POST /auth/verify` `{ verificationId, code }` | Exchange the code for a session token | 401 `invalid-code` with `attemptsRemaining`; 400 `expired` / `too-many-attempts` / … |
| `POST /auth/sign-out` `{ everywhere? }` | End this device's session, or every session | |
| `GET /me` | The account, profile and onboarding progress | |
| `PUT /me/profile` | Name, birthday, gender, who they're open to | 422 `invalid` with readable `problems` |
| `PUT /me/active` `{ active }` | Sit out of, or rejoin, upcoming rounds | 409 `no-profile` |
| `GET /questionnaire` | The active questionnaire, in order | |
| `GET`/`PUT /me/answers` | Answers by question key; `null` skips | 409 `no-profile`, 422 `invalid` |
| `GET`/`PUT /me/desires` | What they hope for per trait; weight 0 = don't mind | 409 `no-profile`, 422 `invalid` |
| `GET /home` | Next round time, opt-in state, latest published result | |
| `POST /matches/:id/hello` | Say hello; `{ mutual }` once both have | 404 `not-found`, 409 `passed` |
| `POST /matches/:id/pass` | Never be matched with them again | 404 `not-found` |
| `GET /matches/:id/messages?after=<id>` | The conversation, oldest first; with `after`, only newer messages (the app polls this) | 403 `not-mutual` until both said hello, 409 `passed`, 404 `not-found` |
| `POST /matches/:id/messages` `{ body }` | Send a message (trimmed, 1–2000 characters) | 201 with the message; 422 `invalid`; 403 / 409 / 404 as above |

Errors are always `{ error, problems?, attemptsRemaining?, retryAfterSeconds? }`;
internal errors are logged and returned as a bare `{ error: "internal" }`.

## Automatic rounds

When each slot arrives, the API matches everyone who is in that round and
publishes the result, so people see it straight away. If the server was down
at a slot, it runs that slot when it starts again, as long as it is less than
12 hours late. Each slot is stored on its round with a unique constraint, so
it runs exactly once even with several API servers running the scheduler. The
log shows each run as `[rounds] round <slot>: matched N of M people`.

## Sessions

A session token is 32 random bytes, valid for 30 days. The database keeps only
its SHA-256 hash, one row per signed-in device, and every request looks it up.
`POST /auth/sign-out` ends this device's session; `{ "everywhere": true }`
ends every session the person has, so a lost phone can be signed out from
another device.
