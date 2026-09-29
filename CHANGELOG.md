# Changelog

All notable changes to the **Qortal GO** fork of Qortal Hub are documented here.

Qortal GO is the Android (Capacitor) build of Qortal Hub. Entries marked
_mobile_ apply only to the Android app; entries marked _shared_ also affect the
desktop Hub. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.0.11] — 2026-09-29 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.11** (`versionName` 0.0.11, `versionCode` 14).

### Security

- **Foreign-coin private keys are no longer sent to nodes that should not
  see them** _(mobile)_ — sending LTC/BTC/DOGE/DGB/RVN/ARRR, creating a
  trade buy order and the ARRR seed paths hand the coin's private key to the
  node. That is now blocked outright for public Qortal nodes and for plain
  HTTP (loopback and Tailscale addresses excepted). A remote node you run
  yourself needs a tick-box confirmation that names the host, and the public
  node trade proxy shows a similar warning. Translated into all 12
  languages.

### Added

- **Post to Torq from Home** _(mobile)_ — the Home composer has a
  Quitter / Torq toggle (remembered). Torq mode publishes the same post
  Torq itself does: formatted text (Enter makes a new paragraph), up to 10
  images, up to 4 GIFs from the chat GIF picker, a poll with 2–6 choices
  (optionally anonymous), and file attachments up to 2 GB listed in the
  Q-Share catalog. Posts that Quitter cannot show fully get a link to the
  Torq post. Quitter mode suggests Torq for the extra features.
- **Video uploads while it compresses** _(mobile)_ — press Publish during
  compression and the finished 5 MB chunks of the video are sent to the node
  straight away; only the header and any chunk that changed are sent at the
  end, so a long video is mostly uploaded by the time compression finishes.
- **Home composer translated** _(mobile)_ — every label, progress line and
  error in the Quitter/Torq composer is now translated into all 12
  languages (it was English only).
- **Import your Hub dashboard into the tab folders** _(mobile)_ — a new
  button next to "New folder" in the tabs overview reads the pinned apps
  your Hub saved to QDN for this account and puts them into a folder named
  "Hub".
- **Tap your name to see your address** _(mobile)_ — on Home, Account
  Overview, tapping the account name shows the full address, sized to fit
  with no ellipsis; tap again for the name. Copy stays available.
- **Notification settings follow you between Hub and GO** _(shared)_ —
  Q-app/website notification state (subscription rules registered with
  `NOTIFICATION_ADD`, per-app permission grants and revokes, per-app
  "disable OS push", the Q-Chat mention-alert toggle, the "seen all"
  timestamp and per-notification seen marks) is now mirrored between the
  account's own devices over Reticulum. The chat engine gained a generic,
  account-signed device-state store (`device_state` / `device_state_ack` /
  `device_state_req`, advertised by the optional hello feature `ds1`, so
  peers without it still pair): values up to 2 KiB, chunked when they do not
  fit one frame, strict last-writer-wins on the signed time, tombstones for
  removals, per-peer acknowledgements so replay only sends what the other
  device has not confirmed, pending rows that survive restart, a one-shot
  catch-up request when a device kept its identity but lost its database,
  and hourly pruning of expired rows. Records are accepted only from
  verified own-device endpoints. The renderer publishes only real local
  changes, applies remote records in permission → rule → OS-push →
  mentions → seen-all → seen-key order (seen-all takes the larger value,
  seen marks keep their original time), reconnects the notification socket
  when a grant arrives, and shows a one-time "settings arrived from your
  other device" notice. Device-wide preferences (`disable-push-notifications`)
  and the legacy on-chain muted-groups path stay local.
- **"Synced across your devices" row in the notification settings**
  _(shared)_ — the notifications dialog explains what is shared and shows a
  live status: Reticulum chat disabled, waiting for the chat engine, ready
  but no other device online, other device online but without notification
  sync, or linked with N devices. The dialog also refreshes its lists when a
  remote change lands while it is open.
- **Tray alerts for a DM or mention clear once you read it elsewhere**
  _(mobile)_ — a Reticulum DM or group-mention alert delivered on the phone
  is cancelled when the conversation's synchronized unread count or mention
  count reaches zero, for example after reading it on Hub. Only alerts this
  device actually showed are touched; missed-call and calendar alerts are
  unchanged. Desktop closes its matching `Notification` the same way.
- **Stable alert ids** _(mobile)_ — each DM (`reticulum-dm:<peer>`) and
  mention (`reticulum-mention:<groupId>`) alert now has a stable tag and id,
  so a repeat alert for the same conversation updates one tray entry instead
  of stacking, and a cancel targets exactly that entry
  (`NotificationManager.cancel(tag, id)` from the plugin, with no
  background service start).
