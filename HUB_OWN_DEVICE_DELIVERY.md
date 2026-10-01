# Own-device DM delivery: letting a user's own Hub deliver for their phone

Notes for the Qortal Hub team, from the Qortal GO fork (`https://gitea.qortal.link/simon/GO-3.0`, branch `main`, release GO 3.0 v0.0.13), 2026-10-01.
Companion to [`HUB_DEV_NOTES.md`](HUB_DEV_NOTES.md) and [`HUB_NOTIFICATION_SYNC.md`](HUB_NOTIFICATION_SYNC.md).

Short version: a phone cannot stay online, and Reticulum DMs are only delivered while sender and recipient are online at the same time. A user who also runs Hub 24/7 on the same account already has a machine that can hold and serve their messages. GO now hands its outgoing messages to that Hub and pulls from it on resume, using only wires Hub 3.0.3 already understands. What is left can only be fixed in Hub; section 4 lists it in priority order with implementation sketches.

How claims were checked:

- Every statement about Hub 3.0.3 was checked against the release tag (`git show v3.0.3:electron/src/reticulum-chat.ts`, tag commit `f3b75daa`) and, for the link layer, `v3.0.3:electron/resources/presence_bridge.py`. Line numbers marked "v3.0.3 L…" refer to those files at that tag and do not drift. The locally fetched `hub-gh/develop` (`d1ac4adb`, 2026-09-19) has a byte-identical `reticulum-chat.ts`.
- GO line numbers drift; grep for the identifiers.
- Measurements come from one lab setup: a vivo V2511 phone (Android 16, WebView 153) running GO, and two Hub 3.0.3 instances (`hubA`, `hubB`) on one PC. Log excerpts are in the GO workspace, outside this repo (`chat-lab/logs/`), and the full investigation is in `reports/GO-delivery-reliability-plan-2026-09-30.md` there.
- "Verified" means seen in code or in logs. "Inferred" and "not measured" are marked as such.

---

## 1. The problem

A Reticulum DM is pull-based. The sender stores the event and sends a signed `dm_notify` (30 s TTL, `RETICULUM_CHAT_DM_NOTIFY_TTL_MS`) to the recipient's leases. Unconfirmed notifies go out again as gossip after 750 ms and as a full fanout after 3 s. The recipient then pulls a page over an authenticated resource link, and the provider's JS authorizes that pull. So the sender's engine must be running when the recipient comes online. There is no store-and-forward: Hub 3.0.3 answers `relay_store` with `relay-cache-disabled` (v3.0.3 L37168, L39443).

Phones cannot meet that condition (section 2): the chat engine lives in the WebView and stops about a minute after the app leaves the screen. A DM sent from a phone to someone who is offline at that moment waits on the phone until both happen to be online together.

A Hub that runs 24/7 on the **same account** already has almost everything needed to deliver on the phone's behalf:

- it is a verified own device of the phone: an own-account lease plus the `self_dm_v1` hello feature (`isVerifiedSelfDmPeer`, v3.0.3 L11489);
- it stores every DM of the account's conversations, including events another installation wrote (`acceptDirectEvent(event, false)`, stored with `own_event = 0`);
- it serves those events to the other party, because it "owns the peer address" (`providerOwnsPeer` in `authorizeDirectDmPageResource`, v3.0.3 L40813);
- it answers the other party's `dm_probe` (v3.0.3 L20684) and re-announces the conversations it wrote last every 15 minutes (`broadcastDmNotificationsForLocalAddresses`, v3.0.3 L28846).

Two things are missing. The Hub needs to receive the phone's messages before the phone freezes. And the phone needs to receive, on resume, what arrived at the Hub while it slept. Both directions were broken by details in the engine that GO and Hub share. GO has fixed its side (section 3). Hub's side needs the changes in section 4.

