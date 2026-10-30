# Affinix native apps (Kotlin + Compose Multiplatform)

A real app, no browser engine inside: one Kotlin code base draws the screens itself (Skia) on **Windows, Linux and Android**.
It talks to the same Supabase project and the same rules as the website, so XP, levels, rankings and answers are shared.

What is in it (milestone 1, the Arena): sign in / sign up / reset password, today's Daily Challenge, free play, the duel console
(two designs, reveal with the crowd's percentages, XP, combo, eye tests), round summary, rankings, profile, ru / kk / en.
What is **not** in it yet: Feed, Messages, Marketers' tools, Settings, Google sign-in, push notifications. Those stay on the website
(the older web-wrapper apps in `apps/` are still published until the native app has them all).

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
