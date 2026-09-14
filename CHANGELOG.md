# Changelog

All notable changes to the **Qortal GO** fork of Qortal Hub are documented here.

Qortal GO is the Android (Capacitor) build of Qortal Hub. Entries marked
_mobile_ apply only to the Android app; entries marked _shared_ also affect the
desktop Hub. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.0.8] — 2026-09-14 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.8** (`versionName` 0.0.8, `versionCode` 11).

### Added

- **Hub 3.0.3 chat engine** _(mobile)_ — GO now runs the same Reticulum chat
  engine as current Hub: author-manifest group history repair, coordinated
  digest repair, and dedicated DM / group delivery paths instead of the
  older Hub-push / live-catch-up experiment.
- **More app tabs** _(mobile)_ — you can keep up to 30 Q-App / browser tabs
  open (was 10).

### Fixed

- **Direct messages with Hub** _(mobile)_ — DMs sent on the phone now show
  on your Hub, and Hub DMs sync back. GO introduces itself on overlay
  links (`hello` + identity), pulls missed pages from your other devices,
  and no longer drops `dm_notify` when its own peer hash is not ready yet.
- **Chat radio congestion** _(mobile)_ — DM control and DM page traffic
  have their own lanes; a full command queue reports back instead of
  silently stalling the mesh.
- **“GO runtime error” / SQLite crash** _(mobile)_ — a damaged chat-index
  (`SQLITE_CORRUPT_INDEX`) no longer paints the full-screen error after
  login. Indexes are rebuilt in place; if the file is beyond repair it is
  discarded and chat history is pulled again from peers. Worker faults no
  longer take down the whole app.

---

## [0.0.7] — 2026-08-18 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.7** (`versionName` 0.0.7, `versionCode` 10).

### Fixed

- **Live group chat catch-up** _(mobile)_ — notices from other people often arrived
  immediately, but the message body could sit for minutes because GO kept asking
  only your remembered Hub peer. If that link hung or a history page was treated
  as in-flight for two minutes, catch-up returned without asking anyone else.
  GO now fails over after ~20s, treats an active history page as stale after 8s,
  still sends `feed_req` when a page is backed off, and pulls from the notice
  source as well as Hub. Other-user messages that took 3–8 minutes now land in
  a few seconds when a peer can serve them.
- **Own messages to Hub** _(mobile)_ — a reply sent on GO could take minutes to
  appear on the same-account Hub because GO announced the message before the
  body was offered, and Hub then tried to pull the body from the phone. GO now
  pushes the event page to your other endpoint first, copies it to a few
  connected peers, and only then announces. Typical delay is under a minute.
- **Reticulum “online” status** _(mobile)_ — the tray and top badge no longer
  show online unless at least one Qortal account is actually seen on the mesh
  (`onlineCount > 0`) and the device has a network path.

---

## [0.0.6] — 2026-08-15 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.6** (`versionName` 0.0.6, `versionCode` 9).

### Fixed

- **First-session chat sync** _(mobile)_ — after a password unlock, GO could sit off
  the live mesh until the APK was killed. Overlay recovery no longer burns its
  retry on an empty subscription set; memberships reannounce once groups exist;
  identity/`ready` is pushed until the chat worker acks. Failed mesh fanout is
  no longer reported as success, so queued sends retry.
- **Unlock stall** _(mobile)_ — home still appears after QORT keys, but BTC/LTC/
  DOGE/DGB/RVN/ARRR HD derivation now runs in a Web Worker so subscribe and
  chat signing are not blocked for 15–30s on the UI thread.
- **QDN downloads on a remote core** _(mobile)_ — path segments are encoded,
  empty `apiKey` is omitted, and native download uses `X-API-KEY`. Waiting for
  a QDN resource no longer depends on a WebView `fetch` that CORS-blocks remote
  nodes. Tray errors include the HTTP status.
- **Runtime overlay after login** _(mobile)_ — `reticulumChat:resource:bytes timed
  out` is ignored (the old regex missed the colon). Chat image `getUrl` failures
  no longer become an unhandled rejection / white screen.
- **Remote-core group validate** _(mobile)_ — membership checks send the API key;
  own publishes fail open to local group IDs if the node does not answer.

---

## [0.0.5] — 2026-08-14 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.5** (`versionName` 0.0.5, `versionCode` 8). First
Gitea push of everything since v0.0.1 (`0bb0c74a`, 2026-08-09).

### Added

