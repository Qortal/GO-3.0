# GO 3.0 — Native Mobile Qortal Client

**GO 3.0** (Qortal GO) is the native Android port of [Qortal Hub](https://github.com/Qortal/Qortal-Hub)
(GO's work happens on branch `develop`; released versions are on `main`). It wraps the Hub's
React UI in a Capacitor/Android shell and adds a **native Reticulum (RNS) stack on the phone**, giving
mobile users the Hub 2.0 P2P feature set: presence, voice calls, and direct file transfer over
Reticulum — plus a mobile-first UI, OS notifications, biometric login, and battery-conscious
background behavior.

**Repository:** https://github.com/SJQortal/GO-3.0 (pull requests to `develop`), mirrored at https://gitea.qortal.link/simon/GO-3.0 (APK downloads)  
**Current APK:** GO 3.0 **v0.0.20** (`versionName` 0.0.20, `versionCode` 23), a release (non-debuggable) build — shown in-app as **GO version** (Core & settings). Chat engine matches Hub v3.0.3.

> **For Hub developers**
>
> 1. **Chat GIF picker** — copy `src/components/Chat/gifs/` and wire it as described in
>    [`HUB_GIF_PICKER.md`](docs/go/hub-notes/HUB_GIF_PICKER.md). Same QDN pointers GO
>    already sends; Hub should display and send them the same way.
> 2. **Voice + file-transfer interop** — two small Hub-side changes, still required.
>    See [Required Hub changes](#required-hub-changes).
>
> Everything else is wire-compatible with the existing Hub.
>
> Hub v3.0.1 added WebRTC audio (Reticulum fallback), dedicated event links, and
> status/expiry UI. This tree ports those pieces onto the GO mobile shell.

---

## Repository layout

| Path | What it is |
|---|---|
| `src/` | Shared React UI (same codebase as desktop Hub, with mobile components added) |
| `src/bridge/capacitorBridge.ts` | The mobile equivalent of Electron's main-process bridges: installs `window.presence` / `window.call` / `window.groupCall`, presence overlay coordinator, Q-Chat file transfer sender logic |
| `src/plugins/Reticulum.ts` | Capacitor plugin typings for the native Reticulum bridge |
| `src/utils/qchatFileApi.ts` | Unified desktop/mobile Q-Chat file transfer API (desktop → `electronAPI`, mobile → Capacitor) |
| `src/components/Chat/gifs/` | QDN GIF library picker (catalog, cache, masonry, most-used). Hub-portable — see [`HUB_GIF_PICKER.md`](docs/go/hub-notes/HUB_GIF_PICKER.md) |
| `src/components/Mobile/` | Mobile shell: top bar, tab bar, tabs overlay with folders, etc. |
| `src/appUpdate/` | In-app APK updates from Q-Share (`GO 3.0` on QDN) — Android only |
| `android/` | Capacitor Android project |
| `android/app/src/main/java/.../ReticulumPlugin.kt` | Native plugin: Kotlin RNS transport (reticulum-kt) + Chaquopy host for the Python bridge + file staging helpers |
| `android/app/src/main/java/.../QortalForegroundService.java` | Foreground service: persistent status notification, alert/call notifications |
| `android/app/src/main/python/presence_bridge.py` | The full Reticulum protocol bridge (presence, calls, group audio, file transfer) — **shared with desktop**, runs under Chaquopy on Android |
| `electron/resources/presence_bridge.py` | The **desktop copy** of the same bridge — kept in sync |
| `electron/` | Desktop Electron shell |
| `docs/go/` | GO's own docs (widgets guide, app links, payment QR codes); `docs/go/hub-notes/` holds the notes for Hub developers |

## Building the Android app

Prerequisites: Node 22, JDK 21, Android SDK 36 with NDK 27.2.12479018 and CMake 3.22.1,
Python 3.13 on `PATH`. The full list, the branch rules and how to send a pull request are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

```bash
npm ci
android/app/src/main/cpp/fetch-llama.sh   # once: pinned llama.cpp for Qortino
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

APKs for users are release builds (not debuggable), from v0.0.14 on:

```bash
cd android && ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk, published as "GO 3.0 v<versionName>.apk"
app/release-web-assets-test/check-apk.sh app/build/outputs/apk/release/app-release.apk  # must print OK
```

From v0.0.18 every release is also a Gitea release (tag `v<versionName>`) with the APK attached
as `GO-3.0.apk`. Gitea serves the newest release's file at one fixed address, which qortal.dev
links to:

    https://gitea.qortal.link/simon/GO-3.0/releases/download/latest/GO-3.0.apk

Releases must not be marked pre-release or draft: `latest` skips those. The file name must stay
`GO-3.0.apk` in every release, or the fixed address stops working.

Release APKs leave out the web bundle's source maps and the debug-only pages (GO-40);
debug APKs keep them. `assembleRelease` checks the packaged APK itself and fails if a map or a
debug page is still in it; `check-apk.sh` is the same check by hand.

Release builds are much faster on GrapheneOS: it has no ART JIT, and a debuggable app gets
no precompiled code, so a debug build runs all of its Java interpreted there. Use debug builds only
for development (WebView DevTools, `run-as`).

Both build types are signed with the same key (`~/.android/debug.keystore`; keep a backup), so they
install over each other with data kept. Android refuses a lower `versionCode` once a release build is
installed, so raise `versionCode` with every published build and keep debug builds at the same or a
higher one.

The Python bridge (`presence_bridge.py`) and vendored RNS ship inside the APK via Chaquopy; no
on-device Python setup is needed.

## Mobile architecture in one paragraph

The WebView runs the same renderer as desktop Hub. Where desktop talks to Electron's main process
(`window.electronAPI`, IPC to `reticulum-daemon.ts`), mobile installs equivalent bridges from
`capacitorBridge.ts` that talk to `ReticulumPlugin.kt`, which hosts the *identical*
`presence_bridge.py` in an embedded CPython (Chaquopy). Commands flow as JSON frames
(`presenceCommand` with request/response correlation); events stream back over a single `presence`
listener. The result: the phone speaks the exact same RNS wire protocol as the Hub — same presence
envelopes, same call signaling, same `QGAU` audio framing, same `QGCCTL1` link auth, same file
transfer Resources.

## Feature status (mobile ↔ Hub interop)

| Feature | Status |
|---|---|
| Presence (announce/heartbeat over RNS overlay) | ✅ Works both ways |
| Q-Chat (blockchain chat) | ✅ Works |
| Voice calls **Hub → mobile** | ✅ Works — two-way audio over verified RNS link |
| Voice calls **mobile → Hub** | ⚠️ Blocked by a Hub-side ordering precondition — see [Hub change #1](#1-voice-calls-admit-verified-link-auth-joins) |
| Q-Chat file transfer **mobile → Hub** | ✅ Works (mobile sender has the robustness fixes) |
| Q-Chat file transfer **Hub → mobile**, large files | ⚠️ Reliable only after the Hub ships [Hub change #2](#2-file-transfer-ship-the-updated-presence_bridgepy) |
| OS notifications (PM summary + sender avatar), biometric login, mobile tabs/folders | ✅ Mobile-only features |
| Chat GIF library (QDN `gif-` IMAGE pointers) | ✅ Works on GO. Hub: copy picker + send/render — [`HUB_GIF_PICKER.md`](docs/go/hub-notes/HUB_GIF_PICKER.md) |
| In-app APK updates from Q-Share | ✅ Mobile-only (checks `GO 3.0` on QDN) |
| GO version in Core & settings | ✅ Matches `versionName` / this APK |

---

## Release history

Every field build is published on Q-Share (Q-Share+ from v0.0.13) under the name
`GO 3.0`, and the in-app updater offers it from there. Details are in
[`CHANGELOG.md`](CHANGELOG.md).

| Version | What landed |
|---|---|
| **v0.0.2** | Chat reply/draft fixes, Q-Manager file save, SSH-tunneled local nodes, group overlays / calendar |
| **v0.0.3** | Compact composer (staged grow, fade-in send, emoji panel in the keyboard slot), unlock/stability fixes, first in-app updater |
| **v0.0.4** | Updater finishes after the Android install permission; large Q-Share saves no longer crash; QDN download progress notifications |
| **v0.0.5** | Chat GIF library (search, categories, most-used, masonry, queued cache); settings label is **GO version** and matches the APK |
| **v0.0.6** | First-session chat sync, faster unlock (HD off the UI thread), QDN downloads on a remote core, login runtime overlay |
| **v0.0.7** | Live group catch-up, own messages to Hub, Reticulum “online” only with real peers |
| **v0.0.8** | Hub 3.0.3 chat engine, DMs with Hub, SQLite crash recovery, 30 app tabs |
| **v0.0.9** | Faster / more reliable DMs with Hub (retry undelivered messages, skip stale notifies) |
| **v0.0.10** | Battery (one Reticulum stack, phone as leaf, idle timers), GrapheneOS chat, group/Saved Messages sync, multiple saved private nodes |
| **v0.0.11** | Notification sync with Hub, in-app file viewer, Torq posting from Home, upload while compressing, attachment fixes, Saved Messages after restart, safer foreign-coin keys |
| **v0.0.12** | Q-Apps library: truthful Open/Download, Featured top-rated Community and category apps with gold stars, best rated first, phone list layout; chat diagnostics and send-failure reasons; download progress and saved files in the bell, notification history; Tabs and library tabs open again; swipe away notifications; saving on Android 8/9 |
| **v0.0.13** | Background sync (Off / While charging / Always), DMs handed to your own Hub, DM delivery status, honest status notification, 7-day DM retries, GrapheneOS group-chat fix, Updates screen via Q-Share+ |
| **v0.0.14** | First release (non-debuggable) build: fast login on GrapheneOS, one key derivation per unlock, chat starts after login, node-check timeouts, unlock timings in diagnostics, bottom bar hides while typing, faster Qortino offline assistant |
| **v0.0.15** | Security and privacy release (Capacitor CVE fix, origin guard, Q-Apps limited to the node, screen protection, no Google code, no location in shared media, no tracking images); Telegram-style message popup, chat text size Small/Default/Large, truthful DM delivery ticks with 7-day re-send, no more "protocol violation" from desktop Hubs, status synced across devices, wallet key check at unlock, avatar/icon cache |
| **v0.0.16** | Chats open with their messages (recent chats read ahead in memory only, names at once), the first tap after a swipe works, share into GO Groups / DMs / Saved Messages from other apps, swipe between Home, Apps and Chat, immersive mode, Torq-first Home, DM search, Tabs swipe to close, no more black flashes; updates linked in Q-Share again |
| **v0.0.17** | Sync on slow phones: background gap bookkeeping cut to a few ms, no endless equal-head repairs, sends no longer wait on the node for Your own membership, retried sends no longer fail as "Invalid event", "Invalid Data" rows heal; delivery ticks for group posts, reply image thumbnails, channel pick when sharing, QDN publish bubble, private Q-Apps on public nodes, landscape and tablet layout; much richer Copy diagnostics |
| **v0.0.18** | Qortal Card (testing, off by default): tap-to-pay with Qortal test cards and between two GO phones over NFC; Dev Mode for trying a Q-App .zip before publishing; drafts kept per channel, chats come back in their channel with their text; Home/Apps/Chat buttons step aside for the channel list and in-chat search; drag apps out of an open folder; no chat jump near group invites; no false "apikey invalid" on public nodes; Torq notifications open Torq. First build with a fixed Gitea download link |
| **v0.0.19** | Voice calls work: 1:1 and group calls with Hubs and GO phones on the Hub's own call code, direct WebRTC with Reticulum fallback (never local addresses; "Private" keeps calls on Reticulum), ringing and lock-screen answer, earpiece, speaker and headsets; widgets screen left of Home; rearrange the Home/Apps/Chat buttons; "public node unavailable" window; Enter makes a new line in chats; channels keep loading after long use; crash-safe, faster chat database (WAL); faster start (no game engine at boot, no endless logo); bottom of lists tappable with 3-button navigation; sharing into GO with a window open; private nodes on the network ask for their API key |
| **v0.0.20** | Qortino AI: new Qwen3 4B model (offline, works on older phones and 16 KB-page phones), about 5,000 curated answers, download on the public node too (resumes past 1 GB, runs in the background), settings, New chat, talks and an Ask box on Home; widgets kept on the phone and ready when you swipe to them; Q-Apps no longer stuck on the node loading page; smoother Tabs; Kick/Ban only for the group owner; muted groups stay quiet; GO also uses the `reticulum3` hub; other devices stop ringing when one answers a GO call; APK about a third smaller |

---

## Required Hub changes

### 1. Voice calls: admit verified link-auth joins

*(See `docs/go/hub-notes/MOBILE_VOICE_HUB_DEV_NOTE.md` in this repo for the full write-up.)*

**Symptom:** Hub → mobile calls connect with clean two-way audio. Mobile → Hub calls stay on
"connecting…" on the Hub and drop after a few seconds — even though the phone sends the exact same
signed link auth the Hub accepts in the other direction.

**Root cause (traced in `electron/src/group-call.ts`):** it is *not* a protocol or signature
problem — the `GC_JOIN` verifies. It's an ordering precondition:

- The audio-link owner is chosen by address ordering (`isLocalAddressReticulumAudioLinkOwner`),
  not by who placed the call.
- Inbound link audio is dropped unless the link is marked verified (`audio-unverified-address`).
- `applyVerifiedReticulumLinkAuthJoin` only marks a link verified **if the sender is already in
  `room.participants`** at that instant.

When the phone initiates, its verified link-auth `GC_JOIN` arrives *before* the Hub has registered
the caller as a participant, so the Hub closes the link (`link-auth-no-participant`), drops the
audio, and never leaves "connecting". In the Hub-initiated direction the participant state is
already in place, so the identical handshake succeeds.

**The change:** in `applyVerifiedReticulumLinkAuthJoin`, when the signed `GC_JOIN` **verifies** and
the sender is a valid Qortal member of the call, **admit the participant from the verified join**
instead of bailing with `link-auth-no-participant`. The verified join is itself authenticated proof
of membership (Ed25519 over `buildGcJoinSignedFields`, already checked), so this removes the race
without weakening security. No changes to wire format, audio framing, signing, key delivery, or the
link-owner rule; Hub-initiated calls are unaffected.

### 2. File transfer: ship the updated `presence_bridge.py`

**Symptom:** large transfers (e.g. ~80 MB Hub → mobile) stall at exactly the first window of
parallel chunks (8 × 1 MB) and the retry restarts from zero.

**Root cause:** the per-chunk `QCHAT_FILE_CHUNK_ACK` is a single link packet with no retry. Under
congestion a lost ACK caused:

1. the sender's 90 s ACK timeout to **fail the whole transfer** — and the un-ACKed chunk was never
   re-queued (`next_chunk_index` had already advanced → permanent hole in the file);
2. dead links were never replaced, so the 8-link pool only shrank;
3. re-accepting restarted the download from byte 0 (and could never fill the holes anyway).

**The change (already implemented in this repo's `electron/resources/presence_bridge.py`,
mirrored in the Android copy):**

- **`retry_chunks` queue** on the send root — an ACK timeout or mid-chunk link failure re-queues
  the chunk (consumed with priority by `_start_qchat_file_resource_for_state`) and emits
  `retrying` instead of `failed`; only the suspect link is torn down.
- **Receiver link reopen** — `on_qchat_file_link_closed` opens a replacement link while a receive
  is pending (the receiver is the link initiator; bounded by
  `_QCHAT_FILE_RECEIVER_MAX_LINK_REOPENS = 64`).
- **Resume** — the receiver persists a `<savePath>.part.meta` ledger (transferId, size, sha256,
  completed chunks) per chunk; a re-accept preloads it and resumes instead of restarting. The meta
  is removed on completion, and both `.part` and meta are discarded on a final hash mismatch.

**What to do:** include this file in the next Hub release — nothing else changes. No new packet
types; fully wire-compatible with old peers. The sender-side re-queue is the critical half, so
Hub → mobile transfers of large files only become reliable once the Hub ships it.

---

## Mobile-specific work in this fork (overview)

- **Q-Chat file transfer on mobile:** native file staging (`qchatFilePrepare` copies content://
  URIs to app cache + SHA-256), auto save paths, export of completed downloads to public
  Downloads (MediaStore), an **Open** button on received files, renderer-side Ed25519 verification
  of downloader link auth, pending-send persistence across app restarts.
- **Notifications:** single in-place-updating direct-message summary notification
  ("You got N messages from X and Y") with the sender's avatar (fetched in the WebView and passed
  as a data URL — node MIME quirks and OEM skin differences handled), MIUI-aware status
  notification branding, in-app Qortino notifications with auto-dismiss countdown.
- **Performance/battery:** deduped + rate-limited foreground service updates (was ~7 native
  calls/s, now ≤0.2/s), in-memory cache for hot secure-storage keys (−73% bridge reads),
  visibility-aware polling (Reticulum status, balance, dashboard), WASM bcrypt wallet KDF
  (verified byte-identical to bcryptjs), lazy i18n locales (EN + active language only), avatar
  fetch outcome caching.
- **Mobile UX:** tab bar + tabs overlay with folders, app library list layouts, biometric unlock
  flow (no keyboard pop on autofill), blocked-accounts flows for public/private nodes, Android
  back-button handling, DM voice call UI, drag-to-reorder accounts (long-press lift with
  neighbour slide animation, portrait + landscape, phones + tablets).
- **Payments:** `qortal://pay?…` / `qort:` deep links and payment QR codes open the app straight
  to a pre-filled Send screen; a de-Googled in-app QR scanner (`getUserMedia` + `jsQR`, no Play
  Services) reads payment and address QRs. See
  [`docs/go/PAYMENT_QR_CODES.md`](docs/go/PAYMENT_QR_CODES.md).
- **Chat GIF library:** emoji button also opens a QDN GIF picker (`gif-` IMAGE resources).
  Search, tag chips, most-used, masonry layout, queued/cached loads. Sent as a QDN pointer,
  not a mesh file. Hub port: [`HUB_GIF_PICKER.md`](docs/go/hub-notes/HUB_GIF_PICKER.md).
- **In-app updates:** watches Q-Share publications under the `GO 3.0` name, shows notes +
  progress, and hands the APK to Android's installer.
- **GO version:** Core & settings shows the same `versionName` as the installed APK.

See [`CHANGELOG.md`](CHANGELOG.md) for a version-by-version summary of changes.

## Upstream

Forked from [Qortal/Qortal-Hub](https://gitea.qortal.link/Qortal/Qortal-Hub) — see that repo for
the desktop Hub documentation, i18n guidelines (`docs/i18n_languages.md`), and development docs
(`docs/development.md`). License: GPL-3.0 (unchanged).
