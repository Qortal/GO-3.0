# Hub ⇄ GO notification sync — port guide for the Qortal Hub team

From the Qortal GO fork (`https://gitea.qortal.link/simon/GO-3.0`, branch `feature/hub-3.0.3-go`), 2026-09-29.
Companion to [`HUB_DEV_NOTES.md`](HUB_DEV_NOTES.md). Everything below is implemented and tested on the GO side; this note tells you what to take into upstream Hub so the two clients sync with each other.

## What this gives users

1. **Q-app / website notification settings follow the account.** Rules registered with `NOTIFICATION_ADD`, the per-app permission grants, the per-app "disable OS push" switch, the Q-Chat mention-alert toggle, the "seen all" timestamp and the per-notification seen marks are mirrored between the account's own devices over Reticulum. Today all of that is device-local in `appStorage`/`localStorage`: an app you allowed on Hub is silent on GO until you open it there and allow it again, and seen state never crosses.
2. **A delivered chat alert clears once you read the chat elsewhere.** Read state already syncs between own devices (`read_sync`, feature `read_sync_v2`) and clears badges, but a tray alert that was already shown stayed. Alerts for Reticulum DMs and group mentions now have a stable per-conversation id and are cancelled when the synced unread or mention count for that conversation reaches zero.
3. **A "Synced across your devices" panel** in the notification settings that explains what is shared and shows the live state (engine starting, no other device online, other device too old, linked with N devices).

Two facts from the investigation that shaped the design:

- The Reticulum chat engine never talks to a Core node, and phone and desktop dial the same public Reticulum hubs, so own-device sync works regardless of which node (public gateway or private) each device uses.
- The Core `/websockets/notifications` endpoint on the public gateway (`ext-node.qortal.link`, `api.qortal.org`, core 6.1.9) accepts custom `RESOURCE_PUBLISHED` subscriptions and returns history exactly like a local node. So the notifications themselves never need relaying; only the device-local _state_ does.

## Scope for Hub

| Part                 | What                                                                                   | Hub change needed?                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Alert loop        | Stable alert keys, cancel on remote read, tap-to-open                                  | GO-side except for the small desktop piece (new `src/utils/reticulumChatAlerts.ts` + `background.ts` Notification map + `WebsocketNotifications.tsx` dismiss triggers). Works against Hub 3.0.3 as-is because it only consumes the existing `read_sync`. |
| B. Device-state sync | New engine wire kinds, DB tables, signer whitelist, plumbing, renderer, settings panel | **Yes — this is the port.** Until Hub ships it, a GO phone reports the desktop as "online but its version does not support notification sync yet" and nothing is exchanged (the new kinds are ignored by 3.0.3, see §B.8).                               |

The engine file `electron/src/reticulum-chat.ts` is shared by both platforms (Electron main on desktop, a Web Worker on Android), so the engine, DB and renderer changes are the same code on both sides; only the plumbing differs.

## Files changed in the GO fork (lines added / removed)

| Area     | File                                                                                                                                                                 | +/-                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Engine   | `electron/src/reticulum-chat.ts`                                                                                                                                     | +1140 / −1                   |
|          | `electron/src/reticulum-chat.test.ts`                                                                                                                                | +837 / −4                    |
|          | `src/background/reticulum-signing-policy.ts` (+ `.test.ts`)                                                                                                          | +8 / +16                     |
| DB       | `electron/src/reticulum-chat-db.ts`                                                                                                                                  | +485                         |
|          | `src/test/mocks/betterSqlite3.ts`                                                                                                                                    | +274 / −2                    |
|          | `electron/src/reticulum-chat-device-state-db.test.ts` (new)                                                                                                          | +469                         |
| Plumbing | `electron/src/setup.ts`                                                                                                                                              | +91                          |
|          | `electron/src/preload.ts`                                                                                                                                            | +112                         |
|          | `src/types/window.d.ts`                                                                                                                                              | +41                          |
|          | `src/reticulumChat/mobile/engineHost.ts`, `src/reticulumChat/mobile/index.ts` (GO only)                                                                              | +82 / −12, +4                |
| Renderer | `src/utils/notificationStateSync.ts` (new, + `.test.ts`)                                                                                                             | +785, +433                   |
|          | `src/components/App/NotificationStateSync.tsx` (new)                                                                                                                 | +811                         |
|          | `src/qortal/get.ts`                                                                                                                                                  | +209 / −40                   |
|          | `src/qortal/qortal-requests.ts`, `src/utils/qChatMentionNotifications.ts`, `src/atoms/global.ts`                                                                     | +14 / −3, +2 / −1, +41 / −11 |
|          | `src/components/GeneralNotifications.tsx`                                                                                                                            | +206 / −34                   |
|          | `src/components/Group/Group.tsx` (mount line + import)                                                                                                               | +2                           |
|          | `src/i18n/locales/*/core.json` (8 keys, 12 locales)                                                                                                                  | —                            |
| Alerts   | `src/utils/reticulumChatAlerts.ts` (new, + `.test.ts`)                                                                                                               | +80, +232                    |
|          | `src/background/background.ts`                                                                                                                                       | +108 / −23                   |
|          | `src/components/Group/WebsocketNotifications.tsx`                                                                                                                    | +73 / −3                     |
|          | `src/utils/mobileOsNotifications.ts`, `src/plugins/QortalBackground.ts`, `src/components/Mobile/MobileAlertNotificationBridge.tsx`, two Android Java files (GO only) | —                            |
| Docs     | `docs/reticulum-multi-device-reference.md`, `CHANGELOG.md`                                                                                                           | —                            |