- **Tap a DM or group alert to open it** _(mobile)_ — the alert bridge now
  handles `direct` and `group` alerts: a DM alert opens that conversation, a
  mention alert opens the group chat.

### Changed

- **Video compression quality** _(mobile)_ — the native compressor used to
  guess a clip's length, so "High" landed on the 1 Mbps floor. It now gets
  the real duration: High encodes at about 2.2 Mbps, and videos come out
  sharper and roughly twice as large as before.
- **5 MB post limit checked before publishing** _(mobile)_ — Quitter never
  shows a post of 5 MB or more. Images are shrunk to fit that budget, and a
  post that still does not fit is stopped with an explanation instead of
  being published invisibly.
- **Share/copy link of an app tab follows the page you are on**
  _(mobile)_ — the top-bar link now points at the page the Q-App is showing
  (for example a single Torq post), not just the app's start page.
- **Phone keeps a link slot free for your own Hub** _(mobile)_ — the
  Reticulum bridge reserves an inbound overlay slot for your own devices, so
  Saved Messages and notification sync are not locked out when the phone's
  link slots are full of other peers.
- **Faster start** _(shared)_ — a chat database step that rewrote the
  attachment index on every start (~250 ms on a phone, much longer with
  WebView JIT off) now runs once per database.
- **GrapheneOS hint corrected** _(mobile)_ — WebView JIT is on by default on
  GrapheneOS; the hint and comments no longer claim it is off by default.

### Fixed

- **Saved Messages dead after a phone restart** _(shared)_ — after a
  restart, messages to your own devices could fail for 25+ minutes and
  messages sent from Hub in the meantime never arrived. The phone now
  re-pins its own device before the handshake, pulls the self conversation
  with a 48-hour look-back and merges both sides, so Saved Messages work
  about 90 s after a cold start and missed messages come back within seconds
  of unlocking.
- **Non-image files could not be sent from the phone** _(mobile)_ —
  attaching a PDF, zip or any other non-image file to a DM, group or Saved
  Messages did nothing (the mobile file import was a stub). Fixed.
- **Files over 1 MB failed with "Verification failed"** _(mobile)_ — the
  phone hashed large files incorrectly, so every download over 1 MiB was
  rejected and a large file sent from GO carried a wrong hash nobody could
  verify. A 5 MB file now transfers and verifies both ways.
- **Settings unusable on phones** _(mobile)_ — the settings dialog used the
  desktop two-column layout, which clipped every card. It is now
  full-screen with a scrollable tab strip on phones.
- **Avatar picker opened below the screen** _(mobile)_ — the Choose and
  Publish buttons could end up off-screen, especially on new accounts. The
  panel now stays on screen and scrolls if needed.
- **Auto-lock timeout could not be changed on the phone** _(mobile)_ — the
  choice is now saved and used by the idle lock.
- **Text showing as raw keys** _(mobile)_ — "Home.group_activity", the
  tutorial titles and two chat/minting error messages showed their
  translation key instead of text.
- **Bottom padding with 3-button navigation** _(mobile)_ — chat composers,
  settings, the apps library and Q-Land now leave room for the Android
  navigation bar.
- **Video post fixes** _(mobile)_ — a video the picker reported as 0 bytes
  was always uploaded uncompressed, and a failed compression blocked the
  next Publish.
- **Featured Q-Apps** _(mobile)_ — the reduce-motion (eye) button no longer
  overlaps the subtitle.

- **GrapheneOS: healthy Reticulum badge but chat never fetches**
  _(mobile)_ — the top-bar pill reports hub/radio status, not the chat
  engine. On Vanadium with WebView JIT off, control signatures
  (history pages, `group_sub`, DM probes) were given only 10 s and
  silently dropped, then a timed-out history read was shown as an
  empty channel. Signing now waits 30 s (45 s when wasm is already
  known to be slow), history RPCs get a longer budget on that path,
  and a timeout retries twice instead of declaring the chat empty.
  Stock Android still signs and reads in milliseconds. The badge
  popover now shows `chat engine: ready|starting|failed` so a green
  radio is not mistaken for working chat.
