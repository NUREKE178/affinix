# Affinix apps

Real installable apps that open **https://affinix.space** in their own window. The web app is the app, so the apps are always the current
version of the site; the shells add what a browser tab does not have.

| Platform | File | What it is |
|---|---|---|
| Windows 10/11 | `Affinix-Setup.exe` | Electron, NSIS installer, updates itself |
| Linux (any) | `Affinix.AppImage` | Electron, runs without installing, updates itself |
| Debian / Ubuntu / Mint | `Affinix.deb` | Electron, installs with `apt` |
| Android 6+ | `Affinix.apk` | Trusted Web Activity: Chrome in a full-screen app shell |

`SHA256SUMS.txt` lists the checksums. The site's **Download** page (`/#/download`, `src/pages/Download.js`) reads the GitHub releases and links
these files (each file from the newest release that has it, so one failed build does not take an app off the page).

## Make a release

The builds run on GitHub (the machine this was written on cannot build Android or run Electron): **Actions → "Release apps" → Run workflow →
version `1.0.0`**, or push a tag: `git tag v1.0.0 && git push origin v1.0.0`. About 10-15 minutes later the release appears under **Releases** and the
Download page shows it. A failed platform does not stop the others; the release notes say which one did not finish.

`node scripts/check-apps.mjs` checks the packaging without building (names, link rules, Android resources, asset links, no key in the repository);
the workflow runs it first.

## What is in it

* `desktop/` - Electron 33. One window, one instance, remembered window position, tray icon (optional "keep running"), `affinix://app/arena` links,
  start with the system (optional), menu in English / Russian / Kazakh, an offline page that retries by itself, a sandboxed window, only the site and
  its sign-in stay inside (every other link opens in the browser, and only web and mail links), permissions only for the site, automatic updates from
  the GitHub release (Windows installer and AppImage; the .deb updates through apt). `lib.js` holds the pure rules, tested by `scripts/check-apps.mjs`.
* `android/` - a Gradle project: `androidbrowserhelper` `LauncherActivity` (Trusted Web Activity), splash screen, launcher shortcuts (Arena, What
  people love, Feed), `https://affinix.space` links open in the app, notifications delegation. Chrome is the engine, so Google sign-in works (a plain
  WebView is refused by Google).
* `../.well-known/assetlinks.json` (+ `../assetlinks.json`, `../vercel.json`) - the site vouches for the APK's signing key (kept up to date by the
  workflow), which is what lets the app run full screen without a browser bar.

## The Android signing key

No key is stored in the repository. Every build makes a one-off key (the APK installs fine), unless you give the workflow a permanent one, once:

    bash scripts/android-key.sh        # makes affinix-release.jks, sets the repository secrets if the GitHub CLI is installed, else tells you what to paste

(or by hand: `keytool -genkeypair ...`, then the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`).
Why it matters: a phone only updates an app in place when the new APK is signed with the same key. With a one-off key per release, people have to
uninstall the old Affinix first; with the permanent key, updates just work. Keep the `.jks` file and its password somewhere safe: if they are lost, the
installed apps can never be updated again.

After every Android build the workflow's **Asset links** job adds the build's key fingerprint to `.well-known/assetlinks.json` and `assetlinks.json` on
`main` (`scripts/update-assetlinks.mjs`; the site redeploys). That file is how the site vouches for the app, which is what makes it run full screen
without a browser bar. If the push is refused (a protected `main`), the job says so, and the same command can be run by hand with the fingerprint from
the job log.

## Honest limits

* The exe is not signed with a paid code-signing certificate, so Windows SmartScreen says "protected your PC": More info → Run anyway.
* Nothing here has been built on a machine yet: the first run on GitHub may need a small fix. What was checked without building: the workflow is linted
  (actionlint + shellcheck), the electron-builder configuration is validated against its own schema, the desktop rules and the Android resources are
  tested by `scripts/check-apps.mjs`, the Download page by `test_download` (46 checks).
* No macOS / iOS app (Apple needs a paid developer account): iPhone and Mac use "Add to Home Screen".
