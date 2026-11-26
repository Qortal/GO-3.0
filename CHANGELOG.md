# Changelog

All notable changes to the **Qortal GO** fork of Qortal Hub are documented here.

Qortal GO is the Android (Capacitor) build of Qortal Hub. Entries marked
_mobile_ apply only to the Android app; entries marked _shared_ also affect the
desktop Hub. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- **Qortino gets ready while You type on Home** _(mobile)_ — the first
  letter typed in the "Ask Qortino…" box next to him starts loading the model
  and reading his system prompt in the background (12-15 s on a phone), so
  the answer can start as soon as the question is sent: his chat joins the
  load already running instead of starting its own. A question left unsent
  (keyboard closed without sending, or Home gone) frees the memory again as
  his "Keep ready" setting says for a closed window: after a minute and a
  half, after 15 s when it is off (time left to tap send), or not while GO is
  open. Never under an open or parked Qortino window; leaving GO frees it as
  before.
- **Background player** _(mobile)_ — audio and video playing anywhere in GO
  (Q-Apps, QDN websites, GO itself: voice messages, Home videos) now show in
  Android's media controls: the notification, the lock screen, headset and
  Bluetooth buttons. The player shows the title and artist (from the page's
  media session when it sets one, else the file name or the page title), the
  Q-App or site it comes from, a seek bar, Play / Pause, Back and Forward
  (Previous / Next when the Q-App has a playlist), and a settings gear. The
  cover is the media's own picture, a video's poster or a frame of the video,
  else the Q-App's icon, with a small Qortal logo in its bottom-right corner;
  GO's own cover (the logo on dark blue) when there is none. Tapping the
  player opens GO on the tab that plays. Audio and video keep playing when GO
  is minimized or the screen turns off (default): a mediaPlayback foreground
  service, a wake lock while it plays, and the page kept running (Chromium
  would freeze it a minute after GO leaves the screen). A paused player off
  screen lets the page sleep; Play wakes it again.
- **Background player settings** _(mobile)_ — Settings → System →
  Background player, or the gear in the player: Now playing with Play /
  Pause, keep audio playing / keep video playing when GO is minimized
  (both on), pause when the screen locks, play again on return to GO, show
  on the lock screen, the Qortal logo on the cover, the Back / Forward step
  (5, 10 or 30 s), when a paused player leaves the notification (5 min to
  never, 30 min by default), pause when headphones disconnect, and a sleep
  timer (15 min to 90 min, or at the end of the track). Calls and other apps
  pause GO's sound and it plays again after short interruptions (Chromium's
  own audio focus). In 12 languages. With GO off screen, Android does not let
  the gear open GO by itself; the player's second line then says to tap it,
  and for 30 s a tap opens GO on the settings.

- **Pinned apps, folders and bookmarks shared with the desktop Hub**
  _(mobile)_ — the Pinned tab is the desktop Hub's launcher: the same pinned
  apps, bookmarks, bookmark folders and order, from the account's encrypted
  settings on QDN, and an offer to save them there after a change on the
  phone. GO's old Tabs folders become bookmark folders once. Each pin, folder
  and bookmark keeps the time it last changed, and a removal stays as one, so
  GO and the Hub merge their changes item by item: a save on one no longer
  undoes what was done on the other. A save from GO keeps the Home layout and
  side panel the desktop Hub saved. Revert puts back the pins, folders and
  bookmarks as they are saved. What the phone records of them stays in GO's
  encrypted storage; if that storage can't be read, the phone takes them from
  QDN again instead of removing them everywhere.
- **Friends can call You while GO is in Your pocket** _(mobile)_ — off screen
  on battery Android freezes GO's page, so its presence stopped and other
  devices showed the phone offline about 2 minutes later, with the call
  button off. When GO leaves the screen it now signs the next 2 hours of
  normal presence messages, and the Reticulum service sends each at its time
  ("idle" after 30 minutes, or sooner at auto-lock). Dropped when GO comes
  back, signs out or is swiped away; none while You are invisible. Hubs see
  ordinary, fresh presence.
- **Call a friend who was just online** _(mobile)_ — a friend who shows
  offline can still be called if their device was heard within the last
  hour. The dot stays grey, a fresh route is always used first, and a friend
  who signed out can't be called.
- **Missed-call notification** _(mobile)_ — a 1:1 call missed while You aren't
  looking at GO posts "Missed call from …" in Android; tapping it opens the
  chat. It goes away once the missed call is read. In 12 languages.

### Changed

- **Widget list shows only current widgets** _(mobile)_ — the Add a widget
  list now takes only APPs tagged `go-widget`; the `go-widget…` identifier
  stays the fast way to find them. A widget republished without the tag (a
  "moved" notice, like the old Weather Now / Bars / Chart and Forecast ones)
  leaves the list, but keeps loading for everyone who already added it. The
  widgets guide and the list's hint for Q-App developers (12 languages) say
  so.
- **DMs reach Your Hub and GO faster** _(shared)_ — two gaps when one
  account runs on GO and a Hub at the same time:
  - **Read on the Hub, missing in GO:** when the Hub says "read up to here"
    in a DM chat and GO has nothing that new (a DM that only reached the
    Hub, or a reply written there), GO now pulls that chat from the Hub right
    away instead of waiting for the next 5-minute probe. It also works for a
    chat GO has never seen, and with an unchanged Hub 3.0.3. Pulled messages
    arrive already read. At most one pull per read point.
  - **Received on GO, missing on the Hub:** DMs other people send are now
    handed to Your linked Hub the same way GO already hands over the DMs You
    write (direct only, never forwarded, at most one signature per chat per
    10 s, nothing without a linked own device). Not for messages the Hub
    itself gave GO, or older than 7 days. A reply You send right after is
    never held back by it.
- **"Only on this phone" explains why** _(shared)_ — the hint now says there
  is no mailbox: the message goes out when the recipient is online at the
  same time as this phone or Your other device, retried for up to 7 days
  while GO runs. The desktop gets its own wording ("this device"). In 12
  languages.

### Fixed

- **Q-App publishes on a private node over an SSH tunnel** _(shared)_ — GO
  took Core's local auth bypass on trust for any 127.0.0.1 node and never
  asked for its API key. But Core skips the key only when the request reaches
  it from loopback; a tunnel that ends on the server's LAN address, or a Core
  in Docker, still needs the key, so every publish (SubWire, Quitter, Q-Share)
  failed while reading worked. GO now always asks Core's own key test, which
  runs the same check as a publish, and asks for the key when Core would
  refuse it. A tunnel Core does see as loopback still works with no key.
- **GO-to-GO calls declined as "not a friend"** _(shared)_ — friends are kept
  on each device, so a GO signed in later (a new phone, or a friend added on
  another device) declined every incoming 1:1 call and kept its own call
  button off. The friend is now restored from the account's own signed
  "added as a friend" message in that DM. A friend deleted on another device
  is removed here too _(mobile)_.
- **Calling each other at the same moment** _(mobile)_ — both phones stayed on
  "Calling…" for 60 s. Now one phone drops its own call and answers the
  other's. With a desktop Hub, when the Hub's call should give way, GO waits
  15 s for it and then gives way itself.
- **Missed calls and messages marked as read by the ring** _(mobile)_ — a ring
  that woke the screen counted as You looking at the open chat. It now counts
  only after a touch.
- **Answered call stuck on "connected" with no sound** _(shared)_ — when the
  caller's audio key never arrived, the call stayed open with the microphone
  on. It now ends after 65 s, unless the direct link carries the audio.
- **Calls switch to Direct sooner** _(mobile)_ — a call waited for Python's
  STUN server list first (about 6 s on an older phone). It now starts with
  the servers GO knows, waiting at most 1.5 s when it knows only one or two.
- **"No answer from …"** _(shared)_ — a call that rings out says so instead of
  just closing. In 12 languages.
- **Friend rows in DMs** _(shared)_ — they no longer say "Add them back to
  enable calls" once both added each other. In 12 languages.
- **Calls survive network trouble** _(mobile)_ — switching between Wi-Fi and
  mobile data in a call cut the sound on both sides for minutes, and a hang-up
  could get lost. Now the sound is back after about 1.5 s, a Direct call falls
  back to Reticulum at once, and calls come back after airplane mode, mobile
  data off and dead spots. A hang-up made meanwhile arrives when the network is
  back within 30 s.
- **Calls on slow phones** _(mobile)_ — on an older phone a call without the
  direct link ran behind the phone's other traffic: rings and hang-ups came up
  to 18 s late, and voice lagged by seconds. Call signals now go first, voice
  that is too old to be heard is dropped instead of queued, and Reticulum
  packets cost far less processor time (backport of RNS 1.5.5, same bytes on
  the wire).
- **Calls that never went Direct** _(mobile)_ — while a call started, GO marked
  its own working audio link as down for moments, and a WebRTC message refused
  then was lost. GO now leaves a working link alone and sends a refused
  message again.
- **GO closing by itself after hours in the background** _(mobile)_ — the
  Reticulum service's two-minute thread report could release a Java reference
  on the wrong thread, which Android answers by ending the app.

## [0.0.20] — 2026-11-04 (GO 3.0)

### Added

- **Qortino talks and listens on Home** _(mobile)_ — once a user has a
  name and an avatar, Qortino now and then says something on Home: a little
  puff leaves his mouth, a speech bubble grows out of it and the words type
  out while his mouth moves. 56 lines in all, translated. Most invite the
  user to Qortino AI (tap his head to download it, or type a question next
  to him once it is on the phone); jokes, tips and late-night yawns fill the
  rest. They come only while Home is on screen and the phone is in use: an
  early line on some visits to Home, then one every two or three minutes at
  most, six per run of GO. A tap on the bubble opens Qortino. With Qortino AI
  on the phone, a small "Ask Qortino…" box sits next to him: whatever is
  typed there opens Qortino in a new chat and is sent as soon as the model
  is loaded. He has new moves too: he glances around, looks at the box and
  lights up his antenna while the user types, hops with happy eyes when a
  question is sent, winks after a joke, and dozes with drifting Zzz late at
  night. His mood tag (idle, listening, chatty, sleepy…) is translated now.
- **Qortino settings** _(mobile)_ — at the top of Qortino's chat history
  panel, a Settings row opens: answer length (Short answers are ready
  sooner, Detailed ones may run longer), text size, how long Qortino stays
  ready after its window closes (free the memory at once, a minute and a
  half as before, or while GO is open), whether Enter sends, Delete all
  chats, and Remove Qortino from this phone, which shows the model's size
  and, after a confirm, deletes its files (and any half-saved part) and goes
  back to the download screen; the chats stay. Changing the answer length
  re-reads only one line of Qortino's instructions. The history panel's
  labels are translated now.
- **New chat button in Qortino** _(mobile)_ — top right of Qortino's chat:
  one tap starts a new chat with the cursor in the message box. The chat you
  leave stays in the history. It is greyed out while Qortino is answering or
  when the chat is still empty.
- **Widgets kept on the phone** _(mobile)_ — a widget is a Q-App, and it
  only opened while the node still had that app; the public node drops apps
  within hours, so widgets often sat on the node's loading page. GO now
  keeps each widget's own files (what its app published) on the phone after
  the first load and opens the widget from there, at once, even when the node
  no longer has the app. What the widget shows (its data) still comes from
  QDN, live. Once an hour at most GO checks for a newer publish and fetches
  it in the background; the copy it has stays until a whole new one is in.
  Removing a widget removes its copy. Apps that list no files (some older
  ones) load from the node as before. The widget menu's Reload now really
  reloads the widget.

### Changed

- **A smaller, lighter GO** _(mobile)_ — code GO no longer used was removed
  (about 3,600 lines fewer), rarely used parts load only when they are
  needed, and screens subscribe only to what they show. The APK is about
  a third smaller (111.6 MB → 75.9 MB), the phone reads about 40% less
  JavaScript before the first screen, and GO sitting idle on Home redraws
  about three quarters less often and uses a little less memory.
  Attachments, viewer copies and the Qortino model are freed sooner. The
  times in the open bell panel ("a minute ago") now update every 30 s.

- **Qortino's download runs on its own** _(mobile)_ — the model download
  no longer stops when the Qortino window closes: Minimize sends it to GO's
  notifications, where a Qortino row shows each step with a progress bar
  (tap it to open Qortino) and the bell counts it, and it also shows in the
  Android notification. It picks up again after GO restarts. When peers stop sending the rest, GO asks the node
  again after two minutes and, if it is still stuck, tries again by itself:
  soon while each try gets further, giving up only after about 40 minutes
  without any progress. Try now skips the wait, and a banner says when
  Qortino is ready.
- **Qortino downloads on the public node too** _(mobile)_ — getting
  Qortino's model needed your own node. The public node can fetch it now, but
  before the download GO says plainly that a private node is highly
  recommended: the public node is shared, cuts long downloads near 1 GB and
  can drop what it fetched. On the public node GO takes the model in three
  parts under 1 GB (published as its own share), on your own node in the two
  parts. A download already partly on the phone carries on in its own
  layout, and if one layout is not on QDN GO uses the other.
- **Qortino AI has a new brain** _(mobile)_ — one model instead of the Lite
  and Standard packs: Qwen3 4B Instruct 2507 (Apache-2.0), 4-bit, 2.3 GB,
  published on QDN in two parts because QDN takes at most 2 GiB per file.
  Each part is checked by sha256 after download, and a retry keeps a part
  that already arrived. Assembling deletes the old packs (up to ~4 GB). No
  more Fast / Max switch and no QDN search window: Qortino answers offline,
  from the model and its curated FAQ, with longer answers (4096-token
  context). It opens faster: the model stays loaded for 90 s after Qortino
  closes (45 s once GO is in the background), and its instructions are saved
  after the first read, so later opens start answering at once. Follow-up
  questions reuse what the phone already read instead of reading the whole
  chat again, and when a long chat drops its oldest turns the phone moves
  what it read instead of reading the rest again (that was ~40 s on a
  vivo). The model now runs on a lasting thread pool held on the phone's
  fast cores; it used to start new threads for every word, some landing on
  the little cores (on a vivo: prompts read twice as fast, answers 2.0 →
  3–5 tok/s). The app's looping animations pause while Qortino works.
  Debug APKs now build llama.cpp optimised, like release ones.