- **Opening a chat attachment replaced the whole app** _(mobile)_ — tapping
  Open on a Reticulum file (DM, group or Saved Messages) called
  `window.open(blob:…)`, which in the Android WebView navigates the app
  itself to the raw bytes: a `.md` showed as unformatted text over the
  status bar with no close, no share, and back only minimized the app (the
  app had to be killed). Files now open in an in-app viewer with close
  (button or hardware back), Share, Save and "Open with another app" on
  every type: markdown is rendered (headings, lists, tables, code, working
  `#section` links; raw HTML escaped, remote images turned into links so
  opening a file does not ping anyone), text/code/JSON/CSV show as text,
  HTML shows as source, images zoom, video and audio play, PDFs open in the
  book reader, and anything else (zip, apk, docx…) gets a card to hand it to
  another app. Unknown extensions are sniffed, so text still previews and
  binaries do not show as garbage. Share and "Open with" stage the file in
  the app cache (never public storage); "Open with" sends text-like files
  as `text/plain` so editors accept `.md`. As a safety net, any
  `window.open` of a `blob:` / `data:` URL on the phone now goes to the
  viewer instead of replacing the app.
- **Book reader failed on every PDF** _(shared)_ — opening a document asked
  pdf.js to draw page 1 twice at once, which it rejects ("Cannot use the
  same canvas during multiple render() operations"). Renders now run one
  at a time. The reader also closes on hardware back, fills the whole
  screen on phones (a desktop title-bar offset left a strip where the tab
  bar showed through), and offers Share and "Open with" for chat PDFs.
- **Chat image viewer** _(mobile)_ — hardware back now closes it instead of
  minimizing the app, and it has a Share button.

---

## [0.0.10] — 2026-09-15 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.10** (`versionName` 0.0.10, `versionCode` 13).

### Added

- **Multiple saved private nodes** _(mobile)_ — Settings and login node
  settings keep a list of private cores (name, URL/port, API key), the same
  store Hub uses. Tap a row to switch; add, edit or remove without retyping
  the key each time. The current single private-node draft is imported into
  the list on first open.

### Changed

- **Battery: idle wakeups slow down when you are not chatting or calling**
  _(mobile)_ — the 25 s presence heartbeat (needed so peers stay online) is
  unchanged, as is the 5 s overlay cadence while a chat is pinned or a call
  is up. When the phone is just sitting there the Python maintenance,
  transport monitor and stall watchdog drop from 5 s to 15–20 s, the Kotlin
  frame reader waits 5 s instead of 2 s (frames still wake it immediately),
  JS status/presence polls pause or stretch while the screen is off, an
  unchanged overlay neighbor list is not re-pushed, Q-Land stops its 200 ms
  send loop when the tab is hidden, and Home CSS animations freeze after
  10 s without a touch instead of 20 s. Opening chat or coming back to the
  app snaps every timer back to the fast path. Hub TCP keepalives wait 45 s
  before probing (was 20 s), the RNS job loop is 1 s instead of 250 ms, per-
  link watchdogs sleep up to 30 s, the owner loop idles 5 s between wake-pipe
  kicks, and Core node WebSockets ping every 45 s while the screen is off
  (20 s while you are looking at the app).
- **Battery: idle drain cut across the whole Reticulum stack** _(mobile)_ —
  users saw ~50 % battery in two hours with GO open. On-device measurement
  showed the app never let the CPU or the radio idle:
  - **one Reticulum stack instead of two.** The Kotlin `reticulum-kt`
    transport ran alongside the Python bridge purely to feed the status
    badge, holding two more hub sockets with their own keepalives and
    decrypting every announce on the mesh a second time. It is removed; the
    badge reads the Python bridge's own interface counters (the "announces"
    line now shows known paths).
  - **no thread per packet.** The vendored RNS spawned a new Python thread
    for every inbound link packet; under load hundreds of them piled up on
    the bridge's state lock and the phone burned CPU in lock and scheduler
    churn. `RNS.Link` gained the same `packet_callback_dispatcher` hook the
    desktop Hub's RNS fork has, so packets run on the bridge's bounded
    executor lanes.
  - **fewer wakeups.** The bridge's owner loop, the audio latency monitors
    and the queue-state diagnostics polled at 20 Hz / 2 Hz around the clock;
    they now idle at 0.5 Hz / 0.1 Hz and only speed up while a call is
    active. The frame writer blocks on an event instead of polling at 33 Hz,
    the Kotlin frame reader polls at 0.5 Hz instead of 4 Hz, the loopback
    socket writer blocks instead of polling, and the engine's loopback
    keepalive is 60 s instead of 15 s. The UI stops re-sending an unchanged
    presence snapshot and re-fetching the Core API key every 5 s.
  - **less radio.** Kernel TCP keepalives on the hub sockets probed after
    5 s of silence and then every 2 s (a packet every ~1.7 s across three
    hubs); they now probe after 20 s, every 5 s. Overlay pings to peers you
    are not chatting or calling with run every 30 s instead of 15 s, and a
    phone with few verified neighbours re-announces every 5 min instead of
    every 2. Identical `overlay_link_state` events (about 25/s on a busy
    mesh) are thinned to one heartbeat per link per 15 s.
  - **a phone is a leaf, not a relay.** The engine used to forward every
    other peer's group state digest, event notice and land state along
    recorded interest routes (400-600 bridge sends a minute on a busy
    mesh, more than all of the phone's own traffic). Mobile now runs with
    `relayGroupControl: false`: it still receives and applies everything,
    but does not act as a gossip hop, which also stops the land-state
    forwarding plan being re-sent to the bridge on every route change.
    Desktop Hub keeps relaying.
  - **fewer bridge round trips.** A positive `ensure_peer_identity` answer
    is remembered for 10 min (the engine asked ~40 times a minute for the
    same peers); hubs that stay down are retried with exponential backoff
    up to 60 s instead of every 5 s; presence-badge state changes are only
    emitted when a field the UI reads has changed; the voice-call layer's
    2.5 s local-address re-assert is a no-op when nothing changed.
  - **no retry storm for unreachable peers.** A peer with no Reticulum path
    was re-queued for an overlay link on every reconcile pass and every send
    (measured at ~10 attempts a second, each with a path request on the
    wire and a 2 s blocking wait on an I/O lane). Unreachable peers now back
    off per peer from 10 s up to 5 min, and the backoff lifts as soon as an
    announce installs a path.
  - **fewer overlay links on a phone.** Gossip is flooded, so the phone
    received one copy of every group digest, subscription and typing wire
    per overlay link: measured 3 250 inbound overlay packets a minute with
    12 links, of which ~440 were new (7.4 copies each), ~10 KB/s downstream
    around the clock and the largest single Python CPU item. The bridge now
    keeps at most 6 outbound + 6 inbound overlay neighbours on mobile
    (desktop keeps 12 + 8); the inbound cap is not lower because desktops
    seeking fanout keep dialling an advertised phone and every refused link
    still costs a full handshake (4 slots measured 2.5 refusals/s).
  - **quieter bridge log.** Per-event diagnostic lines (one per inbound
    presence, per fanout, per path request: ~10 lines/s on a busy mesh, each
    a JNI hop into logcat) are limited to 8 of each kind per minute with a
    `log_suppressed` summary. `QORTAL_PRESENCE_BRIDGE_VERBOSE_LOGS=1` lifts
    the limit. The engine also reports why inbound `read_sync` state was
    dropped (`read_sync_dropped`), since an un-ACKed drop is replayed by the
    sending device indefinitely.
  - **no hidden video decoding.** The featured-app preview videos on the
    home screen autoplayed even when scrolled away or with the app in the
    background; they now play only while visible and in the foreground.
  - **no more endless re-download of history the phone already has.** A
    group's state digest covers its 200 most recent events with no age
    limit, but the engine refused any event older than 30 days when
    importing a history page. In quiet groups that window reaches past 30
    days, so a fresh install could never match the mesh's digest and digest
    repair re-pulled the same known pages from every peer, forever: on this
    phone ~1 100 already-known events (about 21 pages, 24 of them refused on
    age) every 13 minutes, plus a Reticulum link handshake per page, at
    peaks over 10 KB/s of download. History pages and wire-carried batches
    now accept signed, verified events up to two years old (live wires keep
    the 30-day bound), so the digests converge and the pulls stop. Side
    effect: groups now show the older messages the desktop shows. The
    engine also logs `inbound_event_rejected` with the reason once a minute
    so a future mismatch can be traced.
  - **decorative animations pause when you stop touching the phone.** The
    home screen's looping animations (mascot, floating logos, status pulses,
    edge-light sweeps) kept the WebView drawing 60 frames a second for as
    long as the screen was on; measured on-device, a single small loop
    already costs ~55 % of a CPU core and all loops together ~60 %, against
    ~5 % with them off. After 20 s without input the app freezes CSS
    animations (progress spinners and skeletons excepted); any touch, key
    or scroll resumes them instantly. Transitions are unaffected. Turning
    off **UI animations** in settings still disables them entirely.
  - **less disk.** RNS logs at NOTICE instead of INFO; it reopened its log
    file for every inbound announce.
  - A thread-population report (`bridge_thread_population`, with per-family
    CPU time and a sample stack) is emitted when the bridge exceeds 60
    threads so a future leak can be located from a field report. For live
    diagnosis from remote devtools (logcat is muted on some vendor builds),
    `__qgoBridgeDiag.threadReport()` returns the same report on demand with
    native thread ids, `__qgoBridgeDiag.wireMix()` returns the inbound wire
    and link-teardown counters, and `Reticulum.getStatus()` now includes a
    per-packet-type byte tally (`packetMix`) and the RNS crypto backend.

