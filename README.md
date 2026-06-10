# Qortal GO 2.0 — Native Mobile Qortal Client

**Qortal GO 2.0** is the native Android port of [Qortal Hub](https://github.com/Qortal/Qortal-Hub)
(this repo is a fork of `Qortal/Qortal-Hub`, branch `feature/qortal-go-mobilize`). It wraps the Hub's
React UI in a Capacitor/Android shell and adds a **native Reticulum (RNS) stack on the phone**, giving
mobile users the Hub 2.0 P2P feature set: presence, voice calls, and direct file transfer over
Reticulum — plus a mobile-first UI, OS notifications, biometric login, and battery-conscious
background behavior.

> **For Hub developers:** two small Hub-side changes are needed for full mobile ↔ Hub interop.
> Both are described in [Required Hub changes](#required-hub-changes) below. Everything else is
> wire-compatible with the existing Hub.

---

## Repository layout

| Path | What it is |
|---|---|
| `src/` | Shared React UI (same codebase as desktop Hub, with mobile components added) |
| `src/bridge/capacitorBridge.ts` | The mobile equivalent of Electron's main-process bridges: installs `window.presence` / `window.call` / `window.groupCall`, presence overlay coordinator, Q-Chat file transfer sender logic |
| `src/plugins/Reticulum.ts` | Capacitor plugin typings for the native Reticulum bridge |
| `src/utils/qchatFileApi.ts` | Unified desktop/mobile Q-Chat file transfer API (desktop → `electronAPI`, mobile → Capacitor) |
| `src/components/Mobile/` | Mobile shell: top bar, tab bar, tabs overlay with folders, etc. |
| `android/` | Capacitor Android project |
| `android/app/src/main/java/.../ReticulumPlugin.kt` | Native plugin: Kotlin RNS transport (reticulum-kt) + Chaquopy host for the Python bridge + file staging helpers |
| `android/app/src/main/java/.../QortalForegroundService.java` | Foreground service: persistent status notification, alert/call notifications |
| `android/app/src/main/python/presence_bridge.py` | The full Reticulum protocol bridge (presence, calls, group audio, file transfer) — **shared with desktop**, runs under Chaquopy on Android |
| `electron/resources/presence_bridge.py` | The **desktop copy** of the same bridge — kept in sync; contains the file-transfer fixes the Hub needs to ship |
| `electron/` | Desktop Electron shell (unchanged upstream behavior, plus the bridge fix) |

## Building the Android app

Prerequisites: Node 20+, Android SDK (API 34), JDK 17.

```bash
npm install
npx vite build && npx cap copy android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

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

---

## Required Hub changes

### 1. Voice calls: admit verified link-auth joins

*(See `MOBILE_VOICE_HUB_DEV_NOTE.md` in this repo for the full write-up.)*

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
  back-button handling, DM voice call UI.

## Upstream

Forked from [Qortal/Qortal-Hub](https://gitea.qortal.link/Qortal/Qortal-Hub) — see that repo for
the desktop Hub documentation, i18n guidelines (`docs/i18n_languages.md`), and development docs
(`docs/development.md`). License: GPL-3.0 (unchanged).
