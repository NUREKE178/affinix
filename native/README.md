# Affinix native apps (Kotlin + Compose Multiplatform)

A real app, no browser engine inside: one Kotlin code base draws the screens itself (Skia) on **Windows, Linux and Android**.
It talks to the same Supabase project and the same rules as the website, so XP, levels, rankings and answers are shared.

What is in it: sign in / sign up / reset password; the **Arena** (Daily Challenge, free play, duel console with reveal and crowd percentages, XP and combo, eye tests, round summary,
rankings, **daily quests** with claims); the **Feed** (posts, likes, saves, comments, composer with the site's word filter); **Friends** (search by name or @username, requests);
**Chats** (text messages with friends, read ticks, unread badge); **Profile** (edit, rankings visibility, awards); **Notifications**; ru / kk / en.
What is **not** in it yet: marketers' tools (experiments, builder, results, crowd tests, participants, reports), admin, team, billing, Google sign-in, photo upload (posts, chat, avatar),
chat reactions / replies / editing and live delivery, extra daily sets and the weekly theme, Taste DNA, global search, push notifications, self-update.

## Layout

```
native/
  composeApp/src/commonMain   all screens, rules, API client, game state machine (shared by every platform)
    kotlin/space/affinix/app
      Rules.kt                XP, levels, ranks: a 1:1 port of src/lib/arena/rules.js
      net/                    Supabase auth + RPC client (token refresh), deal/specimen client, models
      store/Game.kt           one round as a state machine (vote, combo, XP, offline queue)
      store/AppModel.kt       what the screens read
      ui/                     Instrument theme (graphite + one orange signal) and the screens
      i18n/Strings.kt         GENERATED from the site's locale files (see below)
    composeResources          Rubik font, logo
  composeApp/src/desktopMain  window + settings file          composeApp/src/androidMain  activity + SharedPreferences
  composeApp/src/commonTest   unit tests (rules parity with the JS, game logic, API client on a mock server)
  composeApp/src/desktopTest  offscreen screenshots of every screen
  scripts/gen-strings.mjs     regenerates Strings.kt from src/lib/locales/{ru,kk,en}.js
  scripts/gen-icons.mjs       regenerates IconData.kt from src/components/icons.js (the site's own icon set)
```

Duels are dealt by two Vercel functions that reuse the website's own sampler (`api/arena-deal.mjs`, `api/arena-specimen.mjs`), so a duel
means the same thing in the app and on the site and the community's answers pile up on the same pairs.

## Build and test

CI does all of this (`.github/workflows/native-apps.yml`, run it from the Actions tab or push a change under `native/`):

| Job | Result |
| --- | --- |
| Tests and screenshots | unit tests + a PNG of each screen (artifact `native-screenshots`, also pushed to the branch `native-shots`) |
| Linux | `Affinix-native.deb` and `Affinix-native-linux.tar.gz` |
| Windows | `Affinix-native.msi` and `Affinix-native-Setup.exe` |
| Android | `Affinix-native.apk`, signed (your key from the `ANDROID_KEYSTORE_*` secrets, otherwise a one-off key) |
| Android emulator check | installs the APK on an emulator, launches it, checks it does not crash, screenshot on the branch `android-shots` |

Locally (needs JDK 21 and access to Maven Central and Google Maven):

```
cd native
./gradlew :composeApp:desktopTest        # tests + screenshots in composeApp/build/shots
./gradlew :composeApp:run                # start the desktop app
./gradlew :composeApp:packageDeb         # or packageMsi / packageExe on Windows
./gradlew :composeApp:assembleRelease -PwithAndroid=true   # APK (needs the Android SDK)
```

If you change a string on the website, run `node native/scripts/gen-strings.mjs` (CI fails when `Strings.kt` is out of date).

## Honest limits

- Nothing here has been run on a real Windows PC or a real phone by the author; CI builds the files, runs the tests and an Android emulator.
- Desktop installers include a Java runtime, so they are large (about 120 MB).
- The Windows installer is not code-signed (SmartScreen warns); the APK is signed with a one-off key unless you add the secrets.
- Updating an APK needs the same signing key: add the `ANDROID_KEYSTORE_*` secrets (`bash scripts/android-key.sh`), otherwise uninstall the old build first.
- Google sign-in needs `http://127.0.0.1:**` and `space.affinix.app://auth` in Supabase, Auth, URL configuration, Redirect URLs. Picture picking and Google sign-in are covered by tests but have not been tried on a real phone.
- The app only tells you that a newer release exists (it links to the download page); it does not install updates itself.
- Chats ask the server every few seconds (no live socket, no "typing" or online dots); there are no push notifications.
- Not in the apps yet: the experiment builder, results, participants, reports, team, billing and admin screens.