### Fixed

- **GrapheneOS: chat unusable while Q-Apps work** _(mobile)_ — with the
  GrapheneOS "WebView JIT" exploit-protection toggle off, the chat engine's
  SQLite (WebAssembly) runs in an interpreter 10-50x slower or fails to load,
  and a failed boot left a worker holding the database so every retry failed
  too. The engine boot budget is now 180 s (was 60 s), a failed boot tears
  its worker down, control-message signing waits 30 s, and the Reticulum
  badge shows the real failure with the fix (Settings > Apps > Qortal GO >
  Exploit protection > allow WebView JIT). Python bridge failures (dynamic
  code loading blocked) are reported the same way.
- **"Signed DM author mismatch" / "Failed to send" hiding the real error**
  _(mobile)_ — a signer failure that carried no message (a Base58 decode that
  threw a bare string, a timed-out signer) reached the UI as an empty
  response and was reported as an author mismatch. Signer errors now always
  carry a message and the toast shows the signer's own reason, or the two
  differing addresses when it really is a mismatch.
- **Login submitted before the password was typed** _(mobile)_ — the auto-login
  effect for a prefilled password (biometric / shared-element transition)
  also fired on an unrelated re-render while the user was typing. It now
  only runs for a password that arrived prefilled.
- **Blank grey account menu / greyed update entry** _(mobile)_ — the account
  panel, tab options and search rows started at `opacity: 0` and relied on a
  CSS animation to appear; with animations removed (accessibility setting,
  hardened WebViews) they stayed invisible. The resting style is visible now.