- **Qortino knows Qortal much better** _(mobile)_ — its curated answers grew
  from about 1,600 to about 5,000, with some 3,400 new Qortal entries written
  from Hub and GO code, Qortal Core, the Q-Apps built for Qortal, the Minter
  Guide, Welcome to Qortal, qortal.org and qortal.dev: basics, minting,
  nodes, QDN, names and groups, trading, security, Hub, GO, chat and calls,
  Reticulum, Torq, the Q-Apps, building Q-Apps, hardware and troubleshooting.
  The old answers were checked again (Torq instead of Quitter, Q-Chat over
  Reticulum, current fees and levels), and Qortino recommends the stable
  apps rather than their pre-release "+" versions. Matching is now BM25 over
  each entry's phrasings and answer: the right entry comes first twice as
  often, an answer is shown as-is only when one entry clearly fits, and
  otherwise the closest one or two go to the model with the question. App
  cards were added for Torq, Q-Wallets, Q-Drive, Subscreen, POS+, Q-Weather
  and more; everyday words that are also app names ("weather", "a meme") no
  longer bring up an app card.

### Fixed

- **Qortino AI no longer crashes on older phones** _(mobile)_ — the model's
  maths was built for one processor generation (Armv8.6 with i8mm), so on
  chips without it (Snapdragon 865/888, Tensor G1/G2 and older) GO closed
  with an illegal instruction as soon as Qortino started answering. GO now
  carries seven builds of that code, from plain Armv8.0 up to Armv9.2, and
  loads the fastest one the phone's processor says it can run. Phones that
  already worked keep the same speed (they get the i8mm build as before).
- **Qortino's download no longer breaks at 1 GB** _(mobile)_ — the public
  node ends every transfer near 1 GiB (its web server cuts the connection),
  so saving the 1.3 GB first part failed and started over from zero, again
  and again. GO now keeps the bytes it already has and asks for the rest; the
  sha256 check still guards the whole part. While it waits to try again it
  now says why (no peers, the connection broke off, or a damaged part)
  instead of always blaming the peers.
- **Qortino on phones with 16 KB memory pages** _(mobile)_ — Qortino's
  native code was built for 4 KB memory pages, so it could not start on
  phones booted with 16 KB pages (an option on Pixel 8 and later, and more
  new phones over time). It is now built for 16 KB pages like the rest of
  GO's native code; nothing changes on other phones.
- **Kick and Ban only where they can work** _(mobile)_ — the Members panel
  offered Kick and Ban to every admin, but Qortal Core takes them from the
  group's owner only, so an admin confirmed the fee and then got an error.
  Now only the owner gets Kick, Ban, the admin buttons and Cancel ban; other
  admins see one line saying only the owner can. Groups owned by Core's null
  account have no owner (MINTER, General Chat, Q-Chess (Public) and others):
  there every such change needs approval from the group's admins, which GO
  can't send, so GO shows no buttons and says that instead. The Bans list's
  remove-ban X now shows on touch screens, and its label is translated.
- **Muted groups stay quiet** _(mobile)_ — a Q-Chat mention alert used the
  mute list from the moment the message arrived, and finding out who was
  mentioned can take seconds, so a mention could still ring right after you
  muted the group. The first mentions after login could also arrive before
  the mute list had loaded. Alerts now check the current list, muting takes
  effect at once, and new thread posts in a muted group no longer alert.
- **Q-App and website icons in Qortino's answers** _(mobile)_ — the app
  cards under an answer asked the node for an image that almost no app
  publishes, so most cards showed only a letter. They now show the same
  icons as the Apps library: the name's QDN avatar, kept on the phone, or the
  icon GO ships for well-known apps, so they also show offline.
- **Q-Apps no longer hang on the node's loading page** _(mobile)_ — on the
  public node an app could sit on "Loading - Qortal Network" ("Downloading
  from network…", "Waiting for data from peers…") until refresh was tapped,
  though the node was already serving it. The node's loading page reloads
  only when the node's status says READY, and the public node's status
  lags: it answers from two copies that do not hold the same apps, and kept
  saying 0/2 files for apps it served at the same moment. GO now checks the
  app's page itself every 5 s while the loading page shows (every 15 s after
  two minutes, none after 15) and opens the app as soon as the node serves
  it, as refresh does. Nothing changes on any other page.
- **Tabs no longer stutter with a loading Q-App behind** _(mobile)_ — the
  node's loading page redraws its moving background on every frame, which
  kept the phone's GPU fully busy wherever the page was on screen, under the
  Tabs panel too: GO dropped to about 30 fps and dragging Tabs jumped. The
  background now moves for a moment and then stays still (GPU 100% → 1%, GO
  back at 60 fps on a vivo); the spinner, status and progress keep moving.
  The Tabs panel also keeps its own layer while it is open: each drag used
  to give it one at the start and take it away at the end, so the whole
  panel was repainted and redrawn, a 50-117 ms stall in every drag. Drags
  now run at 60 fps throughout.
- **Resizing a widget no longer pulls Tabs down** _(mobile)_ — while widgets
  are being arranged, a drag on the widgets screen moved or resized a widget
  and also counted as a pull down for Tabs, so dragging a corner down
  brought the Tabs window over the screen. Arranging now keeps its drags to
  itself (no Tabs pull, no swipe to the next section). The resize corner is a
  small square with a two-way arrow instead of a dot, so it reads as resize.
- **Widgets are ready when you swipe to them** _(mobile)_ — the widgets
  screen loaded its widgets only once it was opened, and let them go three
  minutes after it was left, so most visits showed each widget's loading
  card first. GO now loads them a few seconds after it starts, out of sight,
  and keeps them loaded while it runs (each one pauses while nobody sees
  it). They also keep their size while another screen shows, instead of
  being laid out again on every visit.
- **GO stays online when two Reticulum hubs drop it** _(mobile)_ — GO knew
  only the hubs `reticulum` and `reticulum2` (plus one community hub), while
  the desktop Hub also uses `reticulum3`. A hub can block a connection for a
  while after many short reconnects (a phone restarting GO often, or several
  devices behind one hotspot), and then GO was cut off: no chat, no
  presence, while the desktop Hub on the same connection stayed online. GO
  now connects to `reticulum3` too, like the desktop Hub.
- **Your other devices stop ringing when one answers** _(mobile)_ — when
  GO called an account signed in on more than one device (a phone and a
  desktop Hub, say) and one of them answered, the others could keep ringing:
  the "stop ringing" message Hub signs when the call starts is refused once
  it is more than 30 s old. When a call placed from GO is answered, GO now
  signs a fresh one and sends it to the callee's other devices only. Calls
  placed from a desktop Hub still need the Hub-side fix.

## [0.0.19] — 2026-10-20 (GO 3.0)

### Added

- **Voice calls work** _(mobile)_ — calls from GO never reached audio:
  GO's join message carried a field its own signing rules refuse, the
  Python bridge had lost its audio path in the Hub v3.0.1 merge, and GO
  could not send WebRTC signals. GO now runs the Hub's own call code,
  unchanged, so 1:1 and group calls with Hubs and other GO phones follow
  exactly the Hub's protocol (signatures, pinned delivery, heartbeats,
  decline reasons, group rules). 1:1 calls try a direct WebRTC link first
  and fall back to Reticulum by themselves. GO never sends or uses local,
  LAN, CGNAT or IPv6 addresses, only the other side's public IPv4, and
  never offers itself as a STUN server; STUN servers heard on Reticulum are
  kept for 24 h (at most 32) and checked before use. Settings → **Calls**:
  Direct (faster, the other side sees Your IP address) or Private
  (Reticulum only, groups too). On Android: a ringing notification with
  the caller's avatar and Accept / Decline, a full-screen ring, answering
  over the lock screen (only the call screen shows, GO stays locked), an
  ongoing-call notification with Mute / Hang up, the microphone kept on in
  the background, earpiece and proximity for 1:1 calls, speaker for group
  calls, and switching to a Bluetooth or wired headset (the mic restarts on
  the new device). GO does not ask for the "Nearby devices" permission for
  Bluetooth. New full-screen call screen ("Encrypted · Direct" or
  "Relayed"), a small call strip on every section, an audio route sheet,
  a group call stage, and a Calls section in Copy diagnostics (WebRTC
  stats without addresses). Calls get ready about half a minute after GO
  connects, and the two accounts must be DM friends, as on the Hub. Tested
  on a phone on mobile data with a desktop Hub: direct link in about 7 s,
  no packets lost. In all 12 languages.
- **Widgets screen** _(mobile)_ — a new screen left of the first section
  (swipe right from Home) for GO 3.0 widgets: small Q-Apps made for GO, like
  the time, the weather or news from Torq. **+** lists the widgets published
  on QDN: APP resources tagged `go-widget`, or with an identifier starting
  with `go-widget` (`go-widget-news`), which Core filters on the node and lets
  a name publish its widget next to its main app. Nothing runs until the user
  adds it. The screen shows only the widgets (an empty one, a round **+**).
  Widgets sit on a 4-column grid; holding a widget picks it up (Android takes
  the long press from its frame) to move it (others make room, same-size ones
  swap) or drop it on **Remove** at the bottom; holding an empty spot
  arranges too, with **Add widget** / **Done** at the bottom; drag a corner
  to resize, × to remove, tap for Open / Reload / Remove. A
  widget may suggest its size (`GO_WIDGET_SET_SIZE`) until the user resizes
  it. Widgets get a strict request allowlist: they can show things and open
  apps, but never pay, publish, sign, decrypt, save, notify or go full
  screen, and anything that asks the user or opens something only works
  while the screen is showing; frames have no pop-up dialogs, downloads or
  clipboard. Sideways swipes over widgets still switch sections: Android
  takes a swipe once it is clearly sideways (after the page confirms the
  widgets screen is on top under the finger) and hands it to the section
  swipe, while taps, typing and vertical scrolling stay the widget's. Widgets
  load the first time the screen is shown and are unloaded 3 minutes after
  it was last seen. Settings → System → **Widgets screen** turns it off.
  Developer guide: `docs/go/go-widgets.md`; example widget:
  `tools/preview/fake-node/render/APP/GOClock.html`.
- **Rearrange the bottom buttons** _(mobile)_ — Settings → System → Bottom
  buttons (above Immersive mode): drag the round Home, Apps and Chat buttons
  into any order (or move one with the arrow keys; Reset puts them back).
  The bottom bar and the landscape top-bar buttons use it, and so does the
  sideways swipe between sections: the section beside the current one is
  always the button beside its button, the first and last ones rubber-band,
  and the neighbours GO lays out ahead of a swipe are parked again on their
  new sides. The bar takes the new order when a drag ends, not on every step
  of it. Saved on the device (`go_tab_bar_order`).
- **"Public node unavailable" window** _(mobile)_ — on the public node
  (ext-node.qortal.link), a Q-App or website opened while the node is down
  used to show a blank or error page. Now a window names the app, says the
  public node is not answering, and offers to wait or to use a private node
  (opens node settings). While it waits, GO checks the node every few
  seconds (4 s, then backing off to 30 s, only while on screen; "Check now"
  asks at once), and when the node is back the window turns green and the
  app opens. An app tapped with no recent answer from the node opens at once
  and is checked behind it; if the node turns out to be down, the window
  says so and GO reloads the app once the node is back. GO's own QDN loads
  (avatars, the Torq feed, private Q-Apps) and a Q-App's QDN loads inside
  its frame report failed loads too; those show the window at most once per
  outage, with "Don't show again". Nothing extra is sent while the node
  answers: the node status socket's pongs and ordinary loads say it is up,
  and a sign of trouble is confirmed with `/admin/status` (a lone 502 is
  asked twice) before anything shows. A phone with no network never blames
  the node. Preview: `tools/preview/public-node-down.html`.
- **Optional notice when WebView JIT is off** _(mobile)_ — on GrapheneOS
  with "WebView JIT" turned off for GO, chats and the chat database run in
  a slower mode, mostly right after start. GO now shows one calm card in
  the bell (no pop-up, no outside links) that says so, gives the two steps
  to change it (Settings > Apps > GO > "Exploit protection" > "WebView
  JIT"), and says it is a security setting and the choice is Yours: faster
  with JIT, extra hardening without it. The card shows only when GO can
  tell JIT is off, and "Don't show again" keeps it away. In all 12
  languages.

### Fixed

- **Sharing into GO while it is open in another window** _(mobile)_ — a
  photo or file shared to "GO Groups" / "GO DMs" / "GO Self-DM" while GO sat
  in the background with Tabs, Settings, the account panel, a viewer or a
  sheet open opened the chat list under that window, so the share never
  showed. GO's own windows now close when a share arrives (the QDN publish
  window shrinks to its bubble, Qortino is parked); Q-App approvals, calls
  and the Qortal Card stay. Home's Settings also no longer leaves an
  invisible layer over Chat that took every tap: it went on fading out
  inside the hidden Home, which finishes that only in idle time.
- **No more endless Qortal logo at start** — the start-up logo was only
  taken away by the app's own code, which runs after the whole bundle has
  loaded. A bundle that failed while loading (or a page rebuilt after the
  WebView crashed, under memory pressure) could leave the logo up until GO
  was force-closed. A small script that runs before the bundle now notices
  an error or a start over 25 s, keeps the reason in the saved crash log
  (Copy diagnostics), and shows "GO is having trouble starting" with a
  Restart button on the logo screen, in the 12 languages. Restart goes back
  through the fingerprint or password unlock, like the crash screen.
- **Faster start: the QortalLand game engine no longer runs at every
  start** — the shared CommonJS helpers had landed in the Phaser chunk, so
  the main bundle imported it and all of Phaser (1.7 MB, with canvas and
  WebGL probes) was parsed and run on every start, before the logo could go.
  The helpers now have their own 1 KB chunk; Phaser loads only when
  QortalLand opens.
