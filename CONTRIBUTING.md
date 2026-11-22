# Contributing to GO 3.0

GO 3.0 (Qortal GO) is the Android app built on [Qortal Hub](https://github.com/Qortal/Qortal-Hub)'s
code. It is a community project: the desktop Hub belongs to the Hub developers, GO is maintained
here. Pull requests are welcome.

## Branches

| Branch | What it is |
|---|---|
| `develop` | The working branch and the default. **Open every PR against `develop`.** |
| `main` | Released versions only. Each release is tagged `v<versionName>` (for example `v0.0.20`). |
| `feature/...`, `fix/...` | Your work, branched from `develop`. |

```bash
git checkout develop
git pull
git checkout -b fix/short-name
# ...commit...
git push -u origin fix/short-name   # on Your fork, then open a PR into develop
```

Releases are made by the maintainer: `develop` is merged into `main`, tagged, and the signed APK
is built and published from there.

## Rules that matter for GO

- **GO must keep working with unmodified desktop Hubs.** People chat, call and send files between
  GO and released Hubs (3.0.3 and older). Anything sent over Reticulum or QDN has to stay
  wire-compatible with them. Don't plan a fix that needs a Hub release.
- **Hub-only code stays as Hub has it.** Desktop-only files (for example
  `electron/src/reticulum-bridge.ts`, `electron/src/setup.ts`, `electron/resources/presence_bridge.py`
  and desktop-only UI) come from upstream Hub. Changes for the desktop Hub belong in a PR to
  [Qortal/Qortal-Hub](https://github.com/Qortal/Qortal-Hub), not here. The shared chat engine
  (`electron/src/reticulum-chat*.ts`) is GO code too, since GO's worker runs it.
- **Every user-visible text goes through i18n**, in all 12 languages (`src/i18n/locales/` and
  `android/app/src/main/res/values-*/strings.xml`). See `docs/i18n_languages.md`.
- **No keys, tokens, wallet backups, node API keys or personal data** in commits, tests,
  screenshots or logs.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything a user would notice.

`AGENTS.md` has the code conventions (state, styling, formatting, tests).

## Build setup

| Tool | Version |
|---|---|
| Node.js | 22 |
| JDK | 21 (a full JDK, not a JRE) |
| Android SDK | platform 36, build-tools 36.0.0, platform-tools |
| Android NDK | 27.2.12479018 |
| CMake (from the SDK) | 3.22.1 |
| Python | 3.13 on `PATH` (Chaquopy builds the Reticulum bridge with it) |
| Git | any recent |

Point `android/local.properties` at Your SDK (`sdk.dir=/path/to/android-sdk`). If Gradle picks the
wrong Java, set `org.gradle.java.home=/path/to/jdk-21` in Your own `~/.gradle/gradle.properties`.
Don't put machine paths in the repo's files.

First build after cloning:

```bash
npm ci
android/app/src/main/cpp/fetch-llama.sh   # pinned llama.cpp for Qortino (not in git)
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

After that, `npm run build && npx cap sync android` before each Gradle build picks up web changes.

Your debug APK is signed with Your own debug key, so it can't install over GO from Q-Share.
Use an emulator, a test phone, or uninstall GO first (that removes its data, so back up Your
accounts).

## Tests

```bash
npx vitest run path/to/file.test.ts          # one file, while You work
npm test                                      # everything (CI runs this on every PR)
cd android && ./gradlew testDebugUnitTest     # Java/Kotlin unit tests
for f in android/app/src/test/python/test_*.py; do python3 "$f" || break; done   # Python bridge
```

## Pull requests

- Keep a PR to one change. Say what it fixes or adds and why.
- Say how You tested it: phone model and Android version, or emulator, and which tests You ran.
- Add screenshots or a short screen recording for UI changes.
- CI must pass before a PR is merged.

## License

GPL-3.0, the same as Qortal Hub. By contributing You agree Your work is released under it.