- **Chat GIF library** _(shared)_ — emoji picker gains an Emojis / GIFs switch. GIFs
  come from the community QDN library (`IMAGE` / `gif-` prefix, `qortal://APP/GIFs/`).
  Search and tag chips filter a cached catalog; a most-used row is stored on device;
  the grid is a 3-column masonry that keeps each GIF's real shape. Selecting a GIF
  attaches a QDN pointer (`libraryGif: true`), not a file over the mesh. Hub port:
  [`HUB_GIF_PICKER.md`](HUB_GIF_PICKER.md).
- **Queued GIF media cache** _(shared)_ — at most two concurrent node fetches, memory
  + IndexedDB, in-view lazy load, prefetch of most-used tiles.
- **GO version in Core & settings** _(mobile)_ — the old “UI version” label is now
  **GO version** and reads `GO_VERSION` from `src/appVersion.ts`, kept identical to
  Android `versionName`.

### Fixed

- **GIF search stall** _(shared)_ — long result lists no longer stop fetching after
  two or three tiles.
- **Emoji / GIF keyboard handoff** _(mobile)_ — switching tabs does not open the
  keyboard by itself; tapping the composer after GIF search closes the panel instead
  of leaving it behind the keyboard.
- **GIF load crash** _(mobile)_ — cancelled off-screen fetches no longer surface as
  an unhandled rejection / full-screen runtime error.

---

## [0.0.4] — 2026-08-13 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.4** (`versionName` 0.0.4, `versionCode` 7).

### Added

- **In-app updates end to end** _(mobile)_ — a newer `GO 3.0` APK on Q-Share appears
  in the notification bell, downloads over QDN with live progress, and opens
  Android's installer. Checks on startup and every six hours.
- **QDN download progress notifications** _(mobile)_ — “Gathering from QDN” then
  “Saving” with a megabyte count, for Q-Share, chat attachments, and other QDN saves.

### Fixed

- **Install permission handoff** _(mobile)_ — after Android's “allow installs from
  GO” toggle, returning to the app continues the installer instead of staying on
  “Open settings”.
- **Large Q-Share / QDN saves** _(mobile)_ — big files are streamed to storage
  instead of being base64-chunked through the WebView (that path could OOM and
  close the app).
- **Leave-chat mid-send crash** _(mobile)_ — navigating away while a send was still
  in flight no longer crashed if that send then failed.

---

## [0.0.3] — 2026-08-13 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.3** (`versionName` 0.0.3, `versionCode` 6).

### Added

- **Compact chat composer** _(mobile)_ — staged height growth, fade-in send button,
  full-width expanded composer, emoji panel in the soft-keyboard slot (smiley
  swaps the two keyboards instead of stacking them).
- **In-app update watcher** _(mobile)_ — first version that can notice a newer
  Q-Share build and download/install it.

### Fixed

- **Composer keyboard** _(mobile)_ — scrolling a chat, removing an attachment, or
  changing expiry no longer dismisses the keyboard; it returns after a file pick.
- **Unlock after screen-off** _(mobile)_ — turning the screen on during a fingerprint
  scan no longer left a blank window.
- **Launch freeze / long-session black screen** _(mobile)_ — background loop that
  was burning CPU after a minute or two.

---

## [0.0.2] — 2026-08-10 (GO 3.0)

Internal field build **GO 3.0 v0.0.2** (`versionName` 0.0.2, `versionCode` 4). Follows the
v0.0.1 Gitea / desktop APK baseline with chat reliability and mobile UX fixes.

### Fixed

- **Group reply sends** _(mobile)_ — replies no longer publish multiple times from double-taps
  or aggressive queue retries; reply quote previews render once.
- **Reply composer top bar** _(mobile)_ — Reticulum compose no longer steals the search bar and
  leaves a blank grey strip while replying.
- **Chat draft leakage** _(mobile)_ — unsent drafts stay in their own group/DM; switching chats
  clears or restores the correct composer text.
- **Q-Manager / chat file save** _(mobile)_ — saving shared chat files no longer fails silently
  on null filenames or large writes.
- **Long-open chat runtime fault** _(mobile)_ — `reticulumChat:getHistory` timeouts no longer
  surface as a full-screen “GO runtime error”.
- **SSH-tunneled local nodes** _(mobile)_ — `https://localhost:port` is normalized to HTTP outside
  Electron so plain-HTTP tunnels work without a TLS handshake failure.
- **Group overlays / About Group / calendar empty state** _(mobile)_ — About Group opens reliably;
  exclusive Search/Admins/Members/Files/Calendar overlays; calendar empty weeks fit the viewport.

---

## [0.0.1] — 2026-08-09 (GO 3.0)

Internal baseline pushed to Gitea as **GO 3.0 v0.0.1** and packaged as the desktop `GO-3.0.apk`.

---

## [3.0.0] — Unreleased (GO 3.0 product line)

Current Android product line branded **GO 3.0**. Continues the Qortal Hub
mobile fork with Reticulum chat, group UI, calendar, and branding updates.

