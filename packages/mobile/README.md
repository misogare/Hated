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
| `src/live.tsx` | The live connection: a WebSocket to the API while signed in, so screens hear at once about a hello back, a message, an ended match or a round. |
| `src/notifications.ts` | Push notifications: permission, registering this device with the API, and opening the screen a tapped notification is about. |
| `src/theme.ts` | Colours, fonts and shadows. Day palette for sign-in and profile; night palette for rounds. |
| `src/motion.ts` | The native-driver flag and `useReducedMotion`: nothing animates for someone who asked their device for less motion. |
| `src/components/` | Screen, text, buttons, chips, fields and progress, plus the look's own pieces (see [Design](#design)). |
| `src/copy.ts` | Slider phrases and labels per trait, the gender vocabulary, round-time formatting. |

Onboarding has four steps (about you, the questions, what matters, photos and
words) and resumes where it was left: `start` reads the account's onboarding
progress. The questionnaire saves each answer as it goes, and every step doubles
as an editor from settings or home (`?edit=1`).

**Photos and words** (`onboarding/photos`) takes two to six photos from the
library (`expo-image-picker`). Each is resized to at most 1600 pixels and turned
into JPEG on the phone (`expo-image-manipulator`; iPhones pick HEIC) before
upload. "See them as your match will" shows the blurred copies the server makes.
Below go a line about yourself, two prompt answers, and the highlights the API
works out from the questionnaire. Finishing needs two photos.

Photos are fetched with `expo-image`, sending the session token, so the API
decides on every request what this person may see: a match's photos blurred
until both have said hello, then the real ones fading in over the blurred.

**The reveal** opens a sealed envelope, then the other person's profile. After
"Say hello" it looks for their hello every four seconds; once both have, the
circles meet, the photos unblur, and the chat opens by itself, for whichever of
the two said hello first as well as the one who completed it. `?matchId=` opens
any earlier match the same way.

Both have 24 hours from the round to say hello (the API's `HELLO_WINDOW_HOURS`).
The reveal, home and "Your matches" show the time left; when it runs out, a
match that isn't mutual closes on every screen, a reveal left open included,
with the same words for both people.

Chat opens from home, the reveal or the matches list once both people have said
hello; an empty conversation suggests three openers from what the two share.

**Live updates** come over a WebSocket (`src/live.tsx`): home, the matches list,
the reveal and the chat refresh the moment something changes for this person.
If the other person says hello back while someone is on home or their matches,
the app plays the "you both said hello" moment and opens the chat. Screens still
poll now and then (rarely while the connection is up), so nothing is lost if it
drops; it reconnects by itself, and at once when the app comes back to the
foreground. It polls
for new messages every 3 seconds while the screen is open, and closes for both
if either passes or reports. "Your matches" lists every match from every round
with its last message, so earlier conversations stay reachable; unread counts
show there, on its tile on home, and on the "Open chat" button.

"What matters" starts each trait not yet saved at "Nice to have", aimed at the
middle of the scale, as in the prototype. "Don't mind" leaves a trait out of
matching entirely.

## Design

"Candlelight", evolved from the first prototype (both are pages of the design
canvas). Day palette (blush paper, wine ink, rose) for signing in and the
profile; evening palette (wine, honey, rose) for everything about rounds. Fraunces
for display, with its italic for the moments that matter; Figtree for the rest.

| Component | What |
| --- | --- |
| `Glow` | Candlelight: a soft radial pool, in SVG (`react-native-svg`), since views can't draw radial gradients. `<Screen glow>` puts one behind an evening screen. |
| `MeetingCircles` | The mark: two circles with a spark where they overlap. They drift on the welcome screen and come together when both say hello. |
| `Candle` | Home's countdown: it burns down over the week, its flame flickering. |
| `Envelope` | The sealed match; the wax seal breaks and the flap lifts. |
| `ProfilePhoto`, `Avatar` | A photo, blurred or not, fetched with the session's token. |
| `Quote`, `PromptCard`, `Highlights`, `Reasons` | The parts of a profile. |

## Privacy

Settings holds the person's privacy choices:

- **Notifications:** turn new messages, hellos or round results off, for every
  device at once (on top of the phone's own settings).
- **Take part in rounds:** off leaves them out of matching until they turn it
  back on; matches and conversations stay. It's the same switch as home's "Sit
  this round out".
- **Download your data:** a copy of everything HateD holds about them, as a
  JSON file (`hated-data-<date>.json`). The browser downloads it; on a phone it
  is written to the app's cache (`expo-file-system`) and handed to the share
  sheet (`expo-sharing`), so it can go to Files, Drive or email. Five an hour.
- **Delete my account:** after a second step that says what goes, the API
  erases the account and everything in it, and the welcome screen confirms it.
  Reports they made about someone else stay, without their name.

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