The line numbers quoted below are from the GO fork and will drift; grep for the identifiers.

---

## Part B — device-state sync (the port)

### B.1 Feature flag: `ds1`

- Add `'ds1'` to the `ReticulumChatProtocolFeature` union, to `RETICULUM_CHAT_PROTOCOL_FEATURES` and to **`RETICULUM_CHAT_OPTIONAL_PROTOCOL_FEATURES`**. If it is not optional, `isCompatibleHello()` rejects every peer that lacks it and 3.0.3 clients stop pairing.
- The token is deliberately three characters. `hello_v3` carries the whole feature list in one packet; the Reticulum MDU is 383 bytes (`RT_RETICULUM_MAX_WIRE_JSON_BYTES` in `electron/src/reticulum-wire-size.ts`) and the hello is now **376 bytes with 7 bytes of headroom**. A longer name (we tried `device_state_v1`) makes `sendToPeerOnce` fail with `wire-too-large` on every hello, for everyone. There is a comment above the feature list and a test (`advertises ds1 in a hello wire that still fits the Reticulum MDU`) that pins the headroom and asserts that re-enabling `relay_cache` or `group_keys` would overflow — keep both.

### B.2 Wire kinds

Three members added to the `ReticulumChatWire` union, dispatched from `handleWire` next to `read_sync`:

```ts
export type ReticulumChatDeviceStateWire = {
  k: string; // key, 1..48 printable ASCII chars, no whitespace
  v?: string; // value or value chunk; absent on a tombstone
  n: number; // signedAt (ms)
  e?: number; // expiresAt (ms), absent when null
  p: string; // author public key (base58)
  z: string; // signature over the FULL joined value (base58)
  i?: number; // chunk index   } only when the value is chunked
  m?: number; // chunk count   }
};
export type ReticulumChatDeviceStateAckWire = {
  o: string;
  k: string;
  n: number;
}; // o = ownerAddress
export type ReticulumChatDeviceStateReqWire = { o: string; s: number }; // "send me rows with signed_at > s"
// { t:'RCHAT'; k:'device_state';     w: ReticulumChatDeviceStateWire }
// { t:'RCHAT'; k:'device_state_ack'; w: ReticulumChatDeviceStateAckWire }
// { t:'RCHAT'; k:'device_state_req'; w: ReticulumChatDeviceStateReqWire }
```

Constants (exported ones first):