### Added

- **Payment QR codes & deep links** _(shared)_ — scanning a Qortal payment QR
  or opening a `qortal://pay?recipient=<address|name>&amount=<qort>` link now
  opens Qortal GO directly on the **Send QORT** screen, pre-filled with the
  recipient and amount. The user only confirms with their wallet password.
  Also accepts `qortal://send?to=…`, BIP21-style `qort:<address>?amount=…`,
  `qortal://<address>`, and bare addresses (via the in-app scanner). Recipient
  aliases: `recipient|to|address|r`; amount aliases: `amount|qty|qort|value`.
  See [`docs/PAYMENT_QR_CODES.md`](docs/PAYMENT_QR_CODES.md) for the full
  developer guide.
- **In-app QR scanner** _(mobile)_ — a full-screen camera scanner built purely
  in JavaScript (`getUserMedia` + `jsQR`), with **no Google Play Services / ML
  Kit dependency**, in keeping with the community's de-Googled stance. Reachable
  from **Send QORT → the QR icon** in the *To* field.
- **Scanned-recipient name badge** _(shared)_ — when a scanned address has a
  primary registered name, it is shown in green next to the *To* field.
- **Account reordering in "Enter Qortal"** _(mobile)_ — long-press an account to
  lift it, then drag to reorder. Neighbouring rows now slide out of the way with
  a smooth animation, and the gesture works in both portrait and landscape and
  across phones and tablets (all geometry is measured live, nothing hard-coded).

### Changed

- **Top account auto-opens on reopen** _(mobile)_ — the account at the top of
  the "Enter Qortal" list is the one unlocked when the app is reopened: it prompts
  biometric if that account has it enabled, otherwise it shows the password
  window. The early launch-time fingerprint sheet is re-armed to follow whichever
  account currently sits at the top.
- **Full address fits the Account Overview** _(shared)_ — the revealed Qortal
  address auto-fits its container (dynamic font sizing) so the whole address is
  visible without truncation or horizontal scrolling, and the tap-to-reveal
  animation is preserved.

### Fixed

- **Biometric unlock reliability** _(mobile)_ — tapping the fingerprint icon now
  reliably triggers the OS prompt. A native watchdog detects a stalled early
  prompt and forces a fresh `BiometricPrompt`; a single-active-prompt guard
  removes the double-prompt and the "cancel re-opens the sheet" behaviour; and a
  successful unlock no longer bounces back to the "Enter Qortal" list.
- **Busy-overlay tap-through** _(mobile)_ — taps on the "unlocking…" overlay no
  longer fall through to the controls behind it.

---

## [2.0] — 2026-06-11 (Qortal GO mobilization)

The earlier GO 2.0 line (superseded by GO 3.0): turning Qortal Hub into a fully-featured Android
app while keeping the desktop Hub in sync. Highlights, newest first:

### Added

- **Voice calls on mobile** _(shared)_ — group/direct voice calls over
  Reticulum, a persistent mobile in-call bar, and multi-device ("dual-ring")
  incoming-call support so a call rings on Hub **and** GO for the same account.
  (`4e20cc0f`)
- **QDN file save on mobile** _(mobile)_ — native "Save to Documents" for files
  published through QDN / Q-Share, using a native `FileWriter` plugin.
  (`4e20cc0f`)
- **Node connection settings** _(mobile)_ — clearer display of local vs. public
  gateway nodes; local Core is correctly shown as private. (`4e20cc0f`)
- **Reticulum file transfer & notifications** _(mobile)_ — Android shell with
  Reticulum-based transfer and local notifications. (`14244429`)
- **Biometric unlock & transfer notifications** _(mobile)_ — hardened biometric
  wallet unlock plus notifications for incoming transfers, with mobile UI polish.
  (`d4ca8928`)

### Fixed

- **Reticulum presence reliability on Android** _(shared)_ — announce retries,
  heartbeat-failure re-announce, a native foreground-service presence tick, and
  periodic re-fanout of the last signed presence wire, so peers stay visible in
  both directions. (`0a475a37`)
- **Voice bridge audio bugs** _(shared)_ — fixed dropped inbound audio
  (`UnboundLocalError`), overlay links misclassified as non-audio, stale-link
  outbound send failures, and an unbounded link-establish retry loop. (`4e20cc0f`)

### Notes

- Upstream Hub (Electron) merge guidance for the voice / presence / dual-ring
  work lives in [`HUB_DEV_NOTES.md`](HUB_DEV_NOTES.md). (`b06a2794`)

---

_For releases before the Qortal GO fork, see the upstream
[Qortal Hub](https://github.com/Qortal/qortal-hub) history._