## 2. What we measured

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Chromium freezes a hidden WebView page 60 s after it is hidden.** The engine's Web Worker stops with it. Android's cached-app freezer is not involved (`isFrozen=false`), and the app process with Python keeps running. Setting the renderer priority policy, holding a Web Lock, or keeping a network request pending did not change it. What did work: telling the WebView its window is still visible. The page then stays running, at about the CPU cost of GO idling in the foreground (roughly a quarter of one core, almost all of it mesh traffic).                                                                                                                                                                                                                         | The Page Lifecycle `freeze` event fired exactly 60 s after `visibilitychange: hidden` (19:51:28 → 19:52:28). In 3 of 3 logcat windows the worker stopped 53-60 s after "App stopped", with the screen on and the phone charging. With the visibility fix: a 6-minute background run answered 13/13 heartbeats. |
| M2  | **Vendor freezers stop the whole app** after the screen turns off: Python, sockets and JS, despite a `dataSync` foreground service and a partial wake lock. GO code cannot override this; only the phone's battery settings might.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | vivo: the process stops about 10-30 s after the screen goes off, even on the charger. `dumpsys power` lists GO's wake lock as `DISABLED ... mIsFrozen`. Xiaomi, Oppo, Huawei and Samsung have similar freezers (known, not measured by us).                                                                    |
| M3  | **Android 15+ limits a `dataSync` foreground service to about 6 h per rolling 24 h** (the figure is from the Android docs). The old GO service had no `onTimeout`, so it was killed and then crash-looped on its sticky restart until the app was opened.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 10 `ForegroundServiceDidNotStopInTimeException` kills on 9 days between 09-17 and 09-27, each followed by restarts failing with "Time limit already exhausted" (crash buffer in `go-logcat-2026-09-29.log.gz`).                                                                                                |
| M4  | **The phone refused its own Hub's pull.** The Hub received GO's notify (as an overlay neighbour, through the 3 s fanout) and pulled. It pulls with the notify's own id: `queueDirectMissingEvents` keeps the first request id for a (source, conversation) pair while the cursor is unchanged (v3.0.3 L20117), and `buildSignedDirectRequestWire` puts it into the signed `dm_req.q` (v3.0.3 L20373). The provider looks that id up in `pendingDmNotifyDeliveries` (tracked for 2 min) and requires `requester === tracked recipient`. The Hub is the sender's own account, so it is refused. The code is identical in Hub 3.0.3 (v3.0.3 L40828-40843). **Hub therefore refuses the phone in the same way** when the Hub itself sends a DM and the phone pulls it through that fanout. | `hubB.stdout.log:1934`: `dm_link_pull_exhausted conversation=b083c017… peer=1cf18fe3… attempts=6 reason=dm_notification_request_mismatch`. In that sample the copy only succeeded at +39 s, through a later untracked notify.                                                                                  |
| M5  | **Hub 3.0.3 has no own-device DM catch-up.** On a `hello_v3` from an own device with `self_dm_v1` it announces only the newest Saved Message, call history and calendar digests (v3.0.3 L18116-18129). There is nothing like the fork's `scheduleOwnDeviceCatchup`. The 15-minute summary goes only to the _recipient's_ leases, and only for conversations where the account wrote last (v3.0.3 L28858). Read states are replayed to own devices on address or membership changes, on overlay health, and at the end of each DM discovery cycle (5-6 min, v3.0.3 L28435), but not on an own device's hello. A phone learns about mail held by its Hub only by probing or by catching a notify.                                                                                        | Code (the line refs given).                                                                                                                                                                                                                                                                                    |
| M6  | **16-conversation cap.** Probe answers and the 15-minute summary both cover only `getDirectSummaries(...).slice(0, 16)`. A 17th conversation is never announced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | v3.0.3 L20762 (`handleDirectProbe`), L28849 (`broadcastDmNotificationsForLocalAddresses`).                                                                                                                                                                                                                     |
| M7  | **Hub-originated notifies re-flood.** Non-self notifies, including probe answers, are signed with `m = 5` (v3.0.3 L28477: `maxHops = selfDm ? 0 : 5`). The engine also relays a notify for a _local_ conversation at `h + 1` after queueing its own pull; only self-DMs return early (v3.0.3 L20618-20682). A node's own probe ids are recorded only in `recentDmDiscoveryKeys`, not in `dmProbeRoutes` (v3.0.3 L28550 vs L20753), so answers to a node's _own_ probe are re-flooded as well. On a phone every relayed copy costs radio time.                                                                                                                                                                                                                                          | Code. GO had the same behaviour and removed it (section 3).                                                                                                                                                                                                                                                    |
| M8  | **The phone-to-Hub link drops.** v3.0.3 reserves extra inbound overlay slots only for _call_-pinned peers (`_admit_overlay_peer_if_allowed`, `_overlay_incoming_probation_allowed`). Both dial paths skip a peer that announces `inbound_full`, unless that peer is call-pinned (presence_bridge.py L12279, L12758). Chat-pinned own devices (the Saved Messages warm links) get neither exemption.                                                                                                                                                                                                                                                                                                                                                                                    | Code. Lab: gaps of 35 and 51 min in the phone ↔ hubB link while both were alive. From 10:02 to 10:53 hubB's links to the phone were closed with `destination_closed` while GO announced `inbound_full=True`. That part was GO-side, possibly an older GO build; GO has changed since.                          |