| Constant                                                                      | Value                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETICULUM_CHAT_DEVICE_STATE_KEY_MAX_LENGTH`                                  | 48                                                                                                                                                                                                                  |
| `RETICULUM_CHAT_DEVICE_STATE_VALUE_MAX_BYTES`                                 | 2 048 (UTF-8)                                                                                                                                                                                                       |
| `RETICULUM_CHAT_DEVICE_STATE_MAX_CHUNKS`                                      | 128                                                                                                                                                                                                                 |
| `…_MIN_CHUNK_BYTES`                                                           | 16 (minimum per-chunk value capacity; `buildReticulumChatDeviceStateWires` returns `null` below it, and `setDeviceState` has a defensive `key-too-long` check that the 48-char key limit already makes unreachable) |
| `…_MAX_PER_OWNER`                                                             | 5 000 rows                                                                                                                                                                                                          |
| `…_REASSEMBLY_TTL_MS` / `…_REASSEMBLY_MAX_BUFFERS` / `…_REASSEMBLY_MAX_BYTES` | 90 000 / 256 / 32 768 (= value max × send batch × 2)                                                                                                                                                                |
| `…_REASSEMBLY_SWEEP_MS`                                                       | 15 000                                                                                                                                                                                                              |
| `…_SEND_BATCH`                                                                | 8                                                                                                                                                                                                                   |
| `…_PRUNE_INTERVAL_MS`                                                         | 60 min                                                                                                                                                                                                              |
| `…_REQ_TTL_MS` / `…_REQ_MAX`                                                  | 10 min / 4 096 (catch-up dedupe)                                                                                                                                                                                    |
| `…_MIN_TTL_MS`                                                                | 60 000                                                                                                                                                                                                              |
| `…_KEY_PATTERN`                                                               | `/^[\x21-\x7e]+$/`                                                                                                                                                                                                  |

### B.3 Signing

Signed fields (`buildReticulumChatDeviceStateSignedFields`) are always exactly these six, with `null` never omitted:

```ts
{ type: 'RCHAT_DEVICE_STATE_V1', ownerAddress, key, value: value ?? null, signedAt, expiresAt: expiresAt ?? null }
```

The account signer merges `authorAddress`/`authorPublicKey`, canonicalises (sorted keys, JSON, `nacl.sign.detached`) like every other RCHAT control signature. **The signer whitelist must be extended or nothing ever gets signed**, on either platform (`src/background/reticulum-signing-policy.ts`, `rchatSchemas`):

```ts
RCHAT_DEVICE_STATE_V1: schema(['type', 'ownerAddress', 'key', 'value', 'signedAt', 'expiresAt']),
```

`matchesSchema` requires every key present and `!== undefined`; `null` passes. The test `allows every current typed RCHAT control schema` gained a value payload and a tombstone payload.

`verifyReticulumChatDeviceStateWire(wire, joinedValue, now)` returns a record or `null`: owner address derived from `p` must be a valid Qortal address; key and value limits as above; `signedAt` a safe integer > 0 and ≤ `now + RETICULUM_CHAT_CONTROL_MAX_FUTURE_SKEW_MS` (30 s, the read-sync rule); `expiresAt`, when present, a safe integer > `signedAt`; then the Ed25519 check over the rebuilt fields.

### B.4 Chunking and reassembly

Sender (`buildReticulumChatDeviceStateWires`): if the single wire passes `wireFitsReticulumChat`, send it. Otherwise measure the real capacity with a probe wire (`v: ''`, `i: 127`, `m: 128`), fail if < 16 bytes, and split the value **by code point** (surrogate pairs never split) using the JSON-escaped UTF-8 cost of each character; 2..128 chunks, every chunk repeats `k n e p z` and carries `i m`, every chunk is re-checked against the MDU. A tombstone always fits (no `v`). With a 48-character key about 40 bytes of value fit per chunk, which is why the renderer hashes keys down to 35–37 characters (§B.10).

Receiver (`handleDeviceState`), in this order, and nothing is buffered or written before step 4 passes:

1. `w.p` non-empty string and key valid, else drop `invalid-wire`;
2. owner = address from `p`; must be in `localDmAddresses`, else `unknown-owner`;
3. `verifiedDeviceStateSource(owner, peerHash)`: `routePeerHash(peerHash) ?? peerHash.toLowerCase()` must be in `getVerifiedDmPeerHashes(owner)`, else `unverified-peer` (same trust model as `read_sync`: only endpoints holding a verified lease for that account);
4. `n` safe integer > 0;
5. no `i`/`m` → apply directly; otherwise `0 ≤ i < m ≤ 128`, `v` a string;
6. buffer key `${sourcePeer}:${owner}:${k}:${n}` (per source device, so two own devices replaying the same record never interleave); TTL 90 s; oldest evicted beyond 256 buffers; total budget 32 KiB; a repeated index with identical content is idempotent, differing content or a different `m` drops the buffer (`chunk-conflict`);
7. when complete: join, verify signature (`invalid-signature`), drop already-expired records (`expired`, **no ack**), `db.upsertDeviceState` (strict last-writer-wins on `signed_at`), then **always** send `device_state_ack {o,k,n}` back to the source, also for duplicates and older rows, so the sender stops replaying; emit `deviceStateChanged` only when the row changed.

Drops are counted per `${reason}:${peerHash.slice(0,12)}` and logged at most once a minute as `[ReticulumChat] device_state_dropped …` (`noteDeviceStateDropped`).

### B.5 Acks, replay, catch-up

- `handleDeviceStateAck`: silently ignored unless the source passes the same trust gate for `w.o` and the local row for `(o, k)` exists with `signedAt === n`; then `db.upsertDeviceStateAck(owner, sourcePeer, k, n)`. Acks are **persisted** (unlike read-sync's in-memory acks), so a restart does not replay everything.
- `replayDeviceStatesToOwnDevices()`: for each local owner and each `ownDeviceStatePeerHashes(owner)`, send `db.getDeviceStatesForReplay(owner, peer, 5000)` (rows the peer has not acked at that `signed_at`) in batches of 8 (`Promise.all`, `setTimeout(0)` between batches), stopping at the first failed send. Called at the four places `replayReadStatesToOwnDevices()` is called: `setLocalGroupMemberships`, `setLocalDmAddresses`, `notifyOverlayHealthChanged`, and the end of `runDmDiscovery` (reached from `flushPendingDmDiscoveryIfHealthy` and from every DM digest timer cycle).
- `ownDeviceStatePeerHashes(owner)` = `getVerifiedDmPeerHashes(owner)` minus the local peer, minus peers whose `peerFeatureSupport(peer, 'ds1') === 'unsupported'`. Peers with **unknown** support (no hello seen yet in this process) are included; a 3.0.3 peer ignores the kind (§B.8) and is marked unsupported once its hello arrives.
- Catch-up (`requestDeviceStateCatchup(peer)`): sends `device_state_req { o: owner, s: newestDeviceStateSignedAt(owner) }` (the in-memory monotonic clock of §B.7, seeded from `db.getNewestDeviceStateSignedAt`) once per `${owner}:${peer}` per 10 minutes (map capped at 4 096). Triggered (a) in the `hello_v3` branch of `handleWire` right after the peer's features are stored, when it advertises `ds1`, and (b) from `requestDeviceStateCatchupFromOwnDevices()` at the end of `runDmDiscovery` (the body behind `flushPendingDmDiscoveryIfHealthy`, also run by the DM digest timer), because leases usually arrive after the hello. `handleDeviceStateReq` answers with `db.getDeviceStatesSince(o, s, 5000)` (strictly newer than `s`, expired excluded, tombstones included) after the same trust gate. This covers a device that kept its Reticulum identity but lost its chat database.

### B.6 Database

Three tables and one index in `initSchema` of `electron/src/reticulum-chat-db.ts`, right after `rchat_pending_device_read_state` (keep one column per line: the Vitest SQLite mock registers columns by the first token of each line), plus entries in the `requiredTables` self-check so a missed migration fails at open instead of silently:

```sql
CREATE TABLE IF NOT EXISTS rchat_device_state (
  owner_address TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  signed_at INTEGER NOT NULL,
  expires_at INTEGER,
  author_public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  PRIMARY KEY (owner_address, key)
);
CREATE INDEX IF NOT EXISTS idx_rchat_device_state_owner_time
  ON rchat_device_state (owner_address, signed_at DESC);
