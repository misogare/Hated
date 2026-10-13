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
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy, so per-IP limits read `X-Forwarded-For`. |
| `EXPO_ACCESS_TOKEN` | (none) | Only if the Expo project has enhanced push security on. |
| `PHOTO_DIR` | `packages/db/data/photos` | Where photo files are kept. Git ignores the default. |
| `HELLO_WINDOW_HOURS` | `24` | How long people have to say hello after a round. A fraction (`0.05` is three minutes) is handy for trying it out. |

With `MAIL_TRANSPORT=console`, sign-in codes are printed to the API's log
instead of emailed, which is handy for local development.

## Endpoints

Everything except `/health`, `/auth/code` and `/auth/verify` needs
`Authorization: Bearer <token>`.

| Route | Does | Notable responses |
| --- | --- | --- |
| `POST /auth/code` `{ email }` | Email a sign-in code; first use creates the account | 422 `unsupported-domain`, 429 `rate-limited` (+ `Retry-After`; per address and per IP), 502 `delivery-failed` |
| `POST /auth/verify` `{ verificationId, code }` | Exchange the code for a session token | 401 `invalid-code` with `attemptsRemaining`; 400 `expired` / `too-many-attempts` / … |
| `POST /auth/sign-out` `{ everywhere?, pushToken? }` | End this device's session (and stop its notifications), or every session and every device | |
| `PUT /me/push-token` `{ token, platform }` | This device can receive push notifications | 422 `invalid` |
| `GET /me` | The account, profile, onboarding progress and notification settings | |
| `DELETE /me` | Delete the account and everything in it, for good (see [Deleting an account](#deleting-an-account)) | 204 |
| `GET /me/export` | Everything HateD holds about the person, as one JSON file (see `packages/db/README.md`); never cached | 429 `rate-limited` after 5 an hour |
| `PUT /me/notifications` `{ messages?, hellos?, rounds? }` | Turn each kind of push notification on or off, on every device; kinds left out stay as they are | 400 for anything else |
| `PUT /me/profile` | Name, birthday, gender, who they're open to | 422 `invalid` with readable `problems` |
| `PUT /me/active` `{ active }` | Sit out of, or rejoin, upcoming rounds | 409 `no-profile` |
| `GET /me/photos` | Their photos, main first | |
| `POST /me/photos` (multipart, `photo`) | Add a photo (JPEG, PNG or WebP, up to 15 MB) | 201 with every photo; 422 `invalid` (not a photo, too small), 409 `too-many` (six at most), 413 `too-large`, 429 after 30 an hour |
| `PUT /me/photos/order` `{ ids }` | Reorder them; the first is the main one | 422 `invalid` unless it lists each photo once |
| `DELETE /me/photos/:id` | Remove one | 404 `not-found` |
| `GET /photos/:id/full` / `GET /photos/:id/blurred` | The photo as JPEG, if this person may see that version (see below) | 404 otherwise |
| `PUT /me/words` `{ bio, prompts }` | Their line and up to three prompt answers | 422 `invalid` with `problems` |
| `GET /prompts` | The prompts the app offers | |
| `GET /questionnaire` | The active questionnaire, in order | |
| `GET`/`PUT /me/answers` | Answers by question key; `null` skips | 409 `no-profile`, 422 `invalid` |
| `GET`/`PUT /me/desires` | What they hope for per trait; weight 0 = don't mind | 409 `no-profile`, 422 `invalid` |
| `GET /home` | Next round time, opt-in state, latest published result, unread total | |
| `GET /matches` | Every match from published rounds, newest first, with main photo, last message and unread count | |
| `GET /matches/:id` | One match from any published round: the other person's words, highlights and photos, why they fit, and openers | 404 `not-found` |
| `POST /matches/:id/report` `{ reason, details? }` | Report for review; also ends the match like a pass | 422 `invalid`, 404 `not-found` |
| `POST /matches/:id/hello` | Say hello; `{ mutual }` once both have | 404 `not-found`, 409 `passed`, 409 `expired` once the window to say hello has closed |
| `POST /matches/:id/pass` | Never be matched with them again | 404 `not-found` |
| `GET /matches/:id/messages?after=<id>` | The conversation, oldest first; with `after`, only newer messages (the app polls this) | 403 `not-mutual` until both said hello, 409 `passed`, 404 `not-found` |
| `GET /live` (WebSocket) | Live updates while the app is open; see below | closes with 4001 if the session is refused |
| `POST /matches/:id/messages` `{ body }` | Send a message (trimmed, 1–2000 characters) | 201 with the message; 422 `invalid`; 403 / 409 / 404 as above |

Errors are always `{ error, problems?, attemptsRemaining?, retryAfterSeconds? }`;
internal errors are logged and returned as a bare `{ error: "internal" }`.

## The window to say hello

A round's matches have 24 hours (`HELLO_WINDOW_HOURS`) from when it is
published for both people to say hello. Each match carries its `helloDeadline`
and `expired`. After the deadline a hello is refused (409 `expired`) and a match
that isn't mutual is over; one that became mutual in time stays open. It reads
the same to both people, so the one who didn't say hello never learns whether
the other did. The round's push says how long there is.

## Live updates

The app keeps a WebSocket open at `/live` while signed in. Its first message
signs in, `{ "type": "auth", "token": "…" }` (browsers can't put headers on a
WebSocket, and a token in the URL would end up in logs); the answer is
`{ "type": "ready" }`. From then on it receives one small event the moment
something changes for that person:

| Event | Sent to | When |
| --- | --- | --- |
| `{ type: "mutual", matchId }` | both people | the second hello, so the chat opens on both screens |
| `{ type: "message", matchId }` | both people | a new message (never its text) |
| `{ type: "ended", matchId }` | both people | a pass or a report |
| `{ type: "round", roundId }` | everyone in it | a round is published, by the scheduler or the CLI |

A one-sided hello is never announced, as everywhere else. Events go through
Postgres (`NOTIFY`/`LISTEN` on `hated_live`), so every API server hears every
event, and a round published from the CLI reaches open apps too. Each
connection is pinged every 30 seconds and its session checked again, so dead
connections go and signing out closes the socket.

## Automatic rounds

When each slot arrives, the API matches everyone who is in that round and
publishes the result, so people see it straight away. If the server was down
at a slot, it runs that slot when it starts again, as long as it is less than
12 hours late. Each slot is stored on its round with a unique constraint, so
it runs exactly once even with several API servers running the scheduler. The
log shows each run as `[rounds] round <slot>: matched N of M people`.

## Limits on sign-in

Each code is a real email from a capped plan, and each one is another chance to
guess, so sign-in is limited twice over:

- **Per address** (in the database): one code a minute and 10 a day.
- **Per IP** (in this process): 5 code requests a minute and 30 an hour, and 20
  code checks a minute and 100 an hour, which stops one machine walking through
  many inboxes or guessing across many codes.

Over a limit, the answer is 429 with `Retry-After`.

## Photos

Each upload is turned upright, fitted within 1080 by 1350 and re-encoded as
JPEG, which drops all metadata, so a phone's GPS position never leaves with the
photo. A blurred copy is made at the same time, shrunk to a few dozen pixels
first so no detail can come back. The original upload is never kept.

Who may fetch what:

- Your own photos, in full.
- A match's photos, blurred, until you have both said hello; then in full.
  Blurring on the server matters: blurring in the app would put the real photo
  on the wire.
- Nothing from someone you aren't matched with, from a round that isn't
  published, or from a match that has ended. That reads as 404, so photo ids
  reveal nothing.

Photo responses are `Cache-Control: private` and expire after an hour.

## Push notifications

Sent through Expo's push service to every device a person has registered:

- **A new message:** "New message from Maya", never the message itself.
- **Both said hello:** the person who said hello first hears that the
  conversation is open. A one-sided hello is never announced.
- **A round published:** everyone in it hears that their result is in (from the
  automatic scheduler, or `npm run round -- --status PUBLISHED --notify`).

Each kind can be turned off (`PUT /me/notifications`), for all of a person's
devices at once. Sending never slows down or fails the request that caused it.
Devices Expo reports as gone are forgotten, and signing out removes the
device's token.

## Deleting an account

`DELETE /me` erases the person for good: profile, answers, sessions, devices,
email verifications, matches and every message in them, and reports about
them. Every session ends with it, so the token used for the request stops
working. Their matches disappear for the other person. Reports they made about
someone else stay, without their name, for the team to act on. See
`packages/db/README.md` for exactly what is kept and why.

## Sessions

A session token is 32 random bytes, valid for 30 days. The database keeps only
its SHA-256 hash, one row per signed-in device, and every request looks it up.
`POST /auth/sign-out` ends this device's session; `{ "everywhere": true }`
ends every session the person has, so a lost phone can be signed out from
another device.