Not measured, so please do not read the above as claiming it:

- Hub serving its copy to the recipient **with the phone gone**. We saw hubB serve a copy only while GO was also online (both served within about 09:32:07-10).
- Whether a live Hub 3.0.3 accepts and pulls a non-self `dm_notify`, or answers a `dm_probe`, signed with `m: 0`. The signature bounds allow it (`0 ≤ h ≤ m ≤ 5`, v3.0.3 L5802-5830), and `hop >= maxHops` stops the relay. We read this from the code; it has not been exercised live.
- Anything on a phone other than the vivo. All freeze data comes from that one device.

## 3. What GO now does on its own (compatible with Hub 3.0.3)

All of this is in the GO fork. It is unit-tested and type-checked, **but has not yet been measured on a phone against a live 3.0.3 Hub**. No Hub or Core change is needed, and no new wire kind or field is used. Every own-device send below is gated: nothing is read, signed or sent unless a verified own device (own lease plus `self_dm_v1`) holds an **admitted overlay link** to the phone (`ownDevicePushTargets`). A user without an own Hub pays nothing.

1. **Own-device pull allowed while a notify is tracked.** In GO's `authorizeDirectDmPageResource`, `ownDevicePullOfTrackedNotify` covers the case of a verified own device where requester = tracked sender, peer = tracked recipient and the conversation matches. That pull is served instead of being rejected with `dm_notification_request_mismatch`. The pull does **not** confirm the tracked delivery or clear its retries, so the recipient's gossip and fanout still run. `markDirectEventSent` still requires `recipient === requester`, so an own-device pull never marks a message "sent". This fixes M4 for messages the **phone** wrote.
2. **An own-device push on every send.** A second, fresh `dm_notify`, never tracked, signed with `maxHops: 0` and sent once (`sendToPeerOnce`, no control-retry queue) directly to at most 4 own devices with an admitted link. It goes out before the recipient's tracked notify. Rate limits: at most one push per conversation per 10 s (leading edge, with an owed push paid by the next sweep tick); re-pushes at most once per 5 min; a device session stops receiving re-pushes after 3 unanswered pushes; no push if signing took more than 20 s. Hub 3.0.3 pulls any non-self notify for a local conversation from `sp`, with no own-device check (v3.0.3 L20618-20637), and does not relay it when `m = 0`.
3. **"Copy on your own device" marker.** A GO-only nullable column, `rchat_dm_events.own_device_copied_at` (additive migration; Hub never reads it), is set when a verified own device's page authorization covers own pending events. The UI shows "saved on your other device", never "delivered". The flag is set at authorization, not at transfer completion, so it means "handed over".
4. **Re-push on edges only**, with no new timers: own-device admission, a new Hub lease session id, an own send, resume or network regain, the background flush, and the existing pending sweep. Only the newest uncopied event per conversation is pushed, up to 7 days old, for at most 8 conversations.
5. **Flush on hide** (`flushOutboundForBackground`). At the moment the app leaves the screen, GO pushes uncopied DMs, re-notifies an unconfirmed Saved Message, pays owed group notices and runs one early recovery sweep. Limits: at most 17 signatures and 20 s, 8 conversations and 2 own devices; once per 60 s; a single indexed check and nothing more when nothing is pending.
6. **Targeted own-Hub probe on resume.** One `dm_probe` signed with `maxHops: 0` goes directly to at most 2 own devices with an admitted link. It fires only in the foreground: on admission, on a worker-socket reopen, on becoming visible after at least 45 s hidden, and on network regain. Limits: at most one per device per 120 s and 20 per hour, with a 5 → 60 min backoff after 2 unanswered probes. Answers are consumed, never relayed (GO tracks its own probe ids). An answer whose `lc` matches one of GO's 5 newest local events in that conversation is not pulled.
7. **Saved Messages confirmation.** A self-DM cursor counts as announced to a device only after that device pulled a page containing it, or sent a self notify with a matching `lc`. It is re-notified on existing carriers, at most 12 times per cursor per device session.
8. **Group posts reach own devices directly.** After the routed send, the already-signed `event_notice_v3` (no new signature) goes once to at most 2 own devices the routed send did not reach. A failed send is owed (at most 32 events, for 24 h, 3 attempts) and paid on the next own-device edge. `event_notice_v3` has no hop field, so "m:0" does not apply to it; it is a direct send and not forwarded as a DM notify would be.
9. **Background modes (Android).** Off / While charging (default) / Always. While a mode applies, the native layer keeps the WebView "visible" to Chromium after GO leaves the screen, which avoids the M1 freeze. On battery this applies only in "Always", or for up to 3 minutes while own messages still wait to leave the phone. A partial wake lock is held only while charging or during that 3-minute window. On the charger with unmetered Wi-Fi (stable for 2 min), GO relays like a fuller node. The `dataSync` timeout (M3) now stops the service cleanly with a "GO paused" notification and no sticky restart. A vendor freeze (M2) is detected and explained to the user; it cannot be prevented.
10. **Cheaper retries.** At most 2 tracked (full-fanout) attempts per conversation per send. Later attempts use recovery mode (a direct send plus one width-4 gossip, signed `m ≤ 2`), followed by a slow tail of up to 7 days. The attempt state is persisted, so a restart does not start a new burst.