- **Bottom of long lists can be tapped with the 3 navigation buttons**
  _(mobile)_ — GO draws under Android's navigation bar and leaves each
  screen to keep clear of it. With gesture navigation taps under the handle
  still reach GO, but the 3 buttons (or 2) take every touch, so whatever a
  screen did not pad was stuck under them: the last channels in a group's
  channel list (Qortal Public Square), the bottom of Home, a Q-App's own
  bottom bar in full screen, the bottom row of the emoji panel. With button
  navigation GO's view now ends above the bar, and the page colour shows
  behind the buttons. Gesture navigation is exactly as before (same view
  size, same 24 px inset, same keyboard heights; checked on the emulator in
  both modes), and so is a phone turned sideways, where the bar sits at the
  side. Button navigation is told apart by the bar holding tappable buttons
  and having no back-swipe zones at the sides; the keyboard's own buttons
  under gestures never count. A tablet taskbar kept on screen under gesture
  navigation also stays as it was.
- **Publishing works on a private node on the network** _(shared)_ — on a
  node reached by its LAN or remote address that had Core's local auth
  bypass on, GO counted the node as connected without testing the API key
  and never asked for it. The bypass only covers requests from the node's
  own machine, so every QDN publish (a Q-Mintership+ vote, say) was
  refused with "Missing 'X-API-KEY' header". GO now trusts the bypass only
  for a node reached over loopback (127.0.0.1, localhost, ::1, so the
  local node and SSH tunnels); any other private node gets the real key
  test and the API key dialog when its key is missing or refused. The
  public node still never asks for a key.
- **A refused publish says why, at once** _(shared)_ — a publish the node
  refused for want of its API key (HTTP 401/403) was tried three times,
  25 seconds apart, under "Your node did not answer", then failed with
  Core's raw answer. It now stops at the first refusal with "Your node
  needs its API key to publish. Add it in node settings.", and GO's
  publish window opens with an Open node settings button, however small
  the publish. Other refusals (HTTP 4xx) also fail at once with Core's
  own words. "Your node did not answer. Trying again shortly…" now shows
  only when the node really did not answer (network error, timeout, 5xx,
  408, 429), and only those are tried again.
- **Channels keep loading after long use** _(mobile)_ — GO wrote a small
  wake-up file for every message it stored and kept each one open until
  the page restarted. After a day of use or a big catch-up the phone ran
  out of file handles, every downloaded history page was thrown away, and
  the peer that sent it was blamed, so channels in some groups never
  filled. Wake-up notes now stay in memory (the old folder is cleared
  once), the file handle pool refills earlier and in small steps and
  retries on its own when opening fails, and a page that could not be
  saved on the phone is asked for again from the same peer a minute later
  without counting against it.
- **Channel lists that depend on snapshots** _(mobile)_ — channel edits
  skipped as "author not admin" are tried again when the admin status
  changes, and every 30 minutes. A channel snapshot GO already has is no
  longer asked for again every minute. A failed snapshot download is asked
  for again (from the same peer, or from the group's other providers)
  instead of waiting for the next update. An old snapshot signed by
  someone who is no longer an admin is ignored quietly instead of putting
  the peer that passed it on in a 5-minute time-out. An admin's phone shows
  the member channels until the full snapshot arrives.
- **A failed admin list no longer hides channels** _(shared)_ — when the
  list of groups You admin failed to load, GO counted You as admin of
  nothing, and the chat engine skipped Your own channel edits without
  asking the node. The list is now cut off after 15 s, the last good list
  is kept, and until the first list has loaded the engine asks the node.
- **Messages are not lost while the node can't check membership**
  _(mobile)_ — during a node outage, messages waiting for a membership
  check were dropped after 64 per peer, and a gap page that came back
  with only such messages used up a try. They now stay queued and the try
  is given back. Membership checks for a page go to the node in one
  request per group (up to 50 addresses) instead of one per message, own
  membership re-checks back off up to 5 minutes while the node fails, a
  check cut off by a frozen engine is sent again, and checks at start
  wait for the node settings.
- **GO answers Hubs faster** _(mobile)_ — requests for history from Hubs
  and other phones are handled when they arrive instead of queuing behind
  other chat work, requests the other side has already given up on are
  dropped without work, and a busy GO now tells the other side to try
  another node. Files staged for sending are deleted once sent, and old
  ones are cleared at start.
- **Rejected transfers no longer spin** _(mobile)_ — the Reticulum version
  in GO gave "rejected" the same code as "not started", so the watchdog of
  a rejected outgoing transfer never stopped, and a reply in several parts
  could fail while its next part had not started yet. GO now uses the
  value newer Reticulum versions use.
- **Correct JIT line in Copy diagnostics** _(mobile)_ — on GrapheneOS with
  WebView JIT off for GO, the report said "JIT: likely on". It now reads
  GrapheneOS's own setting (on, off, likely off or unclear) and names the
  WebView package and version; the speed probe numbers are still shown.
- **Faster chat database that is not damaged when GO is killed**
  _(mobile)_ — GO's chat database could be left damaged when Android
  killed GO in the middle of a save, which later showed up as a rebuilt
  database and lost history. GO's databases now use write-ahead logging
  (WAL) with the file held by GO alone. In lab tests that killed GO
  mid-save, the old setup damaged the database 17 times in 60 and the new
  one never. Saves are also quicker, and the queries GO runs most are
  prepared once and reused. If WAL cannot be turned on, GO stays in the
  old mode and notes it in the log; it never wipes the database. Note for
  testers: an older GO build cannot open the new database file (nothing is
  lost; a newer build opens it again).
- **Channels kept when a current admin's snapshot lists them**
  _(mobile)_ — a channel created by someone who is no longer an admin of
  the group stopped taking edits (rename, archive, order) from the
  current admins, because its first version came from a non-admin. When
  a channel snapshot signed by a current admin (checked with the node)
  lists the channel, GO now uses it as the channel's base and applies the
  current admins' later edits on top. If the node cannot say whether the
  signer is still an admin, GO waits instead of guessing.
- **Hubs can fetch Your new posts from a busy phone** _(mobile)_ — a Hub
  fetching a new post from GO now gets 30 s instead of 15 s, and the
  request is judged by the time it reached the phone, so a short freeze
  no longer makes a valid request look too old (signatures are still
  fully checked). When GO is busy or its chat engine is stuck, requests
  for older history are turned away at once as "busy", so the Hub asks
  another node. New posts, direct messages and requests for Your own
  messages are never turned away.
- **Recent history still served while the node is down** _(mobile)_ —
  when the Qortal node cannot answer membership checks, GO keeps
  answering history requests from members the node confirmed within the
  last hour. A "not a member" answer from the node always wins at once.
  This never applies to accepting messages, calendars or admin channels.
- **Replies first after a freeze** _(mobile)_ — after the phone had
  frozen GO, the chat engine worked through the whole backlog of network
  chatter before it saw the replies to its own requests, so sends and
  downloads timed out. Replies are now handled first, outdated typing
  notices and DM nudges are dropped, and repeated group status updates
  from the same peer are merged while the backlog is large. Messages and
  membership news are never dropped, and their order is kept.
- **No resend after a late "delivered"** _(mobile)_ — a message whose
  delivery was confirmed after GO had stopped waiting was sent again up
  to 10 times. A late confirmation now cancels the resends still waiting,
  and a slow answer no longer pauses relaying as if Reticulum were
  overloaded. A peer that Reticulum does not know is not looked up again
  for 30 s, unless it introduces itself sooner.

### Changed

- **Enter types a new line in chats** _(mobile)_ — like Telegram and other
  phone chat apps, the keyboard's return key now starts a new line and the
  send button sends. Anyone who picked "Enter: send" in the Aa toolbar keeps
  it, and then the keyboard shows a send key instead of the new-line arrow
  (`enterkeyhint`). The toggle label is in all 12 languages. The desktop
  keeps Enter = send.
- **Faster sync on slow phones and with WebView JIT off** _(mobile)_ —
  each stored message is handled and announced once (it was twice), the
  chat list re-indexes only messages it has not seen, summary refreshes
  run one at a time and are grouped for 1-3 s during bursts (badges after
  reading a chat still update at once), file hashing uses the WebView's
  built-in SHA-256, which stays fast with JIT off, and on GrapheneOS with
  WebView JIT off the app waits longer for the chat engine before giving
  up on a request.
- **Fewer database writes per message** _(shared)_ — each stored message
  is written in one transaction instead of many small writes, a re-index
  that changes nothing writes nothing (and no longer scans the whole
  search index), chat summaries look up a group's recent messages
  directly instead of scanning all of them, and gap bookkeeping after a
  failed request is one write. Results are the same as before.
- **Less useless background repair** _(mobile)_ — gaps that no peer has
  are tried much less often: a peer that answered "no history" is not
  asked again in that group for an hour, three refusals in a row hold a
  gap for 5 minutes, doubling up to 6 hours (kept across restarts), and
  recent gaps are tried before gaps older than 29 days.
- **Richer Copy diagnostics** _(mobile)_ — new lines for chat storage
  (file handles, spares, "too many open files"), membership checks
  (requests, biggest batch, failures by reason, last 8 failures), node
  sync, the admin list, channel metadata per group (problem groups first),
  serving rejects by reason and request arrival times, gap repair results
  and kinds of waiting gaps, engine time per call, database writes per
  minute and size, long tasks on the page, summary refreshes, the Python
  bridge (threads, queues, links, open files, CPU), the resource staging
  folder, and whether the previous page crashed. Numbers and per-report
  pseudonyms only, as before.
- **Old history no longer retried in the background** _(mobile)_ — gaps
  in history older than 29 days (GO phones only serve the last 29 days)
  are now asked only of Hubs, each Hub once, at most 3 a round, and then
  rest for 30 days. They wake at most once a day when a new Hub shows up,
  or when You get more access (joining, becoming admin). Scrolling back
  in a chat still loads old pages as before.
- **Lighter start-up re-index** _(mobile)_ — at start GO re-reads recent
  messages of each group for mentions and search. Groups with nothing new
  since the last run are now skipped without asking the chat engine, and
  the rest are read after the first screen is drawn, when the phone is
  idle, two groups at a time.
- **More in Copy diagnostics** _(mobile)_ — new lines for the socket
  event queue (backlog, wait times, dropped and merged chatter) and for
  serving decisions (history turned away as busy, served on a recent
  member answer, judged by arrival time).

## [0.0.18] — 2026-10-15 (GO 3.0)

### Added

- **Qortal Card (testing)** _(GO)_ — pay and take payments by tapping, with
  a Qortal test card or between two GO phones (NFC). Off until switched on
  in Settings → System; then Qortal Card shows in the avatar menu, below
  Notifications. My card connects a card in one tap: a blank card gets its
  own account, with a key GO makes from the wallet for that card (never
  the main key, so GO can move its QORT back if the card is lost) or a key
  made on the card. Cards can be topped up, renamed, given a name on chain
  and an avatar (avatar needs Your own node), saved as a password-protected
  backup file (wallet-key cards), moved back by All, Amount or Percent, and
  switched from an on-card key to one GO can restore. Take payment charges
  a card held to the phone: GO checks the card's signature and balance
  before it sends anything, and a failed send retries the same signed
  payment. Phone to phone: one phone asks for QORT (2 minutes), the other
  taps it and confirms in GO's own Send QORT. GO never replaces a key on a
  card, never reuses a card key index, reads NFC only while a tap is
  expected and answers taps from other phones only while it is asking and
  unlocked. Test cards have no PIN yet, so keep only a few QORT on one. The
  APK now asks for the NFC permission; phones without NFC still install GO.
- **Dev Mode for Q-App developers** _(GO)_ — Settings → System → Dev Mode
  adds a Dev Mode button next to New folder in the library's Pinned tab.
  It picks a Q-App's .zip on the phone and opens it in a tab, unpacked the
  way the node would serve it once published. GO builds it itself, in
  memory, like a private Q-App, so it works on a public node and no node
  sees the zip. Refresh reads the zip again, so a zip replaced on the phone
  shows its new version. A dev app is named "Dev: <file name>", so it never
  gets the permissions of a published app with the same name, and it is
  not kept in folders or reopened after a restart.

### Changed

- **Drag apps out of an open folder** _(GO)_ — in the library's Pinned
  tab, an app dragged off an open folder's panel (and held there for a
  quarter second) closes the folder and keeps moving over the main grid.
  The folder under the finger lights up, and dropping the app on it moves
  the app there; dropping it anywhere else puts it back in its own folder.
- **Group invite cards in chat** _(GO)_ — the full group name (two lines,
  with the public/private icon inline) and two lines of description; a
  small Join / Apply / Pending button sits beside the Group Score, with
  the member count under it.

### Fixed

- **Chat no longer jumps near group invites** _(shared)_ — when a message
  above the screen changed height (an invite card loading, say), the chat
  showed everything shifted for one frame and flickered while the finger
  was still. The rows now redraw in the same frame as the scroll fix, and
  the invite placeholder has the loaded card's height.
- **No "Your apikey is invalid" on public nodes** _(GO)_ — an error page
  from a busy public node at login was read as a refused key, so GO showed
  the API key dialog and stopped the unlock until the app was reopened a
  few times. Only a real refusal (HTTP 401/403) counts now; on a public
  node GO never asks for a key, and a node that does not answer goes on
  as unreachable. Unlock diagnostics say "public node".
- **Torq notifications open Torq** _(GO)_ — Torq's mention, reply and
  follow alerts showed Quitter's avatar and opened Quitter, because the
  app's own rules point there. The bell, the history and the phone
  alerts now use the avatar and link of the app that set the rule, keeping
  the post's path (or that app's start page), and show its registered
  name.
- **Drafts stay in the channel they were started in** _(GO)_ — an unsent
  message was saved for the whole group and a group always opened in
  General, so tapping a group marked "Draft" put the draft into General,
  where it could be sent by mistake. Each channel now keeps its own draft
  (its text, and its attachments while the group is open), and a group
  with a draft opens in the channel of the draft typed last; a tapped
  notification or a share still picks its own channel. Channels with a
  draft are marked "Draft" in the channel list, and switching channels
  swaps the composer to that channel's draft. Switching channels also ends
  a message edit, and the text of a message being edited is no longer
  saved as a draft. A draft in a channel that was deleted since is
  dropped. Drafts saved before this stay with General.
- **Coming back to Chat keeps the channel and the text** _(GO)_ — going to
  Home or Apps and back put the open group back in General, emptied the
  composer (the draft was still stored, and the next keystroke wrote over
  it), and dropped the reply being written and the expiry picked. The
  chat now comes back in the channel it was in, with its draft, reply and
  attachments; a message being edited ends then, with the draft back in
  the composer. A composer that turned read-only while the user's rights
  were loading gets its draft back once they can write.
