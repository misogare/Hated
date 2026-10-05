# @hated/mobile

The HateD app: Expo (SDK 57) with Expo Router, built from the "Candlelight"
prototype. It talks only to `@hated/api` and imports that package's
`contract.ts` type-only, so request and response shapes are checked at compile
time without bundling any server code.

## Running it on your phone

You need the API, Postgres, and Node 20.19+ (the repo's `.nvmrc` says 22).

```bash
docker compose up -d     # Postgres
npm run api              # the API on :3000 (see packages/api/README.md for its .env)
npm run mobile           # Expo dev server; scan the QR code with Expo Go
```

The app finds the API on its own: in development it calls the machine that runs
the Expo dev server, on port 3000. A phone on the same Wi-Fi therefore needs to
reach that port:

- **Windows firewall.** The first time, allow Node through the firewall prompt
  for private networks, or the phone's requests time out.
- **Different network, emulator, or a deployed API?** Set
  `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.20:3000`) before
  `npm run mobile`. It overrides the automatic address.

To try sign-in without sending real email, start the API with
`MAIL_TRANSPORT=console`: codes are printed in the API's terminal.

`npm run web -w @hated/mobile` runs the same app in a browser, which is handy
for quick layout checks; the phone is the real target.

## How it's put together

| Path | What |
| --- | --- |
| `src/app/` | Routes (Expo Router). Signed-out: `index` (welcome), `how-it-works`, `sign-in/*`. Signed-in: `start`, `onboarding/*`, `home`, `reveal`, `no-match`, `chat`, `matches`, `report`, `settings`. |
| `src/app/_layout.tsx` | Loads the fonts and decides which routes exist with `Stack.Protected`, so signing in or out moves you to the right place. |
| `src/session.tsx` | The session: token in the keychain/keystore (`expo-secure-store`), the account, and an API client that signs out on any 401. |
| `src/api/client.ts` | Typed calls to the API, plus friendly wording for its errors. |
| `src/theme.ts` | Colours and fonts. Day palette for sign-in and profile; night palette for rounds. |
| `src/components/` | Screen, text, buttons, chips, fields, progress. |
| `src/copy.ts` | Slider phrases and labels per trait, the gender vocabulary, round-time formatting. |

Onboarding resumes where it was left: `start` reads the account's onboarding
progress. The questionnaire saves each answer as it goes, and the profile,
answers and "what matters" screens double as editors from home (`?edit=1`).

Chat opens from home or the reveal once both people have said hello. It polls
for new messages every 3 seconds while the screen is open, and closes for both
if either passes or reports. "Your matches" lists every match from every round
with its last message, so earlier conversations stay reachable; unread counts
show there, on its tile on home, and on the "Open chat" button.

"What matters" starts each trait not yet saved at "Nice to have", aimed at the
middle of the scale, as in the prototype. "Don't mind" leaves a trait out of
matching entirely.

## Checks

```bash
npm run typecheck -w @hated/mobile
npx expo-doctor                   # from packages/mobile
```

The root `package.json` pins one React version (`overrides`), because another
workspace's tooling would otherwise hoist a second copy and break hooks in the
app. `expo-doctor` flags this if it ever regresses.