What GO still cannot do by itself:

- It cannot learn that its Hub delivered a message. The message stays "saved on your other device" forever (P7).
- It cannot make Hub push inbound mail to it. It only probes while in the foreground (P4).
- It cannot stop Hub from refusing its pull of a message the **Hub** wrote (P1).
- It cannot keep its link to a Hub whose inbound slots are full (P3).
- It cannot keep anything running once a vendor freezer (M2) or the `dataSync` limit (M3) has stopped the app.

## 4. Requested Hub changes, in priority order

Each item gives what to change, why, a sketch, whether the wire changes, and bounds. "No wire change" means a Hub 3.0.3 peer and an older GO keep working unchanged.

### P1. Exempt verified own devices from `dm_notification_request_mismatch` (no wire change)

**Why.** M4. GO has fixed this for messages GO writes. The mirror case is still open: when Hub sends a DM, the phone (an overlay neighbour) receives the 3 s fanout, pulls with that notify id, and Hub refuses it for 2 minutes. Six pull attempts are spent and nothing arrives. The same happens between two Hub installations of one account.

**Sketch** (`authorizeDirectDmPageResource`, v3.0.3 L40828). Mirror GO's predicate exactly:

```ts
const ownDevicePullOfTrackedNotify =
  verifiedRequesterDevice &&
  !!pendingNotification &&
  requesterAddress === pendingNotification.senderAddress &&
  peerAddress === pendingNotification.recipientAddress &&
  reticulumDmConversationId(
    pendingNotification.senderAddress,
    pendingNotification.recipientAddress
  ) === conversationId;
if (pendingNotification && !ownDevicePullOfTrackedNotify && (/* existing mismatch test */)) {
  await reject('dm_notification_request_mismatch');
  return;
}
// ...
if (notificationId && pendingNotification && !ownDevicePullOfTrackedNotify) {
  this.clearDmNotifyControlRetries(notificationId);
  this.confirmPendingDmNotifyPeer(notificationId, authenticatedPeerHash);
}
```

The one detail to get right: an own-device pull must **not** confirm or clear the tracked delivery. Otherwise, when the recipient has no direct targets, the entry completes and cancels the recipient's 750 ms gossip and 3 s fanout. Leave `markDirectEventSent` as it is; it already requires `recipient === requester`.

**Bounds.** Purely reactive: it turns six refused pulls into one served page. Acceptance: own-device pulls refused as not accepted ≤ 5 %, and zero `dm_notification_request_mismatch` exhaustions from own devices.

### P2. m:0 for everything Hub sends to an own device, and no relaying of own-probe answers (no wire change)

**Why.** M7. A phone with a linked Hub receives the Hub's own probe answers and summary notifies signed `m = 5`. A 3.0.3 phone re-floods each one to its neighbours, and the Hub itself re-floods answers to its own probes. None of that traffic helps anyone.