CREATE TABLE IF NOT EXISTS rchat_pending_device_state (
  owner_address TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_address, key)
);
CREATE TABLE IF NOT EXISTS rchat_device_state_ack (
  owner_address TEXT NOT NULL,
  peer_hash TEXT NOT NULL,
  key TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  PRIMARY KEY (owner_address, peer_hash, key)
);
```

Exported types: `ReticulumChatDeviceStateRecord { ownerAddress, key, value: string | null, signedAt, expiresAt: number | null, authorPublicKey, signature }` and `ReticulumChatPendingDeviceState { ownerAddress, key, value, expiresAt, updatedAt }`.

DB methods the manager calls:

| Method                                                                                         | Semantics                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upsertDeviceState(record): boolean`                                                           | `INSERT … ON CONFLICT(owner_address, key) DO UPDATE … WHERE excluded.signed_at > rchat_device_state.signed_at` — strictly greater; equal is ignored; returns `changes > 0` |
| `getDeviceState(owner, key)`                                                                   | raw lookup, **includes expired rows** (used for the ack check and the row cap)                                                                                             |
| `getDeviceStates(owner, prefix?, limit = 5000)`                                                | `key >= ? AND substr(key, 1, ?) = ?` (exact-case; SQLite `LIKE` folds ASCII case), expired excluded, tombstones included, `ORDER BY signed_at ASC, key ASC`                |
| `getDeviceStatesSince(owner, since, limit)`                                                    | `signed_at > since`, expired excluded                                                                                                                                      |
| `getDeviceStatesForReplay(owner, peerHash, limit)`                                             | `LEFT JOIN rchat_device_state_ack a ON … AND a.peer_hash = ?` with `a.signed_at IS NULL OR a.signed_at < s.signed_at`, expired excluded                                    |
| `getNewestDeviceStateSignedAt(owner)`                                                          | `ORDER BY signed_at DESC LIMIT 1` (served by the index); seeds the monotonic clock and `device_state_req.s`                                                                |
| `countDeviceStates(owner)`                                                                     | all rows incl. expired and tombstones (5 000 cap)                                                                                                                          |
| `upsertDeviceStateAck(owner, peer, key, signedAt)` / `getDeviceStateAck(...)`                  | unconditional overwrite; the guard is in the manager                                                                                                                       |
| `upsertPendingDeviceState(state)`                                                              | `WHERE excluded.updated_at >= …` so two writes in one millisecond keep the latest                                                                                          |
| `getPendingDeviceStates(owner, limit)` / `deletePendingDeviceState(owner, key, upToUpdatedAt)` | watermark delete `updated_at <= ?`                                                                                                                                         |
| `pruneDeviceStates(now): { expired, tombstones }`                                              | one transaction: delete acks of expired rows, expired rows, acks of tombstones older than 30 days, those tombstones                                                        |

