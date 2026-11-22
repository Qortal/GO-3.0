## What and why

<!-- What does this PR change, and why? Link the issue if there is one. -->

## How it was tested

<!-- Phone model and Android version, or emulator. Which tests You ran. Screenshots for UI changes. -->

## Checklist

- [ ] The PR is against `develop`.
- [ ] Still works with unmodified desktop Hubs (anything sent over Reticulum or QDN stays compatible).
- [ ] New user-visible text goes through i18n, in all 12 languages.
- [ ] `CHANGELOG.md` has a line under `[Unreleased]` if users will notice the change.
- [ ] No keys, tokens, wallet files, node API keys or personal data in the diff.
- [ ] If You changed **decentralized STUN** logic: both `electron/src/stun-bootstrap.ts` and `src/lib/webrtc/stunBootstrap.ts` are updated together, and `npm test` passes.

See `CONTRIBUTING.md` for the build setup and the rules.