**Sketch.**

- Give `buildSignedDirectNotifyWire` a `maxHops` option (GO has `options.maxHops`). Use `0` for every notify sent directly to an own device, and for **probe answers whose requester address is a local account** (the prober is an own device). The value is inside the signed fields, so it cannot be changed after signing.
- **Put `m` on the wire whenever `maxHops` differs from 5**, as GO does: `...(maxHops !== RETICULUM_CHAT_DM_NOTIFY_MAX_HOPS ? { m: maxHops } : {})`. Today the builder writes `m` only for self-DMs (v3.0.3 L28506: `...(selfDm ? { m: 0 } : {})`), and receivers rebuild the signature material with a missing `m` read as 5 (v3.0.3 L5813). A notify signed with `m: 0` but sent without `m` fails signature verification on 3.0.3 and on new peers alike. The same applies to probe answers: `handleDirectProbe` builds them with the same function (v3.0.3 L20767).
- In `buildSignedDirectProbeWire`, record every self-issued probe id in a small map (TTL about 2 min, at most 256 entries, pruned in `pruneDmDiscoveryRoutes`). In `handleDirectNotify`, after the local `queueDirectMissingEvents`, return without relaying when `notify.r` is one of them.
- Keep relaying ordinary (`m = 5`) own-account notifies that arrive from an own device. A phone is a leaf and its Hub is often its best-connected neighbour, so the phone's tracked notifies depend on the Hub to spread them. Only `m: 0` own-device traffic must stay local, and `hop >= maxHops` (v3.0.3 L20653-20655) already stops that.

**Bounds.** Acceptance: zero `dm_notify` relays (`h ≥ 1`) of `m: 0` own-device notifies or of answers to the node's own probes.

### P3. Own-device inbound link reservation (no wire change)

**Why.** M8. Every own-device mechanism in GO needs an admitted link to the Hub. A Hub with 8 ordinary inbound neighbours refuses the phone. A phone that announces `inbound_full` is never dialled by the Hub, even though the Hub pins it for Saved Messages.

**Sketch** (`electron/resources/presence_bridge.py`):

- `_admit_overlay_peer_if_allowed(incoming=True)` and `_overlay_incoming_probation_allowed`: treat chat-pinned peers (`_prune_pinned_chat_overlay_peers()`, set by `configure_reticulum_chat_pinned_peers`) like call-pinned ones. That gives them their own inbound budget of `_OVERLAY_MAX_PINNED_CHAT_PEERS` (already 4) that ordinary peers cannot fill. Admit before the pin lands if the peer holds a current own-account lease.
- `_overlay_inbound_full_hint`: do not count chat-pinned peers. Keep advertising capacity while a chat-pinned own device has no link, as GO's bridge now does (`_own_device_link_wanted_locked`).
- The two dial skips (L12279, L12758): exempt `_overlay_peer_is_pinned_for_chat` as well as call-pinned peers. Cap the dial-failure suppression for chat-pinned peers at about 30 s.

**Cost note.** An extra link means extra relayed gossip reaching the phone, an estimated +12 % inbound while linked. Pair the reservation with not forwarding ordinary relay traffic over a reserved own-device link, or with the phone counting it against its ordinary budget. Acceptance: inbound packets at the phone with the Hub linked stay within +2 % of the no-link level.

### P4. On an own device's hello or new lease session: announce recent DM conversations and replay read states (no wire change)

**Why.** M5. Today a phone that comes back gets Saved Messages only. Mail from other people that reached the Hub in the meantime arrives only if the phone probes. GO probes only in the foreground, so a phone kept awake in the background (charging mode) or a second Hub never catches up.

**Sketch.** In the `hello_v3` branch, next to `announceSelfDmSummariesToPeer(peerHash)` (v3.0.3 L18118), and when an own-account lease appears with a new `sessionId`:

- `announceRecentDmSummariesToOwnDevice(peerHash)`: for each local owner, take the conversations that changed since the last announcement to that `owner|peer|sessionId` key (the same key shape as `selfDmAnnouncementKey`). Build one untracked notify per conversation, signed `m: 0` with `m` on the wire (see P2), and `sendToPeerOnce` it. At most 8 conversations per trigger; a rotating window after that (see P8). Skip self-DMs, which already have their own path. Remember each announced cursor only when the device pulls it (see P6).
- Call the existing `replayReadStatesToOwnDevices()` from the same place. Today it waits for the next discovery cycle, 5-6 min away.