- **Home, Apps and Chat buttons step aside for panels** _(GO)_ — the
  floating round buttons covered the last rows of the phone channel list
  and the in-chat message search (its last results and page buttons).
  While one of those is open, the buttons slide off the bottom edge and
  come back when it closes; nothing behind the panel moves. On tablets in
  portrait, the Q-Chat overview beside the lists can now scroll its last
  cards out from under the buttons.

## [0.0.17] — 2026-10-11 (GO 3.0)

### Added

- **QDN publish window you can minimize** _(GO)_ — when a Q-App publishes
  a big file (5 MB or more) or a publish takes over 8 seconds, GO's own
  "Publishing to QDN" window takes the place of the app's progress window
  (qapp-core's "Publishing Status", Q-Share's list and the like). It shows
  the overall percent, MB sent, speed and time left, and each file's state.
  "Keep using <app>", the arrow, a pull down, Android back or a tap beside
  it shrinks the window into a round bubble on the screen edge, and the app
  can be used while the files go up. The bubble shows the app's icon in a
  ring that fills as parts reach the node, spins while the node builds the
  file, and turns green with a tick (then leaves) or red with "!". Drag it
  anywhere; it settles on the nearer edge and keeps that place. Tap it to
  open the window again; from another screen, "Open <app>" goes back to the
  app. When the publish ends, the app gets its own window back if it still
  shows one (a failure with Retry, say). An app whose own window GO cannot
  find only gets the bubble. GO's own publishes (Home composer, chat images)
  are unchanged, and Q-Apps still get their PUBLISH_STATUS messages as
  before.
