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
| `src/notifications.ts` | Push notifications: permission, registering this device with the API, and opening the screen a tapped notification is about. |
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

## Push notifications

Home asks for permission once (the system shows its prompt) and registers this
device's Expo push token with the API. People then hear about a new message
("New message from Maya", never the text), the other person saying hello back,
and a round's result. Tapping one opens that conversation, or home for a round.
A message in the conversation already on screen arrives quietly, without a
banner. Signing out stops the device's notifications.

Push needs a few things the code can't do for you. Until they're done, the app
skips push quietly and everything else works; in development the console says
why (e.g. `[push] not set up: no-project`).

1. **An Expo project.** Push tokens belong to one. Once, from `packages/mobile`:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init     # writes extra.eas.projectId into app.json; commit that
   ```

2. **Credentials.** Expo delivers through Google and Apple, so each platform
   needs its own (see Expo's
   [push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)):
   - **Android:** a Firebase project. Put its `google-services.json` in
     `packages/mobile`, set `android.googleServicesFile` to it in `app.json`,
     and upload the Firebase service account key with
     `npx eas-cli@latest credentials` (Android → Google Service Account → FCM V1)
     ([guide](https://docs.expo.dev/push-notifications/fcm-credentials/)).
   - **iOS:** a paid Apple Developer account. EAS offers to set up push the
     first time it builds for iOS.
3. **A development build.** Expo Go and the web build can't receive pushes. A
   phone, an Android emulator with Google Play, or an iOS simulator (Xcode 14+)
   can, running a build that includes this app's native code:

   ```bash
   npx expo install expo-dev-client
   npx eas-cli@latest build --profile development --platform android   # in the cloud
   # or: npx expo run:android, with Android Studio installed
   ```

The API sends through Expo's push service and needs no keys of its own, unless
the Expo project turns on enhanced push security; then set `EXPO_ACCESS_TOKEN`
for the API (see `packages/api/README.md`). To test without the app, Expo's
[push tool](https://expo.dev/notifications) sends to a token by hand.

## Checks

```bash
npm run typecheck -w @hated/mobile
npm run lint -w @hated/mobile      # expo lint
npx expo-doctor                   # from packages/mobile
```

The root `package.json` pins one React version (`overrides`), because another
workspace's tooling would otherwise hoist a second copy and break hooks in the
app. `expo-doctor` flags this if it ever regresses.