A 3.0.3 receiver pulls these notifies like any local-conversation notify. GO already skips pulling an own-device notify whose `lc` matches one of its newest local events. For a phone in the foreground this overlaps with GO's targeted probe, so keep it bounded and deduplicated. It must not become a burst on every hello.

**Bounds.** At most 8 notifies per device session plus 1 per changed conversation; no timers.

### P5. Recovery sweep for account-authored copies held for another installation (no wire change)

**Why.** Once Hub holds a phone-written DM (stored with `own_event = 0` and `delivery_status = 'received'`, v3.0.3 `insertDirectEvent`), only two things carry it to the recipient:

- the 15-minute summary, and only while it is the conversation's newest event and within the top 16;
- the recipient's own probe.

Nothing reacts when the recipient comes back. The phone's retries stop when the phone freezes.

**Sketch.** A pending set is cheap to derive:

```sql
sender_address IN (local) AND recipient_address <> sender_address
AND own_event = 0 AND delivery_status <> 'sent'
```

When the recipient pulls from Hub, `markDirectEventSent` already flips the row to `'sent'` (the authorize loop, v3.0.3 L40921-40928). Behaviour:

- When the recipient's presence reappears (a new lease session), send **one targeted recovery notify** per conversation (direct to that lease, `{ recovery: true }`, newest pending event only).
- Also send one on the existing discovery tick while the recipient is online and the copy is still unpulled.

**Bounds.**

- At most 3 notifies per conversation per recipient presence session.
- Hard stop 24 h after the event; after that the existing 15-minute summary still covers it.
- Stop when the recipient pulls, or when a notify from the recipient shows an `lc` at or past the event (the recipient never pulls what it already holds, for example after pulling from the phone directly).
- No new timers.

### P6. Remember self-DM announcements only after an observed pull (no wire change)

**Why.** `rememberSelfDmAnnouncement` runs when the bridge accepts the send (v3.0.3 L28574, L28898), not when the other device receives it. A notify lost in a link re-dial is never sent again, and the Saved Message stays missing on that device until the next one. Seen in our soak run, round 10 (13 of 14 imported; the gap healed only with the next message).

**Sketch.** Keep a separate "confirmed" map, as GO does (`confirmSelfDmCursor…`). Set it in `authorizeDirectDmPageResource` when a verified own device pulls the self conversation and the page contains the cursor, or when that device's self notify carries a matching `lc`. `announceSelfDmSummariesToPeer` compares against the confirmed cursor and announces the newest **unconfirmed** own-authored cursor, not the summary's latest. Cap: at most 12 re-notifies per cursor per device session, at least 5 min apart on the periodic carrier and 60 s apart on edges.

### P7. Delivery status to own devices (**wire change**, optional feature)

**Why.** When Hub delivers a phone-written message, the phone never learns about it. It keeps showing "saved on your other device", and it cannot stop its own slow retry tail early. Nothing in 3.0.3 carries delivery status between own devices; there is no such wire kind.

**Sketch, preferred.** Use the `ds1` device-state sync from `HUB_NOTIFICATION_SYNC.md` once it is ported. That needs no additional wire kind:

- key: `dm.dlv.<first 24 hex chars of sha256(conversationId)>`;
- value: the highest timestamp of own-account events in that conversation that a recipient pull has covered;
- receivers apply the maximum.

It inherits signing, chunking, acks, catch-up and the per-owner row cap. Write it only from the authorize loop, where `markDirectEventSent` runs today, coalesced to at most one write per conversation per minute. If you would rather not depend on `ds1`, use a new kind behind a new optional feature token. Keep that token at most 3 characters: GO's `hello_v3` has 7 bytes of headroom left under the 383-byte MDU.

**Bounds.** Queue while no own device is linked and replay on the next session (the `ds1` replay already does this). At most one record per conversation per minute.

### P8. Page through conversations instead of the fixed 16 (no wire change)

**Why.** M6. With more than 16 active conversations, the older ones are never announced to a prober or in the summary.

