# Hub developer notes — GO 3.0 upstream merge

This document lists changes in the GO mobile fork that **must be ported into upstream Qortal Hub** (Electron) for voice calls and multi-device ringing to work correctly with GO 3.0 on Android.

Mobile-only changes (Capacitor UI, FileWriter, biometric, etc.) do **not** require Hub merges unless noted.

---

## Repo state reference

**Remote:** https://gitea.qortal.link/simon/GO-3.0 (`go3` / `main`)  
*(Earlier field builds lived at https://gitea.qortal.link/simon/qortal-go-2.0.)*

**Chat GIF picker (v0.0.5, Hub-portable):** see [`HUB_GIF_PICKER.md`](HUB_GIF_PICKER.md).

**Notification sync Hub ⇄ GO (2026-09-29, Hub-portable, needs a Hub release):** see [`HUB_NOTIFICATION_SYNC.md`](HUB_NOTIFICATION_SYNC.md).
Copy `src/components/Chat/gifs/` and wire `ReactionPicker` / send / `MessageItem`.
Do not port the Android keyboard panel.

**Already pushed (before the pending voice/QDN commit):**

| Commit     | Summary |
|------------|---------|
| `0a475a37` | Reticulum presence reliability on Android (announce retry, native tick, Python re-fanout) |
| `d4ca8928` | Biometric unlock, transfer notifications, mobile UI polish |
| `14244429` | Initial Qortal GO mobilization (Android shell, Reticulum file transfer) |

**Pending in the next push (after `0a475a37`):** voice-call fixes, QDN mobile file save, dual-ring Hub fix, node settings fix — see commit message on `simon/main` after you run the push script.

---

## 1. Required — dual-device ringing

### Problem

When the same Qortal account is logged in on **Hub (desktop)** and **Qortal GO (mobile)**, an incoming voice call often rang on **Hub only**. Hub received the overlay `CALL_REQUEST` wire, saw the target address as local, and **stopped relaying** — so the mobile device never saw the call.

### Fix

In `electron/src/call.ts`, method `onReticulumCallWire`:

- **Always** decrement `L` (hops remaining) and relay the wire while hops remain, **even when** `targetIsLocal === true`.
- Loop prevention is unchanged: overlay dedupe id `X` via `hasSeenReticulumOverlayId` / `rememberReticulumOverlayId`.
- Only skip further local processing when the target is not local (existing behaviour after relay).

### File

`electron/src/call.ts` (~lines 788–805 in the GO fork)

### Diff shape (conceptual)

```typescript
// BEFORE: relay only when target is NOT local
if (!targetIsLocal) {
  if (overlayMeta.hopsRemaining > 0) {
    this.broadcastReticulumOverlayWire(forwarded, [peerPresenceHash]);
  }
  ...
}

// AFTER: relay first whenever hops remain; then handle local vs remote
if (overlayMeta.hopsRemaining > 0) {
  this.broadcastReticulumOverlayWire(forwarded, [peerPresenceHash]);
}
if (!targetIsLocal) {
  ...
}
```

### Test

1. Log in as account **A** on Hub **and** on GO (same account, two devices).
2. From account **B**, start a voice call to **A**.
3. **Expected:** incoming call UI on **both** Hub and mobile within a few seconds.
4. Accept on one device → the other should stop ringing (GO implements “answered on another device”; Hub may still show its own accept path).

---

## 2. Required — `presence_bridge.py` (Electron bundle)

The GO fork keeps **`electron/resources/presence_bridge.py`** in sync with **`android/app/src/main/python/presence_bridge.py`**. Upstream Hub’s Python bridge path may differ; port the **same logic** into wherever Hub loads its bridge.

### 2a. Inbound audio dropped — `UnboundLocalError`

**Function:** `_emit_group_audio_packet_json`

**Bug:** `_audio_json_egress_drops` was incremented without a `global` declaration → Python treated it as function-local → **first inbound audio frame raised `UnboundLocalError`** → callee heard nothing.

**Fix:**

```python
global _mobile_audio_packet_emits, _audio_json_egress_drops
```

### 2b. Overlay link misclassified as non-audio

**Problem:** If the **first** packet on an inbound Reticulum link was lost, the bridge’s classify fallback marked the link as **overlay**. Subsequent call-audio packets on that link were **silently dropped** for the rest of the call.

**Fix:**

- Add `_promote_misclassified_overlay_link_to_audio(link, overlay_link_id)`.
- In `on_overlay_link_packet`, if the link is incoming and the payload decodes as group audio wire, promote to audio link and delegate to `on_audio_link_packet`.

### 2c. Outbound audio send failures (`unknown_link_id` / `audio_link_not_ready`)

**Problem:** The JS layer held a **stale `linkId`** while the peer churned links (common mobile↔mobile). The bridge rejected thousands of outbound frames.

**Fix:**

- Add `_find_established_audio_link_locked(peer_key_hint)` — pick the most recently active **established** link matching presence **or** destination hash.
- In `_snapshot_audio_link_for_send`, when the requested link is missing or not established, **fall back** to that helper before returning not-ready / unknown.

### 2d. Unbounded link-establish retry loop

**Problem:** Stale peer destinations from a **previous call** never established; the bridge retried forever (`attempt=16`, `17`, … in logs), starving the scheduler.

**Fix:**

- `_AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS = 10`
- In `_schedule_audio_link_retry`, if `attempts >= max`, set `desired = False` and log `audio_link_retry_gave_up`.
- On `_open_group_audio_link_for_peer` with `retry_reason == "command"`, reset `attempts = 0` (new call / explicit open).
- On `on_outgoing_audio_link_established`, reset `attempts = 0`.

### Test (Hub ↔ mobile voice)

1. Hub calls GO → both sides “in call”, **audio both ways**.
2. GO calls Hub → same.
3. GO ↔ GO (via Hub as relay) → media setup completes (not stuck on “Connecting”).
4. Bridge logs: no `UnboundLocalError` in `_emit_group_audio_packet_json`; no endless `audio_link_opening attempt=16+` after hang-up.

---

## 3. Optional / reference — mobile JS (Capacitor bridge)

These files are **Android / Capacitor** only. Upstream Hub uses `electron/src/group-call.ts` instead. Listed for context if you align behaviour:

| Area | File(s) | What it does |
|------|---------|--------------|
| Overlay relay meta on media wires | `src/bridge/capacitorBridge.ts` | Attach `X` (dedupe) + `L` (hops) to **all** `fanoutGroupCall` messages (GJ/GK/GQ), not just call signaling — required when two mobiles are not direct overlay neighbours |
| Stale peer destination between calls | `src/bridge/capacitorBridge.ts` | DM room id is stable; peer **audio destination rotates** per session — clear stale dest/link on join; adopt authoritative sender dest from inbound frames |
| In-call UI | `src/components/Mobile/MobileVoiceCallBar.tsx`, `src/App.tsx` | Persistent mobile call bar (Hub already has nav call pill) |
| Audio surface races | `src/bridge/mobileAudioSurface.ts`, `src/hooks/useVoiceCall.ts` | Serialize audio-surface commands; retry after “session disposed”; dismiss ring when accept seen on sibling device |
| QDN file save | `src/plugins/FileWriter.ts`, `src/utils/mobileFileSave.ts`, … | Native Documents save — **no Hub change** |
| Node settings display | `src/components/Mobile/MobileNodeConnectionSettings.tsx` | Use `isPublicGatewayNodeUrl` so local Core shows as private — **no Hub change** |

---

## 4. Presence reliability (commit `0a475a37`)

Mostly Android + shared JS:

- `src/hooks/usePresence.ts` — announce retry, heartbeat failure → re-announce
- `src/bridge/capacitorBridge.ts` — await `publish` success
- Native: `QortalForegroundService` presence tick → `QortalBackgroundPlugin`
- Python: periodic re-fanout of last signed presence wire (20s)

**Hub:** Python re-fanout in `electron/resources/presence_bridge.py` should match Android if Hub uses the same bridge bundle. Electron `usePresence` changes apply if Hub shares that hook (it does in this monorepo).

---

## Suggested merge order

1. **`electron/src/call.ts`** — dual-ring relay (Section 1).
2. **`electron/resources/presence_bridge.py`** — Sections 2a–2d (diff from `0a475a37` to HEAD on `simon/main`).
3. Rebuild Hub; run Section 1 and 2 tests.
4. Optionally review `usePresence.ts` / presence_bridge re-fanout from `0a475a37` if mobile still shows “online on Hub but not vice versa” after voice fixes.

---

## Quick diff commands (from a clone of GO fork)

```bash
# Dual-ring only
git show simon/main:electron/src/call.ts  # or
git diff 0a475a37..simon/main -- electron/src/call.ts

# Python bridge voice fixes
git diff 0a475a37..simon/main -- electron/resources/presence_bridge.py
```

---

## Contact / context

These notes correspond to GO 3.0 field testing: mobile↔Hub voice (working after bridge + call.ts fixes), mobile↔mobile (requires overlay meta + stale-dest rotation on GO side), dual-device ringing (requires Section 1 on Hub).

Update this file when new Hub-facing changes land on `simon/main`.