The Vitest suite replaces `better-sqlite3` with a hand-written mock (`src/test/mocks/betterSqlite3.ts`) that matches SQL by substring: every new statement shape needs a handler there, and `rchat_device_state` is a prefix of `rchat_device_state_ack`, so the GO fork uses word-bounded regexes. Because the mock proves nothing about real SQL, every statement above was also run through real SQLite (python `sqlite3` 3.46.1) during verification. On Android the same SQL runs on sqlite-wasm; on desktop on better-sqlite3.

### B.7 Manager API, lifecycle and the renderer contract

```ts
setDeviceState(ownerAddress, key, value: string | null, options?: { ttlMs?: number }): { success: boolean; error?: string }
getDeviceStates(ownerAddress, keyPrefix?): ReticulumChatDeviceStateRecord[]
getDeviceStateSyncPeers(ownerAddress): { peerHash: string; supported: boolean; support: 'supported' | 'unsupported' | 'unknown' }[]
// event: 'deviceStateChanged' { ownerAddress, key, value, signedAt, expiresAt, source: 'local' | 'remote' }
```

`setDeviceState` error codes, in check order: `closed`, `unknown-owner` (owner not in `localDmAddresses`), `invalid-key`, `invalid-value`, `key-too-long`, `invalid-ttl` (ttl < 60 s), `too-many-keys`. On success it writes the durable pending row and queues signing (microtask flush, then the read-sync retry backoff 1 s → 30 s while the signer is unavailable). `signedAt` is monotonic per owner: `max(now, newest signed_at this device holds + 1)`, seeded from the DB and raised whenever a remote row is accepted, so a local write always wins LWW against anything this device has seen. A record that cannot be built or fails self-verification is dropped from the pending table with a `device_state_unsendable` warning instead of retrying forever.