**Sketch.** Use a rotating window rather than raising the cap: the 8 most recent conversations plus the next 8 from a per-requester (or per-owner) rotating cursor over the rest. Apply it in `handleDirectProbe` (L20762) and `broadcastDmNotificationsForLocalAddresses` (L28849). Every conversation gets covered over successive probes, and no single probe costs a phone more than 16 answers. Each answer can trigger a pull.

### P9. Never evict events the same account wrote on another installation (no wire change)

**Why.** Group events imported from the network are stored with `own_event = 0` even when the author is the local account (`acceptEvent(…, false)`, v3.0.3 L23703, L39572). They are therefore candidates for the 50 MiB cache eviction (`RETICULUM_CHAT_CACHE_MAX_BYTES`, `enforceRelayCacheLimit`, `stmtEvictCandidate … WHERE own_event = 0`). On a busy account the Hub's replica of a post the phone wrote can be evicted, and then the account itself may no longer hold a copy while the phone is offline (other group members may still hold theirs). DMs are not affected: `rchat_dm_events` rows are deleted only at their signed expiry.

**Sketch.** Change only the eviction rule. In `reticulum-chat-db.ts`, add `AND author_address NOT IN (<local addresses>)` to both `stmtEvictCandidate` and `stmtTotalCacheBytes` (bind the list as a parameter, for example through `json_each`), and apply the same filter to the in-memory `memoryMeta` fallback in `getRelayCacheBytes` and `enforceRelayCacheLimit`. A separate column (for example `account_authored`, set at import when the author is a local address) works as well.

Do **not** reuse `own_event` by importing these events with `acceptEvent(event, true)`. In v3.0.3 that flag means "published here" and drives other paths: an own event that needs privileged-mention authorization is stored as already validated (`storeValidatedEvent(…, 1)`, L26796-26799), which skips the admin check that an imported event must pass; it is passed to `syncGroupResourceReferences` as `locallyAuthored` (L26824, L37435); and `hasRemoteChannelMetadataEvents` counts only `own_event = 0` rows.

### P10. Counters and provider-side refusal logs (no wire change)

**Why.** Provider refusals are invisible. The engine's `reject()` in `authorizeDirectDmPageResource` writes no log line, and the requester logs only the final `dm_link_pull_exhausted`. Hub's stdout lines carry no timestamps. Every finding in section 2 had to be reconstructed from the requester's side.

**Sketch.**

- One per-minute summary line with delivery counters, skipped when all are zero. GO uses this format in its `bridge_traffic` line. Counters:
  - DM pages served to an own device or to a recipient;
  - refusals by reason;
  - own-device notifies sent;
  - probe answers sent;
  - pulls exhausted by reason.
- Refusals aggregated per `reason:requester-prefix`, logged at most once a minute.
- A timestamp on every stdout line.

### Lower priority