- **Group chat / Saved Messages sync stalling for minutes** _(mobile)_ — the
  chat engine's commands to the Reticulum bridge were being rejected in bulk
  (`bridge command queue is full`): single bridge tasks ran for 2-5 minutes,
  the bridge's owner loop went silent for up to 149 s, and 90 % of the
  phone's outgoing group digests, DM notifies and presence announces bounced.
  Two causes were addressed:
  - the engine and the worker no longer talk to the bridge through the
    WebView main thread. A loopback WebSocket (`BridgeSocketServer`) carries
    commands and events directly between the engine worker and native code,
    so a busy Q-App tab or a long GC no longer delays chat traffic;
  - identical per-peer group state digests are suppressed for 30 s on both
    the engine and the bridge. Every `group_sub` reply, served history page
    and gossip forward used to re-send the same digest to the same peer
    several times a second, saturating the single-threaded send lane.
- **Bridge self-healing and diagnostics** _(mobile)_ — the bridge's command
  loop survives a failing iteration instead of dying silently, and a stall
  watchdog reports stuck lanes with Python thread stacks
  (`bridge_stall_diagnostic`) so a freeze can be diagnosed even on phones
  whose vendor build hides app logs. Land-state forwarding config retries
  back off instead of hammering a saturated bridge every second.

---

## [0.0.9] — 2026-09-14 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.9** (`versionName` 0.0.9, `versionCode` 12).

### Fixed

- **DM delivery when the phone is busy or closed quickly** _(mobile)_ — a
  message sent from GO could sit for minutes on Hub, or never arrive if you
  closed the app right after send. The notify packet is only valid for 30
  seconds; if the phone's radio queue stalled, Hub rejected it as stale and
  nothing retried. GO now re-announces undelivered DMs with a fresh signature
  until the other side pulls them (survives restart), drops dead notify
  copies instead of retrying them, and still acts on a late inbound hint
  instead of waiting for the 15-minute summary.
- **DM traffic off the crowded send lane** _(mobile)_ — DM notify / probe
  fanout no longer waits behind group traffic. Wires that already aged out
  are refused locally so a new signed copy can go out.
- **Group history signing** _(mobile)_ — Hub 3.0.3 author-manifest repair
  requests can be signed again (`RCHAT_AUTHOR_MANIFEST_REQUEST`).

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
  - IndexedDB, in-view lazy load, prefetch of most-used tiles.
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
  from **Send QORT → the QR icon** in the _To_ field.
- **Scanned-recipient name badge** _(shared)_ — when a scanned address has a
  primary registered name, it is shown in green next to the _To_ field.
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