- **Pick the channel when sharing into a group** _(GO)_ — after "GO Groups"
  in the share sheet, the group tapped in the list shows its channels over
  the list (the group's own channel list: categories, unread badges), with
  the shared item still waiting in the header ("pick a channel"). The
  channel tapped opens with the item in its composer; before, it always
  went into General. A channel only admins post in is greyed out ("admins
  only") for members. A group with one channel you can post in goes
  straight in, as before. Back (or the arrow) returns to the Groups list
  with the item still waiting; back again drops it.
- **Delivery ticks for group posts and Saved Messages** _(GO)_ — Your own
  posts in groups (thread replies and attachments too) and in Saved
  Messages now show a small icon beside the time. A clock ("sending")
  for the first 12 seconds; then a crossed-out cloud in warning colour
  ("not picked up yet") while no other node has fetched the post from
  this phone; a double tick
  ("delivered") once one has. A group member's node counts, and so does
  Your own Hub or another of Your devices; the icon is the same, and the
  tooltip says which. "Delivered" means a node got it, not that anyone read
  it. The tick only comes when a transfer this phone sent was confirmed by
  the other side, never from a guess or a claim. Saved Messages get the
  icon only once GO knows You have another device that pulls them (Your
  Hub, say), so a phone-only account sees no warning cloud. GO sends
  nothing extra over the network for this and needs no update on the
  Hubs. Posts from before this update, and posts written on Your other
  devices, show nothing. The cloud goes after 29 days for groups and 48
  hours for Saved Messages, when this phone stops offering the post. DMs
  to other people keep their ticks as before.
- **Picture in reply quotes** _(shared)_ — replying to a message with a
  picture shows a small thumbnail of it in the reply strip above the
  composer and in the quote on the sent reply (GIFs too; videos show a
  video icon). It only uses pictures already on the device, so nothing
  extra is downloaded. Image-only quotes now say "Photo"/"GIF" instead of
  "Attachment".
- **Copy diagnostics: much more detail** _(mobile)_ — new Device, Sync
  health, Serving, Python bridge and Recent app errors sections; engine
  loop lag, worker→native timing and late replies, membership timing and
  own-address share, every send attempt and send times, log line counts,
  stall-watchdog lines. Numbers and per-report pseudonyms only.
- **Landscape and tablets** _(GO)_ — GO keeps its own phone layout at
  every size and in both orientations; on tablets turned sideways the chat
  used to go blank. Tablets show the chat list and the open chat side by
  side (from 760 px wide), and turning the phone keeps the open chat. In
  landscape Home/Apps/Chat sit in the top bar, the side navigation bar and
  the camera cutout get room, the composer is always there, and the
  keyboard height is remembered per orientation. Dialogs, Home, Tabs and
  the PDF and picture viewers fit short screens; full-screen video no
  longer forces landscape on tablets.

### Changed

- **Chat engine no longer rewrites gap bookkeeping it doesn't use**
  _(shared)_ — the background "missing messages" check picks one row per
  group in one query and writes only the rows it really tries; it used to
  rewrite every waiting row every few seconds, which froze the engine for
  seconds on slow phones. Waits count from the end of a run. Own posts and
  the open chat go first.
- **Fewer useless writes from peers' gap lists** _(shared)_ — gaps GO
  already knows cost no writes, the rest go in one write, and the check
  runs at most once per group per minute.
- **No endless page repairs at equal heads** _(shared)_ — when a peer's
  newest message and channel heads match, GO skips page repairs; other
  equal or behind cases get one try per group, then wait 10, 30 and 120
  min while tries bring nothing. An inserting repair resets the wait, and
  opening the chat allows one try at once.
- **Sending doesn't wait on the node for Your own membership** _(mobile)_
  — GO answers from Your group list and asks the node in the background; a
  node "not a member" still wins. At start GO waits up to 2.5 s for the
  list instead of refusing Your own Hub.

### Fixed

- **Membership answers kept when the phone was busy** _(mobile)_ — a late
  12 s timer waits 1.5 s more once.
- **"Invalid event" after a retry** _(shared)_ — a retried message the
  phone already saved counts as sent, and is re-sent once if the first send
  reached no one; real failures keep the old text and log why.
- **"Invalid Data" boxes clear themselves** _(shared)_ — a row that fails
  to draw is tried again, then redrawn when its data changes (at most 3
  times a minute). Bad reaction data no longer breaks a row, and the
  who-reacted list closes when its last reaction goes.
- **No full-screen "GO runtime error" for a drawing hiccup React recovered
  from** _(shared)_.
- **Translated reply and viewer labels** _(shared)_ — the quote header on
  replies ("Replying to you", "Replying to <name>") was English in every
  language and is now translated; so is the image viewer's picture label
  (read out by screen readers), and Chinese "attachment" no longer reads as
  "emotional attachment".
- **Private Q-Apps open on a public node** _(mobile)_ — GO now builds a
  private Q-App on the phone instead of asking the node to. The node needs
  its API key for that, so a public node always refused. The decrypted app
  stays in memory and is served to its frame at the node's own preview
  address, with the same additions (q-apps.js) and policies as a node-built
  preview. No node sees the decrypted app, and nothing is written to disk.
  An app is dropped when its tab closes. Refresh builds it again.
- **Clear errors instead of "Failed to execute 'atob'"** _(shared)_ — when
  the node cannot get a private app or the group's key, as a public node
  often cannot, GO now says so ("couldn't download … from the node, try
  again later"). Before, it decoded the node's error text as if it were the
  data. This also covers Q-Apps that encrypt or decrypt for a group.
- **Private Q-App frame address without the API key** _(shared)_ — on
  desktop, the node-built preview's address no longer carries the node's
  API key, which the app could read.
- **Private Q-Apps pinned once** _(shared)_ — adding the same private app
  again opens it without pinning it again. Groups whose privacy is not
  cached yet now show in the private app dialog (from upstream).

## [0.0.16] — 2026-10-08 (GO 3.0)

### Added

- **Chats open with their messages** _(shared)_ — a chat opened before shows
  its messages at once and then refreshes them quietly. On phones GO also
  reads ahead the 6 most recently active groups and 6 most recent DMs in
  idle moments, so they open ready too: messages from the phone's own chat
  database only, sender names from your own Qortal node. Kept in memory only
  (never on disk), emptied on lock, logout and account switch, paused while a
  chat is open; a chat with newer messages than its copy opens the usual way
  (unread marker in place), and expired disappearing messages never show.
- **Share into GO chats** _(GO)_ — the Android share sheet has "GO Groups",
  "GO DMs" and "GO Self-DM" for photos, videos, files, links and text from
  other apps. Groups and DMs open that list in Q-Chat with the shared item
  where the search, new and settings buttons are (an X or back drops it);
  the chat tapped takes it into its composer, and a picture there asks to
  compress or send as a file, as when attached. Self-DM puts it straight
  into Saved Messages. The item waits until the chat can take files, so it
  is no longer lost when a group or DM was still opening, when the list was
  slid over an open chat, or when Chat was in the background. No single
  chats are offered in the share sheet or the launcher (earlier test builds
  did; their entries are removed).
- **Immersive mode** _(GO)_ — Home settings → System → Immersive mode: Off,
  Auto or Manual, for open Q-Apps and websites (the Q-Apps library keeps its
  bars). Auto slides the top bar and the
  bottom tab bar away when scrolling down and brings them back when scrolling
  up, at the top of a list and on a new screen. Manual keeps them hidden. In
  both, the Android status bar is hidden (a swipe from the top shows it for a
  moment); content stays clear of the camera, and the strip around it takes
  the page's own background colour (read on the phone from the screen edges,
  where cards and pictures usually stop) and fades out over the top of the
  content, so it stays one calm colour per Q-App or website and posts and
  pictures slide under it. When a photo or video reaches the sides (a
  full-screen viewer, a story), it takes the colour right under it instead
  (a viewer's black header), or black, never a colour out of the picture. While the bars are out, that colour also fills the
  top bar's area, with the bar itself see-through (search field, Tabs and
  avatar float on the app's colour; on a light page in the dark theme the bar
  keeps its own background so its controls stay readable). In Manual, a
  small floating button brings the bars back for
  4 seconds; using the bars keeps them out longer and a tap on the content
  puts them away. The button can be dragged along either edge and remembers
  where it was left, fades when left alone, and carries a dot for new chats
  or bell items; a one-time bubble explains it. Q-Apps and websites resize to
  fit (once per change, never under a bar), and scrolling inside them is
  followed through the finger's direction, since their frames hide it from
  GO. Home, Chat, full-screen panels, the lock screen and the full-screen
  composer keep the normal layout.
- **Floating tab buttons** _(GO)_ — the bottom bar is now three round glass
  buttons (Home, Apps, Chat; icons only), everywhere. With immersive mode on, Home, the
  Chat lists and conversations, and the Apps library scroll on behind them,
  with room at the end of each list and the chat message box kept above them;
  taps between the buttons reach the content. With it off, and always in a
  Q-App or website (so its own bottom menu is never covered), the content
  ends above the buttons, which sit on the page colour. On Home,
  in Chat and on the Q-Apps library the top bar takes the page's own
  background (on Home including the shell's soft wash) and loses its divider,
  so it blends into the page. With immersive mode on, the phone's status bar
  is also hidden on the Q-Apps library, which keeps GO's own bars.
- **Swipe between Home, Apps and Chat** _(GO)_ — a sideways swipe moves to
  the next section like turning a page: the current one follows the finger
  and the next slides in beside it with its real content (Home, the Q-Apps
  library or Your last Q-App, the chat lists), then it lands where the round
  buttons would take You. A quick flick is enough; a short, slow drag
  springs back, and Home and Chat stretch a little at the ends. Swipes stay
  with whatever handles its own: Q-Apps and websites, carousels such as
  Featured apps, sliders, text fields and open chats; in Chat the
  Groups / DMs swipe keeps working and hands over at its edge (swiping right
  on Groups goes to Apps). Chat is now kept in the background like Home
  (built once soon after start), so coming back to it is instant, and every
  section, the Q-Apps library included, comes back scrolled where You
  left it. Home keeps its exact
  layout while parked (the Qortino card stays built, Wallet Activity keeps
  its last entry while refreshing), so it slides in and lands precisely where
  it was left.
- **Settings on phones** _(GO)_ — Android back (the side swipe) closes
  Settings and returns to Home instead of leaving GO; the close button is a
  big round one at the bottom right; a sideways swipe on the page moves
  between the tabs (the page slides out and the next tab slides in, the
  open tab's chip scrolls into view).
- **Swipe between tabs** _(GO)_ — a group's Members panel (members,
  invite, invites, bans, join requests) moves between its tabs with a
  sideways swipe, like Settings.
- **Swipe out of a chat** _(GO)_ — on an open DM or Saved Messages, a
  swipe to the right takes You back to the DM list, like the system back;
  on a group chat, to the right goes to the Groups list and to the left to
  the DMs (in the order of the Groups / DMs switch). The chat follows the
  finger off the screen and the list it leads to comes out from under it. A
  short, slow drag springs back; the message box, pictures, the channel
  list and anything that scrolls sideways keep their own drags. It replaces
  the edge swipe that slid the list over an open chat.
- **One Q-Chat header on phones** _(GO)_ — the Groups and DMs lists now sit
  under one header that stays still while only the lists slide: the
  Groups / DMs switch's pill follows the finger and glides to where the
  swipe lands, and the buttons belong to the list showing (the new-group and
  new-chat icons cross-fade on the way). Q-Chat settings are on both lists.
- **Search your DMs** _(GO)_ — the search button on the DMs list searches
  the text of every direct message on the phone (Saved Messages included):
  newest first, with who it is with, when, and the words around the match
  highlighted. Tapping a result opens that chat at the message, loading
  older history when the message is further back than the chat loads.
  Edited messages are found by their current text; deleted ones, and
  messages from people You silenced, are not.

- **Pull down for Tabs** _(GO)_ — on Home, the Q-Apps library and the chat
  lists, pulling down when the list is already at the top brings the Tabs
  window down with the finger. Let go past about a third of it (or flick
  down) and it stays open; otherwise it slides back up. The list under the
  finger holds still meanwhile. Sideways swipes, long presses and lists
  scrolled down are left alone, and so is Home scrolled down, even on a
  window with its own list at its top (the feeds used to pull Tabs down from
  the bottom of Home).
- **Search a group's members** _(GO)_ — the Members screen of a group chat
  has a search button: suggestions show as You type (names starting with it
  first, then names containing it, then addresses), each with the avatar, the
  typed letters picked out, an Owner or Admin tag and a short address, up to
  eight and "N more". Tapping one (or the keyboard's Enter for the first)
  takes You to that member in the list, opening their folded section if
  needed, with a short highlight. Android back closes the search first.
- **Rearrange Home** _(GO)_ — long press the background of any Home window
  (not a button or link) and every window folds into a short labelled strip,
  the held one under the finger; drag it up or down, the others make room,
  let go and they unfold in the new order, the moved window where the
  finger left it. Saved on the device; Profile settings can reset it. The
  strips only move and fade, and the windows take their new places without
  being redrawn, so it stays smooth on phones.
- **Torq Revs from GO** _(GO)_ — with Torq chosen on Home, the Post to
  Torq panel has a Rev button that opens Torq's own Rev editor, and the
  Android share sheet gets a "Torq Rev" entry next to "Torq": one photo or
  video opens the Rev editor with it (photos lose their location data first;
  videos over 100 MB get a note and an empty editor). With Quitter chosen,
  neither Torq entry shows. Needs Torq 1.3 (its rev/new link and
  OPEN_REV_COMPOSER message).
- **Wallet Activity history** _(shared)_ — under the latest payment, a
  Transaction history row opens the account's payments, newest first: who,
  sent or received, when, and the amount, 20 at a time with Show more. Tap a
  name to look the account up. It refreshes when the balance changes.
- **More Home switches** _(shared)_ — Qortino AI, Featured Q-Apps and Status
  can now be turned off too, next to Group Activity and the Torq/Quitter
  feed. Turning off Qortino AI keeps the hotkeys.

### Changed

- **Updates open in Q-Share** _(GO)_ — GO 3.0 Updates links each build to
  Q-Share again ("Open in Q-Share"), which now does what Q-Share+ did.
- **Names at once** _(shared)_ — a sender name GO has seen (a lookup, a
  group's member list, the DM list, your own) shows from the first frame in
  every chat, also for new messages; DMs show their messages without waiting
  for the name lookup.
- **Tabs: a small swipe scrolls, a big one closes** _(GO)_ — on the open Tabs
  window a short swipe up scrolls the tabs and a long one closes the window,
  also on the strip below the panel.
- **Torq Feed reads like Torq** _(shared)_ — Following counts every account
  You follow (it stopped at the newest 24), and deleted or oversized posts
  are skipped before they are downloaded, as in Torq's own feed.
- **Immersive mode starts on Auto** _(GO)_ — new installs (and anyone who
  never picked a mode) get Auto; a saved Off or Manual is kept.
- **Torq is Home's default** _(shared)_ — Home's composer, feed, Featured
  Q-Apps and the share sheet start on Torq; a saved Quitter choice is kept.
  The Post to Torq panel says "Harness Your unmutable momentum!" and its Rev
  button sits above Compose.
- **Suggest a module** _(shared)_ — opens the GO 3.0 group's invite in Q-Chat
  instead of a Q-Mail draft.
- **Home switches moved to Profile** _(shared)_ — the Modules tab is gone:
  the switches for what Home shows sit in Home settings → Profile, under the
  wallet address.
- **Recommended hotkeys** _(shared)_ — Torq instead of Quitter, Q-Share+ and
  Q-Mail+ instead of Q-Mail; all recommended apps are listed (it stopped at
  six). Scrolling the Select hotkeys results closes the keyboard.

- **Search suggestions on phones** _(GO)_ — the results under the top
  bar search reach down to just above the keyboard (or the round tab
  buttons when it is closed) instead of stopping short, and look cleaner:
  bigger icons, the typed letters picked out, an App or Website tag beside
  each publisher (many results share a name), a small arrow on the result
  the keyboard's Go key opens, and a quiet "Apps & websites" heading.
- **Find Groups on phones** _(GO)_ — opens full screen with the panel header
  the group panels use (Android back closes it); the rows fit a phone, with
  the member count and score under the name and the filter chips in one
  row that scrolls sideways (the whole panel stays within the screen).
- **Smoother switching between Home, Apps and Chat** _(GO)_ — measured on a
  phone frame by frame and reworked:
  - GO's UI no longer re-renders as a whole when the shell changes (bars
    sliding, the keyboard, balance updates), and a hidden Home or Chat no
    longer re-renders in the background on every update (that alone kept
    the phone busy for up to two seconds after a switch). Showing Home
    again no longer rebuilds it.
  - The sections beside the one showing are laid out and painted ahead of
    time (just off screen, hidden from screen readers), so a swipe only
    moves them: no hitch when the next section first appears (showing a
    hidden one cost about 40 ms of style and paint right then). A section
    that springs back, or stays beside the new one after a tap on the
    buttons, keeps waiting where it is instead of being built again. The
    next section never trails a frame behind.
  - A quick second swipe while the first is still gliding now counts (the
    first lands at once and the new one carries on from there), instead of
    being ignored. The work after a swipe lands (the new section starting
    up) now gives way to the finger, so a quick next swipe never waits for
    it, and it no longer jolts a swipe already under way.
  - A Q-App sliding in is already laid out as it stays: its own bottom menu
    no longer jumps up after it lands.
- **Smoother Groups ⇄ DMs** _(GO)_ — swiping (or tapping the switch)
  between the Groups and DMs lists starts gliding at once: the switch
  itself, which re-renders the whole chat, now happens once the glide is on
  screen instead of holding its first frames back (the lists sat still
  under the lifted finger, then jumped). The switch's pill glides on the GPU
  too, so it no longer stutters while the chat catches up.
- **Swipe along the bottom bar** _(GO)_ — swiping sideways on the round
  Home / Apps / Chat buttons (or the whole bottom strip where nothing
  scrolls behind it) switches sections too, also from inside a Q-App or
  website, whose own swipes stay theirs.
- **Immersive bars glide on the GPU** _(GO)_ — the content and the coloured
  edge strips now slide on transforms, which keep moving even while a Q-App
  keeps the page busy (before, the slide could drop to a few frames a
  second), and start on the very next frame after the scroll or finger drag
  that moves them, rather than after whatever else was waiting. The edge
  colour is no longer read while the bars slide: a header passing through
  the read band used to flash the strips and the see-through top bar dark
  and back.
- **Top bar blends into light Q-Apps** _(GO)_ — with immersive mode on, the
  top bar now floats see-through on every Q-App's own colour, light pages
  included: its search field, Tabs button and avatar are drawn light over a
  light page (even in GO's dark theme) and dark over a dark one, switching
  halfway through the colour's cross-fade so they always read. Before, a
  light page kept GO's dark bar on top of it. The search field is a soft
  tint of the page instead of GO's paper colour. Menus and dialogs opened
  from the bar keep GO's own theme.

### Fixed

- **The first tap after a swipe works** _(GO)_ — after swiping to Chat, between
  Groups and DMs, or back out of a chat, the first tap on a group or DM did
  nothing. The sideways swipe left an invisible scroll fling behind in the
  browser engine, and the tap that stopped it was thrown away. Fixed (the
  lists allow sideways panning, which nothing there uses), and a tap while a
  switch is still settling now finishes it at once.
- **No stray full download when a group opens** _(shared)_ — for a moment on
  every open, a group chat also fetched all of its messages from the node and
  opened a live connection, only to throw them away.
- **No more "black and back" flashes** _(shared)_ — every few minutes, and
  after each start, the screen went black for a moment: the idle-time
  animation pause replayed entrance animations that had already finished.
- **Phone gossip goes to 4 neighbours, not all of them** _(GO)_ — DM
  notices, DM probes and group subscriptions that Hub sends to 4 neighbours
  went to every neighbour from a phone (up to 12 on battery, 20 while
  charging on Wi-Fi), because the phone's bridge dropped the limit. Now they
  go to 4, as on Hub. A DM the other side hasn't confirmed still goes to
  everyone after 3 seconds.
- **Opening a chat no longer resends every group subscription** _(GO)_ —
  each time a group chat, a channel, the members list or Qortal Land opened,
  and each time the group list refreshed, GO sent a hello, all its group
  subscriptions and up to 20 group digests to every neighbour, right while
  the chat was loading its own messages. Now that happens only when the
  groups change, and once after the network comes up.
- **Admins-only channels show just a notice on phones** _(GO)_ — in a
  channel where only admins can write, members saw the composer frame with
  its buttons behind the "Only group admins can write in this channel"
  text. Now only that line shows, above the tab buttons.
- **DMs after a restart wait for a real connection** _(GO)_ — at start GO
  counted the peers it had seen in the last hour as live, so it thought it
  was connected before any link was up. The first DM catch-up then went
  nowhere and the next try came about 15 minutes later, and a phone that
  had been offline could stop retrying a DM for up to 2 hours. GO now waits
  for the first real link and starts the catch-up the moment it is up.
- **Accounts with 45 or more groups reach Hubs further away** _(shared)_ —
  a list of 45–50 groups was too big for one packet once a Hub passed it
  on, so it was dropped without a word and Hubs further away never learned
  that the account wanted those groups. Group lists now go out in pages
  that still fit after relaying, and a list that is too big is split when
  GO passes it on.
- **Lighter sign-in** _(shared)_ — signing in announced every group to
  every neighbour one by one (43 messages for a 43-group account) before
  sending them all again in one go. Groups that join while the first ones
  are still going out now share one message.
- **Faster back online after switching networks** _(GO)_ — moving between
  Wi-Fi and mobile data kept the phone "online", so GO noticed the dead
  hub connections only after up to about two minutes. It now reconnects to
  the hubs as soon as the phone settles on the new network.
- **Opening a chat is lighter** _(shared)_ — every open also read the
  group's 500 newest messages into a list nothing used.
- **New messages in the open chat come first** _(shared)_ — downloads for
  all groups waited in one line, and one unreachable peer could hold up
  every download, the open chat's new messages included, for up to 30
  seconds. The open chat now goes first, and a slow peer only holds up
  its own downloads.
- **More peers to ask for older messages** _(shared)_ — scrolling up asked
  one peer and kept two others in reserve in case it failed. GO now keeps up
  to five in reserve, since peers often hold an incomplete copy of a
  channel.
- **No pile-up when the phone's chat bridge is full** _(shared)_ — failed
  sends were retried every 3 seconds even when the bridge itself reported
  its queues full, adding to its backlog. Retries now wait (3 to 20
  seconds) while it stays full, and relaying other people's group traffic
  pauses for a few seconds so Your own messages get through first.
- **Online count comes back after GO's screen reloads** _(GO)_ — when
  Android restarted GO's web view in the second right after sign-in, while
  presence was still starting, everything presence sent went to the closed
  screen: the new one showed 0 online and "connecting" until GO was
  restarted. Presence now always talks to the current screen, and a screen
  that hears nothing asks presence again (up to 3 times).

## [0.0.15] — 2026-10-05 (GO 3.0)

### Changed

- **Chat text size: Small, Default, Large** _(shared)_ — the Q-Chat setting
  (chat settings → Text size) offered Default, Medium and High, where Medium
  and High were only 1 and 2 px bigger and reached group message text, the
  message box, channel rows and the members list. It now offers Small (14 px
  message text), Default (16 px, the size the chat always had) and Large
  (19 px), and the size reaches DMs and threads too, with sender names,
  timestamps, "edited", reply cards, the typing line, call and friend rows,
  the Select text sheet, and text not wrapped in a paragraph (headings and
  code follow it). The small labels move a gentler step, so Small keeps them
  legible; the message box hint stays at the default size on Large, so it
  is not cut down to a few letters beside the phone's buttons. File,
  invitation and link preview cards, reactions and buttons keep their
  layout. The settings show a live preview of a chat at the chosen size and
  an "Aa" at each size; the desktop dialog is taller so all three fit. A
  saved Medium or High reads as Large. Strings in all 12 languages; dev
  preview `tools/preview/chat-text-size.html`, and `chat-composer.html` takes
  `?scale=small|large`.
- **Message actions open like Telegram's** _(mobile)_ — tapping a chat
  message no longer opens a bar under it that pushes the conversation down.
  A popup floats where the message was touched instead: a pill of quick
  reactions (👍 💯 😂 ❤️ 🔥 🙏 😮, six on narrow phones) above a short menu
  with Reply, Reply in discussion (or View N replies), Copy, and Edit and
  Delete on your own messages. The chevron at the end of the pill grows it
  into a full emoji grid with category tabs and a Recently used row; emoji
  newer than the phone's font are left out, so no empty boxes. A long press
  opens the same popup with Select text added and a details card: when the
  message was sent, when it was edited, and when it expires (or that it does
  not). Reactions you already gave are marked and a tap takes them back.
  Android back closes the grid, then the popup. Threads stay read-only: a
  long press there only copies. The popup moves up to stay on screen for a
  message near the bottom. A tap on a picture opens the picture, not the
  popup, and the tap that closes a user card (or anything else drawn over a
  message) no longer opens it either. The desktop hover bar and right-click
  menu are unchanged. New strings in all 12 languages.
- **Cancelling an edit is easier to find** _(mobile)_ — while a message is
  being edited, the faint "EDITING MESSAGE:" line with a grey X is now a
  card like the reply strip: an accent bar, a pencil and "Editing message"
  in the accent colour, and the X on a filled round button. Desktop is
  unchanged.
- **Unread in another channel shows in the chat header** _(mobile)_ — a
  group opens in its default channel, so when the new messages were in
  another channel nothing in the conversation said so. The channel opener
  under the group name now shows a dot by its arrow: blue for unread, red
  for a mention, as in the group list. Only channels you can see count.
- **Status follows the account across GO and Hub** _(shared)_ — picking
  Online, Busy or Offline (under the avatar on Home, or in the Hub account
  menu) now switches the account's other devices too. It travels as the
  signed own-device record `presence.status` over the same `ds1` sync as the
  notification settings; the automatic Idle stays per device. Needs a Hub with
  `ds1`. The Hub "Status" card is now a shared `AccountStatusPicker`.
- **Avatar menu closes as tiles** _(mobile)_ — swiping the menu up (or
  closing it any other way) left an empty panel behind while the items slid
  away. Now the panel's background dissolves at once and the header and each
  item leave as separate cards, one by one from the bottom, following the
  finger. A tap on the dim right after a short swipe is no longer swallowed,
  and the list no longer shows a horizontal scrollbar while items slide.
- **Settings trimmed on GO** _(mobile)_ — the Home settings dialog had no
  phone branch, and many controls only wrote to the desktop settings store, so
  on GO they did nothing or showed wrong values. GO now leaves out the
  Developer, Help and Reticulum tabs, and in System: Reticulum group chat,
  attachment storage, community call support, developer-log filtering, close
  window behaviour, "Reduce app notifications" (already in the Notifications
  panel) and the pinned Q-App backup (it publishes Hub's dashboard pins, which
  a phone could overwrite with an old list).
- **Blocked accounts** _(shared)_ — a note explains that on a public node its
  operator decides who is blocked, and that full control needs your own node
  (all 12 languages). On phones the list no longer pushes the Unblock buttons
  off screen, and addresses are shortened in the middle.

- **"GO was stopped in the background" no longer pops up on every return**
  _(mobile)_ — on phones whose maker freezes background apps (measured on a
  vivo with OriginOS 6), the warning opened as a full-screen window over chats
  after almost every screen-off. Nothing limited it, and "Open battery
  settings" did not count as seen.
  - **Where it shows:** a quiet card in the bell, plus the facts in Settings →
    Background sync.
  - **When it shows:** only after 2 freezes of 5 min or more in a week. After
    that, at most every 14 days, and at most 3 times in total.
  - **Don't show again:** a tick stops it for good. Warnings can be turned
    back on in Settings.
  - **Steps inside GO** for the phone's brand: vivo/iQOO, Xiaomi, Samsung,
    OPPO/realme/OnePlus, Huawei/Honor, and a general version. These replace
    the dontkillmyapp.com link, so GO no longer sends people to an outside
    website.
  - **Buttons:** "Allow GO in background" opens Android's own dialog. "Open
    battery settings" opens vivo's Battery page on vivo phones.
  - **Honest text when exempt:** if GO is already exempt and still gets
    frozen, the card says so instead of asking again.
  - **Copy diagnostics** now lists recent freezes.
  - **Startup prompt:** "Not now" on the "Keep Qortal Go reachable" prompt
    waits 14 days before asking again.
- **Avatars and Q-App icons cached on the device** _(shared)_ — on a slow or
  unreachable node, avatars and icons kept failing to load. They are now kept
  in a device cache (IndexedDB, copies at most 128 px) and shown at once:
  - **Bundled icons:** 36 popular Q-Apps ship inside the app (about 96 KB).
  - **Covered surfaces:** Home Featured tiles, the Q-Apps library, group and
    DM rows, chat headers, members, calls, notifications and link cards.
  - **Re-checks:** each avatar is re-checked quietly about once a day, so a
    changed avatar shows up. The exact time differs per avatar, so they don't
    all re-check at once. A name with no avatar is re-checked every 6-7.5 h.
  - **Login prewarm:** at most 40 avatars the account already shows, one at
    a time, never ahead of avatars on screen.
  - **Removing an account** from the device also empties the cache.
- **Featured Q-Apps tiles** _(shared)_ — the Q-Tube tile's tagline sat on top
  of the Q-Tube icon on phones and was cut off ("decentralizec"). It is now
  "watch. / share. / own it." (all 12 languages), placed beside the icon
  column like Q-Chat's "talk. / connect. / freely.", and both wide tiles
  measure their tagline: when it does not fit (very narrow screens, long
  translations) it is hidden and the icon centres, instead of overlapping.
- **Q-App approval window** _(shared)_ — redesigned to fit a phone screen: the
  requesting app's icon (its QDN `qortal_avatar`, with the Qortal logo while
  it loads or when it has none), name and type in a compact header with a
  small countdown; the question at normal size instead of a four-line
  headline, and no longer repeated under "What you are approving";
  "label: value" details (service, identifier, Tx type…) as tidy rows; for a
  payment, the amount large with the recipient's name and full address
  (fixed-width) in the same card; transaction data in a compact scrolling
  panel; Decline/Accept always visible at the bottom. All questions are
  shorter — "Allow this app to …?" instead of "Do you give this application
  permission to …?" — in all 12 languages. Dev preview:
  `tools/preview/approval-dialog.html` (`npm run dev`, never shipped).

### Fixed

- **A saved account whose key belongs to another address** _(shared)_ — GO
  unlocked a saved account by deriving its key from the encrypted seed and
  never checked that the key's address matched the account. A saved copy
  whose `version` or seed did not match its `address0` therefore signed as a
  different address on every unlock: chat sends failed with "author
  mismatch", every group stayed dark ("local signer is not a group member",
  peers answering `requester_not_group_member`) and only the built-in
  channels showed. Unlock now checks the derived address. When only the
  wallet version is wrong it uses the right one and saves it (the unlock
  timings note "version fixed"); otherwise it refuses with a message to
  remove the account and add it again from the seed phrase or a fresh Hub
  backup, and stores no key. The same check covers session resume, the
  app's boot restore, sending QORT with a password, Backup wallet / Download
  account (which wrote a file named after the account but holding the other
  address) and the private key reveal (which showed the other address's
  key). Signer error texts are translated in all 12 languages.
- **Password login offline opened "Set up Qortal Core"** _(mobile)_ — with
  no internet, a password unlock checked the node, found it unreachable,
  opened the desktop Core download window and stopped the unlock; the
  fingerprint unlock skipped that check and worked. On GO an unreachable node
  no longer blocks a password unlock and the Core window never opens. Online,
  a private or custom node that does not answer still says the URL is
  invalid, and a node that rejects the API key still asks for it.
- **DMs showed "delivered" but never arrived** _(shared)_ — a sent DM got
  the double tick as soon as the sending device approved the recipient's
  request for it, before anything was transferred. A slow phone often approved
  too late for the desktop's 10 s deadline, so the transfer never happened,
  yet the message showed delivered and was never offered again. The
  recipient's sync then only asked a sender for messages newer than the
  newest it already had, so once a newer message came from the sender's
  other device (e.g. their Hub), the missed ones were skipped for good. Now:
  - The double tick needs proof: the transfer finished at the recipient, or
    the recipient's own signed notice names that message. Each message shows
    its own state; a later delivered message no longer marks earlier ones,
    and copies of your messages written on another device show no tick.
  - GO, as the recipient, asks each sender device once (at most 3 tries per
    run, never while another request to that device is open, progress saved)
    for the 7 days behind its newest message, so skipped messages come back.
    The desktop Hub does not do this.
  - Re-announces of a message that is still waiting sometimes leave out the
    "latest" hint so holders re-check from their own position; a phone always
    leaves room for one newer message when it re-serves older waiting ones,
    so older Hubs cannot loop.
  - GO answers DM requests on the phone bridge's fast DM queue instead of
    behind group history work; the log shows the requesting peer, how long
    the answer took and whether delivery was confirmed.

  Messages that earlier GO builds already marked delivered are not reset: a
  GO recipient's look-back can still fetch them, a desktop Hub recipient
  cannot.

- **DM answers held up by a busy phone** _(mobile)_ — measured on a phone:
  GO normally answers a desktop Hub's request for a DM page in under 3 s,
  but during bursts of group traffic its Reticulum bridge fell 20–30 s
  behind and the desktop gave up after 10 s. The bridge now keeps request
  slots and capacity free for DM pages, limits how much group history it
  serves at once (other devices are asked instead), lets its network reader
  threads run more often and no longer makes them wait on the bridge's main
  lock. Each DM answer is logged with a time breakdown (arrival, queue,
  transport, build, authorize, first bytes).
- **One-time repair of false "delivered" ticks** _(mobile)_ — DMs from the
  last 7 days that earlier builds marked delivered as soon as a request was
  approved go back to waiting (they do not count in "N waiting to send") and
  are offered again, so a recipient that never got them, a desktop Hub
  included, can fetch them. Ones the recipient already has get their tick
  back once that is proven.
- **Desktop Hubs flagged GO for "protocol violation"** _(shared)_ — since
  v0.0.10 GO keeps group history up to 2 years old, and it served those old
  reactions, edits and deletes in history pages. Desktop Hubs (3.0.x) refuse
  anything older than 30 days and counted each one as a protocol violation,
  aborted the page and put GO on a 5-minute cooldown, then asked again every
  10–15 minutes. GO now serves only events newer than 29 days to every
  device; older ones stay in GO's own history. Other GO devices no longer
  get history older than 29 days from GO either.
- **Author history sync never ran** _(shared)_ — author manifest sync treated
  "peer identity already known" as a failure and paused with
  `identity_unavailable` for nearly every peer.
- **Read states for left groups resent forever** _(shared)_ — read states of
  groups the account had left were replayed to the user's other devices on
  every pass and always dropped there. They are now skipped.
- **History requests built after they had expired** _(shared)_ — queued
  history-page requests were kept for 30 s, but the bundled bridge stops
  waiting for the answer after 15 s, so later ones could never be served;
  they now expire at 15 s.

- **Someone active on GO showed as Idle** _(mobile)_ — GO kept one presence
  entry per account, so whichever device spoke last won: an idle desktop Hub
  hid the phone the person was using. GO also never counted its own phone for
  its own account, never cleared an account whose devices had gone quiet (the
  last dot, often Idle, stayed until restart), and treated one device going
  offline as the whole account. GO now keeps one entry per device and shows
  the most available status (Busy > Online > Idle), like the desktop. The
  first presence list after start uses the same rule.

- **Private node on a home or VPN address behind a carrier proxy** _(mobile)_
  — GO now sends requests to home-network and VPN addresses (192.168.x,
  10.x, 172.16–31.x, Tailscale 100.64–127.x and fd7a:…, `*.ts.net`) directly,
  in the WebView as well as in native code. Before, a proxy on mobile data
  received them in plain text and could not reach the node. Other addresses
  still use the phone's proxy settings.
- **Q-Apps and sites failed on a private node at 127.0.0.1 on mobile data**
  _(mobile)_ — with GO set to a node on the phone itself (for example an ssh
  tunnel in Termux at `http://127.0.0.1:12398`), opening a Q-App or QDN site
  on mobile data showed the carrier's proxy error page ("The requested URL
  could not be retrieved … Connection refused") instead of the app. The
  public node worked. The Q-App and site part only hit test builds with the
  new native page fetch ("Q-Apps limited to the node" under Security); the
  other requests below had the same flaw in released builds.
  - **Why:** the carrier's mobile network tells the phone to use a web proxy.
    GO's own page requests sent the phone's own address to that proxy, and
    the proxy, a machine at the carrier, cannot reach the phone.
  - **Now:** GO talks to addresses on the phone (`localhost`, `127.x`,
    `[::1]`) and on the local link (`169.254.x`, `[fe80::…]`) directly, like
    the browser part of GO already did. Every other address uses the proxy
    as before.
  - **Same fix** for encrypted video playback, file saves and downloads from
    such a node, the video compressor's download, the updater, Qortino's
    pack download and notification avatars (`LocalHttp`).
  - **Redirects:** each step of a redirect now picks its own way, as in the
    browser part of GO: a download link that redirects to the node reaches
    it, and a download's cookies go only to the address they belong to.
  - **API key:** see "Node API key could reach a carrier proxy" under
    Security.
- **Crash after a night on battery** _(mobile)_ — on Android 15 and newer,
  Android stops GO's background connection after about 6 hours a day and gives
  GO a few seconds to let go. Phones that freeze background apps (measured on
  a vivo, Android 16) kept GO frozen through those seconds, so Android closed
  GO with a crash about a second after the screen came on in the morning.
  - **No deadline to miss:** from Android 14 on, GO's background connection
    runs as a messaging service, which Android does not stop after 6 hours.
    Plugging in or unplugging no longer switches it between two kinds of
    service.
  - **GO's own limit instead:** on Android 15 and newer, after 6 hours in a
    row off screen and unplugged, GO pauses its background connection
    itself, in "while charging" and "off" (never in "always"). Plugging in
    or opening GO resets the count; it starts again at the next unplug or
    when you leave GO. Once paused, GO stays paused, even on the charger,
    until you open it. A charge that happened while the phone held GO
    frozen still resets the count (GO sees the unplug or the higher battery
    level when it wakes up). If the phone froze GO past the 6 hours, the
    pause comes when the phone wakes it up, without a crash. Android 14 and
    older never had this limit and keep running as before.
  - **Honest notice:** "GO paused its background connection after 6 hours on
    battery to save power. Open GO to reconnect." Opening GO reconnects, as
    before. The "Android paused…" text stays for phones where Android itself
    still stops it. New `battery_pause_text` string (English in all 12
    languages for now).
- **Status notification text cut off** _(mobile)_ — with messages waiting to
  send, the collapsed GO notification put the waiting count on a second line
  that Android clips. It is now one line, "Reticulum offline · 4 unsent", and
  the count stays visible while a long status shortens. Expanding the
  notification still shows the full text. New `status_waiting_short` string in
  all 12 languages.

### Security

- **Node API key could reach a carrier proxy** _(mobile)_ — on mobile data
  with a carrier web proxy, GO's own native requests to a node on the phone
  (`127.0.0.1`) went to that proxy unencrypted. Some carried the node API
  key: in a header on saves, updates and pack downloads, and in the address
  of some media, avatar and download requests. Fixed by "Q-Apps and sites
  failed on a private node at 127.0.0.1 on mobile data" under Fixed. If you
  used an API-keyed node on 127.0.0.1 over mobile data, change the key once
  as a precaution.
- **Outside code could run as GO** _(mobile)_ — Capacitor 6.1.2
  (CVE-2026-103922) served any URL under GO's own origin through its internal
  `/_capacitor_http_interceptor_` proxy, even with CapacitorHttp off. A Q-App,
  or one tap on a link in chat, could load attacker code as GO, with access to
  the wallet vault and signing code. Upgraded to Capacitor 6.2.2.
- **Native origin guard** _(mobile)_ — `AppOriginGuardWebViewClient`
  (rules in `AppOriginGuardPolicy`) refuses any frame page on GO's origin,
  any page or HTML/SVG/XML through `/_capacitor_file_` and
  `/_capacitor_content_`, and the HTTP proxy on every host. This also closes
  the saved-HTML route of audit finding GO-01, and holds if a later Capacitor
  regresses.
- **Links back into GO** _(shared)_ — chat and file-viewer links to GO's own
  origin or the phone's loopback (`localhost`, `127.x`, `[::1]`) are refused
  instead of navigating GO's own window.
- **Q-Apps limited to the node** _(mobile)_ — every Q-App or QDN-site page is
  fetched natively (`QappDocumentFetcher`) and gets GO's policy on top of the
  node's (`QappFramePolicy`), as the desktop Hub does: what a Q-App loads,
  fetches and connects to stays on the node. Q-Apps can no longer open other
  apps through `intent:`, `market:`, `tel:` and similar links, install
  service workers, or prefetch other sites.
- **Screen protection** _(mobile)_ — screenshots, recordings, recents
  thumbnails and assistant screen reading are blocked on the unlock and lock
  screens, seed phrase, private key and backup screens, and while a payment
  or Q-App approval is open (`ScreenSecurityPlugin`, `useSecureScreen`).
  Approvals also drop taps through other apps' overlays, and hide overlays on
  Android 12+.
- **App lock** _(shared)_ — the lock survives a reload or crash recovery
  (before, "Reload" re-entered the wallet), covers every dialog and blocks
  Q-App requests while locked; "Lock now" in the phone account menu. Payment
  links opened while locked wait for the unlock.
- **Approval dialogs** _(shared)_ — show which app is asking, queue a second
  request instead of replacing the open one, keep Accept disabled for about a
  second, and require "I have read this request" for every value-moving or
  signing action.
- **Updates and app packages** _(mobile)_ — the updater installs only an APK
  with GO's package name, GO's signing certificate and a higher version code.
  GO never opens or installs any other app package it downloads or receives.
- **Node requests from Q-Apps** _(shared)_ — Q-App values that become node
  paths are checked and encoded, so a Q-App cannot reach other node endpoints
  with the API key (GO-07). The API key is no longer handed to Q-Apps after a
  buy order (GO-33). Users with an API-keyed node should rotate the key once:
  Q-Trade saved it with earlier orders.
- **Payments** _(shared)_ — the fee signed can never exceed the fee shown,
  the recipient is resolved before the dialog and shown in full, amounts are
  parsed strictly, node-supplied public keys must match the address, and a
  multi-payment is signed once (GO-19, GO-20, GO-30).
- **Private keys** _(shared)_ — a foreign-coin key or the ARRR seed leaving
  GO always needs consent, including for local and Tailscale nodes.
- **Hardening** _(mobile)_ — mixed content in compatibility mode, camera and
  microphone only for GO itself, `taskAffinity=""`, WebView content hidden
  from non-accessibility-tool services, Capacitor's server-path override
  disabled, `.html`/`.svg` downloads saved as text, logging and WebView
  debugging off in the shipped config, Capacitor 6.2.2, markdown-it 14.3.2,
  DOMPurify 3.4.16, axios 1.20.0.

### Removed

- **Chromecast and Google Play Services** _(mobile)_ — the native Cast
  plugin (`ChromecastPlugin`, `CastOptionsProvider`), its "casting"
  notification service (`ChromecastForegroundService`,
  `ForegroundServicePlugin`) and the LAN proxy to the Core API that let a
  Chromecast fetch videos (`ProxyServerPlugin`) came over from Qortal Mobile
  with the Android shell, but GO 3.0 never got the Cast button, mini player or
  `CHROMECAST_CAST` Q-App request, so nothing could reach them. Removing them
  drops `play-services-cast-framework`, `mediarouter` and the Google
  `datatransport` / `firebase-encoders` libraries Cast pulled in, and the
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission. GO no longer contains any
  Google Play Services code — one of the blockers for an F-Droid build.
- **`google-services` Gradle plugin** _(mobile)_ — Capacitor template
  leftover. It only ran when a `google-services.json` existed, and none does.

### Privacy

- **No location in shared photos and videos** _(shared)_ — photos and videos
  posted to Quitter, Torq, avatars and sent in chat kept their EXIF/XMP
  metadata (GPS position, phone model, time). It is now stripped losslessly
  before anything leaves the phone (`stripImageMetadata`,
  `stripVideoMetadata`); public posts refuse files that cannot be cleaned.
  The `ACCESS_MEDIA_LOCATION` permission is gone.
- **Received files stay in GO** _(mobile)_ — files received in chat are kept
  in GO's private storage and opened in the in-app viewer; "Save to device"
  exports one when wanted. They are no longer copied to public Downloads, and
  logging out deletes them.
- **Wallet password not offered to Autofill** _(mobile)_ — password managers
  and Google's Autofill no longer save or fill GO's wallet password; the seed
  import field turns off keyboard suggestions and learning.
- **Fewer outside images** _(shared)_ — chat Q-App link previews and Qortino
  cards no longer load posters from outside servers; Qortino no longer
  parses documents before a tap.
- **Account picker** _(shared)_ — no longer sends the node every wallet
  address on the phone in one request.
- **Diagnostics** _(shared)_ — "Copy diagnostics" replaces addresses, names,
  ids, IP addresses and the node host with per-report pseudonyms.
- **No source code in the release APK** _(mobile)_ — release builds leave out
  the 27 MB of source maps, the debug pages and the unused pdf.js viewer; the
  build fails if they come back.
- **No tracking images in messages** _(shared)_ — chat messages, forum posts
  and update notes could carry `<img>` (or video, audio, CSS backgrounds)
  pointing at any web server, and showing the message fetched it: that
  server learned the reader's IP address and when they read it. On GO this
  worked with `HTTPS://…` or `//…` addresses; the desktop Hub's CSP already
  blocked it. A DOMPurify hook (`src/utils/configureDomPurify.ts`, rules in
  `src/utils/remoteContentPolicy.ts`) now allows media only from GO itself,
  `data:`/`blob:`, the local node, the Qortal public nodes and the node in
  use. A blocked image shows as its address, which chat turns into a link
  the reader can choose to open. `MessageDisplay` also parses message HTML
  in an inert document, so nothing is fetched while it is processed.
- **No request to Google from the editor** _(shared)_ — selecting an image in
  the rich-text editor loaded its three alignment icons from
  `fonts.gstatic.com`, which handed the user's IP address to Google.
  `tiptap-extension-resize-image` stays on 1.1.8 (1.4 inlines the icons but
  is a full rewrite); `tools/vite/inlineResizeImageIcons.ts` swaps in the same
  inline SVGs at build time, and the build fails if the package ever loads
  anything else from Google Fonts.
- **No Google backup of app data** _(mobile)_ — `android:allowBackup` was
  `true` with no rules, so on phones with Google backup on, Android copied
  GO's data (wallet files, Reticulum identity keys, chat history) to Google
  Drive. Backup is now off, and `data_extraction_rules.xml` also blocks
  phone-to-phone transfer on Android 12+ (security audit finding GO-41).
  Moving to a new phone goes through the wallet backup file.
- **WebView metrics and Safe Browsing off** _(mobile)_ — the WebView no longer
  sends usage and crash metrics to Google or checks URLs with Google Safe
  Browsing. It only shows GO's own pages and Q-Apps from the Qortal node.
- **No emoji-font request to Google Play Services** _(mobile)_ — AndroidX
  EmojiCompat asked Play Services' font provider for an emoji font on every
  start. Its initializer is removed; the WebView draws its own emoji.

## [0.0.14] — 2026-10-01 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.14** (`versionName` 0.0.14, `versionCode` 17).
First **release build** (not debuggable) of GO 3.0, built with
`./gradlew assembleRelease` and signed with the same key as every earlier
version, so it installs over v0.0.13 with accounts and chats kept.

### Fixed

- **Slow login on GrapheneOS** _(mobile)_ — every earlier GO 3.0 APK was a
  debug build. Android never gives a debuggable app precompiled code, and
  GrapheneOS has no ART JIT, so all of GO's Java ran in the slowest
  interpreter there: the wallet key derivation took 10–25 s instead of under
  1 s, and the rest of the app was slower too. The per-app "WebView JIT"
  setting could not help, because it only affects JavaScript.
- **Fingerprint unlock did the slow part twice** _(shared)_ — the prewarm
  and the unlock itself each started the full wallet key derivation at the
  same time, and the account list could start it up to three more times.
  Identical runs now share one (`src/encryption/kdf.ts`).
- **Chat started on the lock screen** _(mobile)_ — the chat engine and the
  Python/Reticulum bridge booted before login and competed with the unlock
  for the CPU. They now start once you are logged in (also when you go Back
  from the unlock screen).
- **Password login could hang on a slow node** _(shared)_ — the node checks
  before decrypting had no time limit; each now gives up after 5 s like a
  network error. The loading screen shows during the check, a second tap no
  longer starts it again, and the user-info fetch that was repeated after
  login is skipped.
- **Wrong version shown** _(mobile)_ — v0.0.13 showed "0.0.12" in Settings
  and diagnostics.

### Added

- **Unlock section in diagnostics** _(mobile)_ — Copy diagnostics / Save as
  .md now shows whether the app is a release or debug build, a Java speed
  probe, and the last unlock steps with their times (node check, key
  derivation, fingerprint scan, decrypt). Kept across restarts so a slow
  login can be reported afterwards; no passwords or addresses are stored.

### Security

- **Not debuggable any more** _(mobile)_ — WebView DevTools and the Java
  debugger can no longer attach to GO, and Capacitor's debug logging (which
  wrote plugin call data to logcat) is off (audit GO-02, most of GO-14).

### Changed

- **More room while typing** _(mobile)_ — in Q-Apps and Chat the bottom
  Home / Apps / Chat bar now hides while the keyboard is open, so the app or
  conversation gets that space. It comes back when the keyboard closes. Home
  keeps the bar.
- **Qortino's offline assistant answers faster** _(mobile)_ — the release
  build compiles its llama.cpp engine with optimizations (CMake
  `RelWithDebInfo`). Debug builds left the C kernels (`ggml-cpu.c`,
  `quants.c`) at `-O0`.
- **On-chain chat sends on GrapheneOS** _(mobile)_ — the chat proof-of-work
  (`NativePOW`, Java) also ran in the slowest interpreter in debug builds and
  is compiled ahead of time now.

## [0.0.13] — 2026-10-01 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.13** (`versionName` 0.0.13, `versionCode` 16).

### Added

- **Background sync** _(mobile)_ — a new **Background sync** card in the
  notification settings: **Off**, **While charging** (the default) or
  **Always**. Android's WebView freezes a hidden page 60 s after GO leaves
  the screen, and the chat engine runs in that page, so until now GO stopped
  sending and receiving about a minute after you switched away. While
  charging (or always, if chosen) GO now keeps the engine running in the
  background. On battery it still keeps going for up to 3 minutes after you
  leave GO while your own messages are waiting to go out, then pauses as
  before. **Always** uses noticeably more battery. The card shows when GO is
  syncing in the background. Nothing changes on web or desktop.
- **Charging mode helps relay** _(mobile)_ — while the phone charges on an
  unmetered network (for 2 minutes), GO relays group traffic for others and
  keeps as many mesh neighbours as the desktop Hub (12 + 8 instead of 6 + 6).
  It drops back to the light phone profile as soon as it is unplugged or on
  mobile data.
- **Your messages reach your own Hub** _(shared)_ — when the same account is
  signed in on another device, such as an always-on Hub at home, GO now tells
  it about every DM you send, directly and without flooding the mesh, and
  lets it download the message at once. That device can then deliver the
  message after GO closes. The same happens when you leave GO, when you come
  back, and when the network returns; group posts are announced to it too.
  Works with Hub 3.0.3 as released.
- **Delivery status on your DMs** _(shared)_ — your own Reticulum DMs show a
  small status icon: **Sending**, **Only on this phone** (not yet anywhere
  else), **On your other device** (your Hub has a copy and can deliver it
  when the recipient comes online) or **Delivered** (the recipient's device
  requested it and it was sent). Tap or hover it for an explanation.
- **Phone-maker freeze notice** _(mobile)_ — some phones (vivo was measured)
  freeze apps when the screen turns off, even with background sync on. When
  GO notices this it shows a one-time notice with a button to the phone's
  battery settings and a link to dontkillmyapp.com for that brand.
- **Note for Hub developers** —
  `docs/go/hub-notes/HUB_OWN_DEVICE_DELIVERY.md` describes what was measured,
  what GO now does on its own and which Hub changes would make delivery
  through an own Hub reliable.
- **Long messages are split** _(shared)_ — a chat message over 4,000 bytes
  (DM, group or thread) is now sent as several consecutive messages, up to
  15, instead of being refused.
- **Save diagnostics as a file** _(shared)_ — the Reticulum badge has **Save
  as .md file** next to **Copy diagnostics**. On phones it is saved to
  Documents/Qortal Go/Documents, ready to attach instead of pasting a long
  report that chat apps cut into pieces.
- **Discard button in the composer** _(shared)_ — a small X left of the send
  button throws away what you typed. When the message grows to several
  lines, the X moves up beside the send button.
- **Library pins go to Tabs** _(mobile)_ — the pin icon in the Q-Apps
  library now adds the app to a **Library** folder in Tabs. Before, it wrote
  to the desktop dashboard's pin list, which phones never show.

- **Admin buttons on each member row** _(shared)_ — in the Q-Chat Members
  list the group owner sees a shield button on every member: **Make admin**
  on regular members, **Remove admin** on admins, plus a ⋮ menu with
  **Kick** and **Ban**. Admins who are not the owner get the ⋮ menu (kick,
  ban) on regular members only; nobody gets buttons on the owner or on
  themselves, matching what Core accepts. Each action still asks for the
  fee confirmation. After it is sent the row shows **Pending** and the list
  re-reads every 15 s until Core shows the change (up to 6 minutes). Pending
  survives closing and reopening Members. Holding or right-clicking a row
  opens the same menu. Before, only the owner could reach these actions, by
  holding a row, and the menu offered all four whatever the member's role.
- **GO 3.0 Updates screen** _(mobile)_ — a new **GO 3.0 Updates** entry
  under **Node** in the account menu opens its own full-screen window. It
  shows the installed version, a **Check for updates** button (with when it
  last looked), and, when a newer build is published to QDN under GO 3.0, a
  bell card with **Install update** and **Later**. Below it, **Versions on
  QDN** lists every published build, newest first, with its size, date and
  release notes (**Show changes** expands them) and an **Open in Q-Share+**
  link to its share page. Builds are published with Q-Share+, which stores
  the same data as Q-Share. Builds newer than the installed one have an
  **Install** button; older ones can only be opened in Q-Share+, since
  Android does not put an older version over a newer one. The download and
  install keep running if the window is closed.
- **Clear all in the notifications panel** _(shared)_ — a **Clear all**
  button right of **Notification history** empties the panel in one tap.
  Everything cleared (notifications and saved files) stays in Notification
  history, the same as swiping items away one by one.

### Changed

- **Undelivered DMs keep trying for 7 days** _(shared)_ — before, GO stopped
  re-announcing an undelivered DM after 2 hours. It now keeps trying slowly
  (every 30 minutes for the first day, then every 2 hours) for up to 7 days,
  and stops as soon as your own Hub has the message. The retry state is
  saved, so a restart no longer causes a burst of re-sends.
- **Saved Messages retry until your other device has them** _(shared)_ — a
  Saved Message used to count as announced once the phone had sent the
  notice, so a lost notice was never repeated. It now counts only when your
  other device has actually downloaded it, with at most 12 re-announcements.
- **Clear status notification** _(mobile)_ — the persistent GO notification
  now says **Chat paused — open GO to sync** when the chat engine is frozen,
  **Syncing in the background** when background sync keeps it running, and
  how many of your messages are waiting to be sent. These texts and the
  "GO paused" notice now follow the app language.
- **No daily limit while background sync runs** _(mobile)_ — on Android 15
  and later the system stops a "data sync" background service after about
  6 hours a day, which is what GO used. While background sync is meant to
  run continuously (charging, or **Always**), GO's service now runs as a
  messaging service, which has no daily limit (Android 14 and later), so
  charging mode can run all night. On battery with **While charging** or
  **Off**, the 6-hour limit stays as a battery safety net; when it is
  reached GO pauses cleanly with one "GO paused — open GO to reconnect"
  notice instead of crashing and restarting in a loop until opened.
- **Less background traffic** _(shared)_ — GO no longer re-floods answers to
  its own "any messages for me?" questions into the mesh, checks for local
  notifications every 60 s instead of every 2 s (on phones), runs its DM
  retry timer only while something is waiting, stops retrying an empty
  download from your own device, and skips signature checks for exact
  duplicates. Relaying for others is unchanged.
- **Swipe away or log out stops the network** _(mobile)_ — after GO is swiped
  away from recent apps, or after logout, the Reticulum network layer pauses
  instead of running on with nothing attached to it.
- **Late messages still notify** _(mobile)_ — DMs and mentions that arrive
  while GO catches up after being frozen or offline now raise a notification
  if you have not read them elsewhere; several at once become one sound.
- **Q-Apps pause in the background** _(mobile)_ — open Q-App tabs are paused
  while GO is in the background, so they do not drain the battery while
  background sync keeps GO awake.
- **Delivery counters in the log** _(mobile)_ — the per-minute
  `bridge_traffic` log line now includes delivery counters, and the log
  throttle keeps each kind of line separately so one noisy line no longer
  hides the others.

- **App updates leave the notifications panel** _(mobile)_ — a new GO build
  no longer appears as a card in the notifications panel or counts in its
  badge. The account menu's **GO 3.0 Updates** entry rings its bell instead
  (with a 1 until the screen has been opened), and the avatar gets a small
  update mark until then.
- **Swiping a saved file keeps it in history** _(mobile)_ — swiping a
  saved download out of the notifications panel, or tapping its X there,
  now only clears it from the panel; it stays in Notification history. The
  X in Notification history still forgets it.

- **One layout for every group panel** _(mobile)_ — Members, Calendar,
  Files, Admin keys, Threads and Qortal Land (the ⋮ menu in a group chat)
  now all open full screen with the same header as Group Calendar: icon and
  title on the left, the X in the same top-right spot. Members keeps its
  member count and Qortal Land its call button beside the X; Calendar keeps
  Add event. Before, each looked different: Members had a back arrow, Files
  a small Q-Manager bar, Admin keys was a popover under the chat header, and
  Threads and Qortal Land showed a row of group tool icons with no close
  button. While Members, Threads or Qortal Land is open, the app's top bar
  and Home/Apps/Chat bar step aside, as they already did for Calendar and
  Files.
- **Android back closes group panels** _(mobile)_ — back now does what the
  X does on every panel above: it closes Calendar (an open event, the event
  editor or the delete prompt first), Files and Admin keys, and returns from
  Threads and Qortal Land to the chat. In Threads, back first leaves an open
  thread or the reply composer. Before, back on Calendar, Files, Threads or
  Qortal Land closed the whole group. Back also closes, in order, the member
  menu, the member card and the Members panel.

### Fixed

- **Group chats stayed empty on nodes with an API key** _(mobile)_ — reported
  by GrapheneOS users. The group membership check sent the node's API key,
  which the node's browser security rules (CORS) reject, so every check
  failed; and while a DM page was being prepared, downloads for groups were
  refused. Together they kept groups dark. The check no longer sends the
  key (it does not need one) and group downloads are no longer blocked.
- **Emoji panel closes like the keyboard** _(mobile)_ — tapping outside the
  composer now closes the emoji/GIF panel. Before, only sending, the smiley
  button, picking a GIF or Android back closed it.
- **GO refused its own Hub's download** _(shared)_ — while GO was still
  announcing a new DM, a download request from the same account's other
  device was rejected (`dm_notification_request_mismatch`), so the Hub gave
  up after 6 attempts. Own devices are now allowed, and the recipient's
  delivery continues unchanged.
- **Background service stopped when the phone was turned sideways**
  _(mobile)_ — the background service was tied to a narrow screen width, so
  landscape, tablets and fullscreen video stopped it. It now depends only on
  running as the Android app.
- **Chat traffic lost after a freeze** _(mobile)_ — messages that reached the
  phone while the page was frozen were dropped when the engine reconnected.
  They are now handed to the engine once it is back.
- **Admin keys fit on phones** _(mobile)_ — the GSK/ASK cards had a fixed
  390 px body inside a narrower window, so their right side was cut off.
  They now follow the screen width.

## [0.0.12] — 2026-09-29 (GO 3.0)

Field / Q-Share build **GO 3.0 v0.0.12** (`versionName` 0.0.12, `versionCode` 15).

### Security

- **Q-Apps only see their own notification read marks** _(shared)_ —
  `NOTIFICATION_MARK_SEEN` returned the seen keys of every Q-App for the
  account; it now returns only the calling app's keys
  (`filterSeenInAppKeysForApp`). It also re-marks only the keys it names,
  so marking one app's notifications no longer moves other apps' marks
  forward (which hid their newer notifications and synced that to the
  other devices).

### Added

- **Account menu closes with a swipe up, with an exit choreography**
  _(mobile)_ — the panel under the avatar stays put, but a swipe up, on the
  panel or anywhere on the dimmed screen, lifts it with the finger while the
  buttons close to the side one after another, bottom-up, in step with the
  finger (swipe back down and they return); once the swipe is long or fast
  enough the release throws the panel off the top, a short swipe springs
  everything back and a downward pull only rubber-bands. When the list has to scroll (landscape)
  it scrolls, and the swipe-up works from the header and the dim. Closing
  by a tap outside, an action or Android back plays the opening stagger in
  reverse: buttons slide away bottom-up, the header lifts and the panel
  folds back towards the avatar. Android back closes it (it did not before).
  Reduced-motion users get instant open/close. The panel lives in
  `MobileAccountPanel.tsx`.

- **Open / Download shows what the node really has** _(shared)_ — the
  Q-Apps library asked the list endpoint
  (`/arbitrary/resources/search?includestatus=true`), whose status is a
  Core cache that goes stale (reloaded every 30 minutes, not updated when
  a built copy expires or chunks are deleted; on ext-node.qortal.link only
  6 of 34 apps listed READY were). Buttons on screen now ask
  `/arbitrary/resource/status` per app (only rows that stay on screen for
  300 ms, 4 at a time, cached 5 minutes, falling back to the list if the
  node refuses). READY, DOWNLOADED and BUILDING show **Open**; DOWNLOADING
  shows a percentage; a listed PUBLISHED shows **Download** right away and
  anything else a small spinner until the node answers. Opening an app
  keeps checking it until the node has it, so its button turns into Open.
  The refresh button re-checks, the Community status filter and the app
  detail status badge use the same answer.
- **Featured top-rated apps in Community and every category** _(shared)_ —
  a Featured carousel with the 10 best rated apps (at least 2 votes),
  hidden while a filter or category search narrows the list. Featured
  cards (Official too) show gold stars, the score and the number of votes.
- **Best rated first** _(shared)_ — "Highest rated" is the default sort
  and weighs how many people voted: a Bayesian average with a 3-star prior
  worth 3 votes, so one self-rated 5-star vote (60 of the 111 rating polls
  have a single vote) no longer tops apps that many rated highly. Category
  pages and library search sort with ratings too.
- **Swipe away notifications** _(shared)_ — items in the notifications
  panel can be swiped (or deleted with Delete/Backspace) away; they stay
  hidden across reconnects for 7 days and leave the badge count. A group
  mention card comes back when new mentions arrive.

- **Copy chat diagnostics** _(shared)_ — the Reticulum badge popover has
  a **Copy diagnostics** button (selectable text if the clipboard fails)
  with the GO version, WebView, WebAssembly/OPFS support, a JS loop probe
  as a JIT indicator, radio stats, chat engine state, age and boot timings
  (sqlite-wasm init), worker/bridge/RPC counts, Core `/admin/status`
  reachability, recent send failures and the engine log faults and tail.
  Made for the GrapheneOS "failed to send" reports, where screenshots were
  the only evidence.
- **Send failures say why** _(shared)_ — the queue's error is kept on the
  message and shown under "failed to send". A publish refused because
  Core could not be asked about group membership (node unreachable or API
  key missing) now says so, instead of "author is not a current group
  member".
- **Download progress and saved files** _(mobile)_ — large QDN fetches
  from Q-App frames (reported by a document-start script) and GO's own
  saves show a progress card at the top; ⌄ flies it into the avatar bell.
  The bell lists running downloads, saved files as "Ready to install" /
  "Ready to open" with a button, and declined saves with a Save button
  (30 minutes). The Android tray shows quiet progress, a "Saved files"
  alert only while GO is in the background, and tapping it installs or
  opens the file. Saves use a binary WebMessage channel (`goFileSink`,
  limited to the bridge's allowed origins): about 149 MB/s against about
  6 MB/s for the base64 chunk path.
- **Notification history** _(shared)_ — a button next to ⚙ in the bell
  panel lists the last 30 days per account (up to 300 entries), including
  swiped-away items and saved downloads; tapping an entry opens it like in
  the panel. The bell panel also closes by dragging its header or grab bar
  up.

### Changed

- **Q-Apps library on phones** _(mobile)_ — the Community tab and
  category pages use compact, virtualized list rows (two columns on
  tablets) instead of desktop cards, and the Community tab has its
  "Community apps (N)" header back. Category pages are full width with a
  translated title and their own search and sort; the hidden category list
  is no longer rendered while no category is open.
- **Library tabs** _(shared)_ — each tab remembers its scroll position,
  tapping the current tab scrolls to the top, and picking a tab leaves the
  search results.
- **Tabs folders** _(mobile)_ — a folder shows only its own apps; tapping
  the open folder's chip goes back to all tabs; reopening Tabs stays in a
  folder only if the active app is in it; Android back steps out of
  dialogs, name editing, edit mode and folders one at a time; deleting a
  folder asks first.
- **Notification settings fill the screen on phones** _(mobile)_ and no
  longer scroll sideways.
- **Q-App names and avatars in notifications** _(shared)_ — notification
  settings and panel items show the app's registered name (from
  `/names/{name}`, `%20` decoded) with its avatar.

### Fixed

- **Chat engine badge stuck on "idle"** _(shared)_ — the badge only heard
  readiness changes after it subscribed, so it missed an engine boot that
  another chat surface had already started. It now replays the current
  state on subscribe, and "starting" counts the seconds.
- **Saving files on Android 8 and 9** _(mobile)_ — the storage permission
  was never requested at runtime, so every save failed there.
- **APKs could be saved as `.apk.zip`** _(mobile)_ — the native download
  path gave MediaStore QDN's MIME type (`application/zip` for APKs); the
  file name now decides.

- **Home no longer opens black after login** _(mobile)_ — the idle
  animation pause (10 s without input) froze every CSS animation, including
  the dashboard's one-shot post-login fade-in, which starts at opacity 0. A
  biometric unlock produces no DOM input, so the timer set on the lock
  screen had already expired and the whole Home view stayed invisible until
  the first touch. Finite CSS animations now always run to completion while
  idle; only infinite loops stay frozen. Entering the authenticated shell
  also counts as activity.

- **Tabs folders and Q-Apps library tabs did nothing when tapped**
  _(shared)_ — a notifications effect re-wrote the seen-notification marks
  in a loop (~280 times a second on an affected account), which starved
  every deferred update. Q-App notifications on the desktop that this
  wrongly marked as read show as unread again.
- **Scrolling a long folder closed the Tabs window** _(mobile)_ — the
  overlay's transparent backdrop covers the strip and bottom bar under a
  full-height panel, so a swipe up from there counted as touching the app
  behind. A swipe that starts below a scrollable list now scrolls it; a
  tap there still closes.
- **Tabs** _(mobile)_ — Rename and Change address saved nothing; a tap
  right after a drag was ignored; the window closed by itself when a chat
  behind it updated.
- The selected library tab showed the hover colour after a tap
  _(mobile)_.
- A Featured carousel could crash when its list became empty (hooks
  after an early return) _(shared)_.

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
  [`HUB_GIF_PICKER.md`](docs/go/hub-notes/HUB_GIF_PICKER.md).
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
  See [`docs/go/PAYMENT_QR_CODES.md`](docs/go/PAYMENT_QR_CODES.md) for the full
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
  work lives in [`HUB_DEV_NOTES.md`](docs/go/hub-notes/HUB_DEV_NOTES.md). (`b06a2794`)

---

_For releases before the Qortal GO fork, see the upstream
[Qortal Hub](https://github.com/Qortal/qortal-hub) history._