- **Pull cursor for own-account notifies.** A pull triggered by a notify the account itself signed asks only for events after the account's own newest event minus 1 (`requestDirectMissingEvents`, v3.0.3 L20250-20313). Messages from the other party that only the phone holds, and that are older than the Hub's newest own message, are skipped. GO now works around most of this on its side (it skips answers whose `lc` it already holds, and uses a bounded look-back on gap-closing pulls). A Hub-side fix: when the notify's source is a verified own device, use `min(own newest, other party's newest) − 1`, bounded to about 15 min. For the first pull after a long gap, look back as far as the gap (up to 48 h).
- **Persist read-sync acks** (they are in memory today, so every reconnect replays all watermarks, and each one costs the phone a signature check), as the `ds1` acks already are.
- **A hello feature for phones.** A short optional token (at most 3 characters, see the headroom note in P7) could tell Hub that the peer is a battery-limited leaf. Hub would then avoid routing interest and gossip through it. Hub 3.0.3 drops unknown hello features without rejecting the peer (v3.0.3 L18097-18106), so this is compatible.
- **A UI field for a manual `reachable_on` or a private own-device listener**, so a phone can reach the home Hub directly over LAN or a VPN. GO has deferred its side of this until the link-stability numbers are in.

**Core:** nothing needed. Delivery is Reticulum and chat-engine behaviour only.

## 5. Battery constraints for phones

The phone is the scarce side. Please design every Hub change above around these rules. GO's own side follows them.

1. **m:0 for anything addressed to an own device**, probe answers included. Hub-to-phone traffic must never be forwarded again by the phone.
2. **Targeted sends only.** Own-device traffic goes directly to a named own device, never through gossip, interest routes or fanout. Send only when an overlay link to that device is admitted. A lease sighting alone is not enough, because a direct packet cannot be delivered without a link, and each failed attempt costs wakeups on both sides.
3. **Event-triggered, no loops aimed at phones.** Allowed triggers: an own device's hello, a new lease session, an own send, and the recipient's presence reappearing. Anything periodic rides existing ticks (the 5-6 min DM discovery, the 15-minute summary).
4. **Assume the phone is frozen.** A phone is running while on screen, for about 60 s after, and longer only in GO's keep-alive modes (M1-M3). Anything sent to a frozen phone is lost. Stop after a few unanswered sends per device session (GO uses 3) and resume on the next hello or session. Never retry into the void.
5. **Every packet costs the phone a signature check.** About 8 ms with JIT; an estimated 50-300 ms on phones that run without JIT, such as some GrapheneOS setups. Bound bursts: at most 16 answers per probe, at most 8 conversations per own-device trigger.
6. **Count, don't log.** Per-minute counters, as in P10, not per-event lines.

Acceptance after a Hub release, measured on the phone:

- at most 3 notifies per conversation per recipient session;
- zero `dm_notify` relays caused by own-device traffic;
- own-Hub pulls not accepted ≤ 5 %;
- inbound packets with the Hub linked within +2 % of the no-link level;
- no regression in CPU, wakeups or radio time for a phone **without** an own Hub.

## 6. Compatibility summary

| Change                                    | Wire change?                                      | Interaction with 3.0.3 peers                                                                                                        |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1 mismatch exemption                     | No                                                | Provider-side authorization only.                                                                                                   |
| P2 m:0 to own devices, no own-probe relay | No (`m` is an existing signed field)              | 3.0.3 accepts `0 ≤ h ≤ m ≤ 5` and does not forward at `h ≥ m`, provided `m` is on the wire. Inferred from code, not yet tried live. |
| P3 own-device inbound reservation         | No                                                | Local admission policy; the `inboundFull` announce flag keeps its meaning.                                                          |
| P4 announce on own-device hello           | No                                                | Standard untracked `dm_notify`; a 3.0.3 receiver pulls it.                                                                          |
| P5 recovery sweep                         | No                                                | Existing recovery notify.                                                                                                           |
| P6 confirm-after-pull for Saved Messages  | No                                                | Local state only.                                                                                                                   |
| P7 delivery status                        | **Yes**: via `ds1` records or a new optional kind | A 3.0.3 peer ignores unknown kinds (`handleWire` default arm) and lacks the feature, so it is never expected to answer.             |
| P8 rotating window                        | No                                                | Same answers, different selection.                                                                                                  |
| P9 eviction rule                          | No                                                | Local DB policy.                                                                                                                    |
| P10 counters and logs                     | No                                                | Local only.                                                                                                                         |

Things that were considered and **rejected** because they break 3.0.3:

- adding fields to `dm_notify` or `dm_req` (for example a "copy for own device" flag or a delivery field): their signature material is fixed;
- pushing DM bodies (`dm_event`, `dm_page_offer`) unasked: 3.0.3 does not act on an unsolicited offer;
- relaying Saved Messages notifies: 3.0.3 accepts a self notify only directly from a verified own device (v3.0.3 L20558-20568);
- turning the relay cache back on: 3.0.3 answers `relay-cache-disabled`, and it would put group content on non-members.

If the GO fork's DB code is ever merged, its `rchat_dm_events.own_device_copied_at` column is additive and nullable, and Hub can ignore it.

## 7. Open points

- Whether a minimised or hidden Hub window keeps `setLocalDmAddresses` and the group subscriptions active on an always-on server. The renderer drives both. If it does not, none of the own-device paths work while the window is closed. Not checked.
- Whether Hub 3.0.3 copies DM attachments (`dm_resource_find` / `dm_resource_have`) for phone-written DMs, so a recipient can fetch them after the phone goes offline. Not checked.
- "Sent" and "copied" are set at authorization, not at transfer completion. A failed transfer after authorization leaves a false "sent" that is never retried. This affects both clients; moving both marks to transfer completion would be more accurate.
- The live numbers (copy latency after send-then-hide, before and after, on more than one phone) are still to be recorded. We will add them to this note when we have them.