Lifecycle: the prune timer starts from `setLocalDmAddresses` (prune once, then hourly, `unref`'d); the reassembly sweep only runs while buffers exist; `clearDeviceStateRuntimeState()` (pending map, signedAt map, buffers, catch-up dedupe, timers) is called from `close()` and `clearLocalAccountRuntimeState()`; every async loop snapshots `localAccountGeneration` and bails out when it changes. New kinds are **not** added to `isRetryableControlWire` (read sync is not there either; replay covers loss).

### B.8 Compatibility with Hub 3.0.3

- Unknown wire kinds hit the `default: return` arm of `handleWire`, so a 3.0.3 peer that receives `device_state` (because its support was still unknown) ignores it without a protocol violation. Verified against a live 3.0.3 instance.
- `ds1` is optional, so hellos in both directions stay compatible.
- The tables are `CREATE TABLE IF NOT EXISTS`; several Hub instances on one PC already share one chat DB and keep working.
- Nothing changes for users who never open the notification settings; the renderer only publishes real local changes.

### B.9 Plumbing (Electron)

`electron/src/setup.ts`: `ipcMain.handle('reticulumChat:setDeviceState' | 'reticulumChat:getDeviceStates' | 'reticulumChat:getDeviceStateSyncPeers')` with the usual `isReticulumChatEffectivelyEnabled` and manager guards; `manager.on('deviceStateChanged')` broadcast to a `reticulumDeviceStateSubscribers` set with `reticulumChat:deviceStateChanged:subscribe/unsubscribe`, mirroring `directSummaryChanged`. `ensureReticulumChatDeviceStateOwner()` registers the owner with `setLocalDmAddresses([owner])` if the renderer calls before the normal registration (the engine answers `unknown-owner` otherwise). `electron/src/preload.ts`: `setDeviceState`, `getDeviceStates`, `getDeviceStateSyncPeers` and a ref-counted `onDeviceStateChanged(cb) => unsubscribe` in **both** `reticulumChat` blocks (the main one and the `isDisabledLegacy` twin). `src/types/window.d.ts` mirrors the record type and the four members. (On GO the same surface goes through `engineHost.ts`/`mobile/index.ts` RPC.)

### B.10 Renderer

`src/utils/notificationStateSync.ts` (pure, tested) + `src/components/App/NotificationStateSync.tsx` (mounted once in `Group.tsx` next to `<WebSocketNotifications>`, renders nothing, active only when Reticulum chat is enabled and an address is signed in).

Key layout (owner = the account; `h()` = first 24 hex chars of SHA-256, so every key is ≤ 37 characters, 35 for rule/perm/seen and 37 for ospush, well under the 48-char engine limit):

| key                                                   | value                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notif.rule.<h(appService\|appName\|notificationId)>` | canonical JSON of the stored subscription (top-level keys in the fixed order `event, resourceFilter, link, notificationId, appName, appService, message[, image]`; the nested `resourceFilter` and `message` objects have their keys sorted; appName lowercased); tombstone `null` on explicit removal |
| `notif.perm.<h(appName)>`                             | JSON `[1, appName]` granted / `[0, appName]` revoked                                                                                                                                                                                                                                                   |
| `notif.ospush.<h(appName)>`                           | JSON `[1, appName]` OS push disabled / `[0, appName]`                                                                                                                                                                                                                                                  |
| `notif.mentions`                                      | `"1"` / `"0"` (the `q-chat-mention-notifications-disabled` user setting)                                                                                                                                                                                                                               |
| `notif.seenall`                                       | `"<ms>"`, applied only if greater than local                                                                                                                                                                                                                                                           |
| `notif.seen.<h(fullKey)>`                             | JSON `[markTimeMs, fullKey]` with `ttlMs` = remaining part of 4 days; `fullKey` is the existing `RESOURCE_PUBLISHED-<app>-<service>-<id>[-<identifier>]` seen key                                                                                                                                      |

Not synced on purpose: `disable-push-notifications` (a device preference), the legacy on-chain `mutedGroups`, and the app-update seen version.

Behaviour of the component:

- **Readiness**: polls `getReadinessStatus()` every 5 s and listens to `onReadinessChanged`; hydrates on `state === 'ready'` and again when the engine restarts.
- **Hydrate**: `getDeviceStates(address, 'notif.')`, then apply in the fixed order perm → rule → ospush → mentions → seenall → seen (rules of an app whose engine permission is `0` are skipped; seenall takes the larger value; seen marks keep their original mark time). The engine values fill a per-key cache first, so local events that merely echo an applied value never publish again. Then local-only items the engine lacks are pushed; a failed push is retried every 5 s and abandoned after 12 attempts in total (the cache entry is dropped, so the next hydrate or local change publishes it again). Edits made while the engine was still starting win over the stored engine value for that key.
- **Local → engine** (publish only what differs from the cache): the `customWebsocketSubscriptionsAtom` value (adds/updates), `custom-ws-subscriptions-removed {address, items}` (the only removal event; rule tombstones come from it and from a local permission revoke, never from a rule merely missing from the atom), `notification-permission-updated {key, value}` for `qAPPNotification-<address>:<app>` keys (a revoke also tombstones that app's rules), `notification-os-push-updated {appName, disabled}`, `q-chat-mention-notifications-updated {enabled}`, `notification-seen-in-app-updated {address, keys, keyTimes}`, and the `lastPaymentSeenTimestampAtom` value on increase.
- **Engine → local** (`onDeviceStateChanged`, `source: 'remote'`, batched 150 ms): permission `1` → `setPermission(true)`, reconnect the notifications socket (its permission filter runs only at socket init) and pull that app's rule records from the engine; permission `0` → `setPermission(false)`, drop the app's rules, `custom-ws-unsubscribe`; rules → `applySyncedCustomSubscriptions` (drops `RESOURCE_PUBLISHED` rules whose app has no local grant); ospush → `setNotificationOsPushDisabled`; mentions → `setQChatMentionNotificationsEnabled`; seenall → the atom if greater; seen → `addSeenInAppKeysForAddress` with the original times. After each remote apply: `notification-settings-changed` (the settings dialog reloads while open) and, once per device, an `openGlobalSnackBar` notice remembered under the user setting `notification-sync-notice-shown`.

Storage changes that make this possible (`src/qortal/get.ts`, `qortal-requests.ts`, `atoms/global.ts`): all writes to the stored subscription list go through one promise chain (`withSubscriptionWriteLock`) so a sync apply and a `NOTIFICATION_ADD` cannot interleave; `setStoredCustomSubscriptions` additionally emits `custom-ws-subscriptions-changed {address, list}`; new exports `revokeAppNotificationRules(appName)` (the Revoke button now writes storage and emits the removal event instead of editing the atom only), `applySyncedCustomSubscriptions(address, upserts, removals)`, `addSeenInAppKeysForAddress(address, [[markTime, key]])` (keep-newer merge), `parseNotificationPermissionKey`; seen keys are stored with their mark time and the `notification-seen-in-app-updated` payload carries `keyTimes`; `setNotificationOsPushDisabled` now emits an event.

Settings dialog (`GeneralNotifications.tsx`): an info row under the description with title/body and an `aria-live` status line refreshed every 10 s from `getReadinessStatus()` and `getDeviceStateSyncPeers()`; mapping: chat disabled → `notification_sync_status_off`, engine not ready → `…_waiting`, any peer `supported` → `…_linked` (`{{count}}`), else any peer `unsupported` → `…_unsupported`, else `…_no_peer` (peers with unknown support count as "not online yet", which is the normal state right after a restart). The dialog reloads its lists on the permission, OS-push, mention and `notification-settings-changed` events while open.

i18n: eight keys under `core:message.generic` — `notification_sync_title`, `notification_sync_desc`, `notification_sync_arrived`, `notification_sync_status_off|waiting|no_peer|unsupported|linked` — translated in all 12 locales via the i18n scripts. The body text is accurate for the design above (public node works; the other device must run a version with sync).

---

## Part A — alert loop (mostly GO-side; small desktop piece)

`src/utils/reticulumChatAlerts.ts`: `reticulumDmAlertKey(peer) = 'reticulum-dm:<peer>'`, `reticulumMentionAlertKey(groupId) = 'reticulum-mention:<groupId>'`, the historical `hashNotificationId` (moved here unchanged), and an in-memory registry of alerts this device actually showed (`rememberShownAlert` / `wasAlertShown` / `forgetShownAlert`). `dismissShownAlert` is a no-op for keys never shown, so the frequent "mention count is zero" events cost nothing.

`src/background/background.ts`: `fireOsNotificationPayment(..., osOptions?: { alertKey, fromAddress, notificationType })` forwards to `showBackgroundOsNotification(..., alertKey)`. Desktop keeps a `Map<alertKey, Notification>`, closes the previous entry for the same key before showing a new one and exports `dismissOsNotificationByKey(alertKey)`. Click routing is untouched: `data.id`/`onclick` still use the per-fire `notificationId` and `generalNotificationPayloadById`.

`src/components/Group/WebsocketNotifications.tsx`: the DM alert passes `{ alertKey: reticulumDmAlertKey(sender), fromAddress: sender, notificationType: 'direct' }`, the mention alert `{ alertKey: reticulumMentionAlertKey(groupId), fromAddress: String(groupId), notificationType: 'group' }`. Dismissal hangs off events the engine already emits when a `read_sync` is applied: `summaryChanged { readStateChanged: true }` (which `Group.tsx` turns into the existing `q-chat-mention-notification { syncUnreadCount: true, mentionCount }` event; when the count is 0 the mention alert is dismissed, before the "mentions enabled" check so a disabled toggle still clears an old alert) and `directSummaryChanged { peerAddress }` (debounced 250 ms per peer, then `getDirectSummaries(me, peer)`; dismissed when `unreadCount − unreadMissedCallCount ≤ 0`, because the enriched summary folds missed calls into `unreadCount`). Missed-call and calendar alerts are unchanged.

GO-only pieces, for reference: Android identity becomes `(tag = alertKey, id = hash)` with `manager.notify(tag, id)`, and the plugin cancels with `NotificationManager.cancel(tag, id)` directly (a `startService` from the background throws on API 26+); the alert bridge routes `direct` and `group` taps.

---

## Tests and verification

```bash
npm run pretest                       # once, compiles the worker bundles
npx vitest run electron/src/reticulum-chat.test.ts electron/src/reticulum-chat-device-state-db.test.ts \
  src/background/reticulum-signing-policy.test.ts src/utils/notificationStateSync.test.ts src/utils/reticulumChatAlerts.test.ts
```

- `electron/src/reticulum-chat.test.ts`, `describe('reticulum chat device state sync')`, 9 tests: hello fits the MDU with `ds1`; signed-field round trip incl. tombstone and chunked value; `setDeviceState` validation; two managers exchange a small and a 1.5 KB chunked value, ack after verification, LWW (older/equal `signedAt` ignored but still acked), ack persisted across a new manager on the same DB; unverified peers dropped before buffering and buffers isolated per source; `device_state_req`; catch-up once per `ds1` hello plus sync-peer support states; prune with acks; pending row finished after a restart and runtime state cleared on logout.
- `electron/src/reticulum-chat-device-state-db.test.ts`, 10 tests over every DB method (LWW, prefix, expiry, replay vs acks, pending watermark, prune with acks).
- `src/utils/notificationStateSync.test.ts`, 14 tests (keys/hashing, canonical rule round trip, diffs, tombstones only from removals, apply order, seenall max, seen mark-time preservation).
- `src/utils/reticulumChatAlerts.test.ts`, 11 tests.

On GO the build was type-checked against a baseline (no new errors), the Java compiled with gradle, the APK was installed and probed over CDP: engine ready, a signed record round-tripped, the renderer pushed the phone's existing permission grant and mention toggle as the first records. **Not yet verified: delivery between two devices**, because no Hub build with `ds1` exists yet — that is the first thing to test after the port (see below).

Manual test plan once Hub has it: sign in to the same account on Hub and GO; in the Hub notification settings the row should go from "waiting for your other device" to "Linked with 1 of your devices" once the phone's hello arrives; allow notifications for a Q-app on Hub → the app appears under Q-Apps in the phone's settings without being opened there and the phone starts receiving that app's notifications; open a notification on one device → the other device's unseen badge drops; read a DM on Hub → the phone's tray alert for that conversation disappears (this last one already works against 3.0.3).

## Suggested merge order

1. `src/background/reticulum-signing-policy.ts` (+ test) — the whitelist entry.
2. `electron/src/reticulum-chat-db.ts` + `src/test/mocks/betterSqlite3.ts` + `electron/src/reticulum-chat-device-state-db.test.ts`.
3. `electron/src/reticulum-chat.ts` + tests (feature flag, wires, manager).
4. `electron/src/setup.ts`, `electron/src/preload.ts`, `src/types/window.d.ts`.
5. `src/qortal/get.ts`, `src/qortal/qortal-requests.ts`, `src/utils/qChatMentionNotifications.ts`, `src/atoms/global.ts`.
6. `src/utils/notificationStateSync.ts` (+ test), `src/components/App/NotificationStateSync.tsx`, the `Group.tsx` mount, `src/components/GeneralNotifications.tsx`, locale keys.
7. Part A desktop piece: `src/utils/reticulumChatAlerts.ts` (+ test), `src/background/background.ts`, `src/components/Group/WebsocketNotifications.tsx`.
8. `docs/reticulum-multi-device-reference.md` rows and the CHANGELOG entries.

## Known limitations and open points

- `qortalNotificationOsPushDisabled` is a device-wide map with no address dimension; it is published and applied only under the signed-in account, so the same cross-account bleed that exists locally can now reach the other device. Scoping the map by address would fix it on both sides.
- Local preferences carry no timestamps, so on the very first hydrate an engine value written by the other device wins over a device-local pre-sync preference (e.g. the mentions toggle); later changes converge.
- Until a peer's hello is seen its support is unknown and it receives replays it may ignore (a 3.0.3 Hub never acks), so un-acked rows are re-sent at every replay trigger until that hello marks it unsupported. Same behaviour as `read_sync`.
- `notification_sync_status_linked` uses a single `{{count}}` form without plural variants.
- The hello wire has 7 bytes of headroom; the next feature token has to be short, or an existing one shortened.
- Read-sync acks are still in memory only (every reconnect replays all watermarks); persisting them like the device-state acks would cut the boot signing load on phones.
