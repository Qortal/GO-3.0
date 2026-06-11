/**
 * Capacitor bridge layer for the mobilized Qortal Hub.
 *
 * The Hub renderer was built for two environments: the Electron desktop shell
 * (full `window.electronAPI` / `window.coreSetup` / `window.presence` / `window.chat`
 * / `window.call` / `window.groupCall` bridges) and a plain browser ("HUB_WEB"
 * mode) where none of those exist. Every consumer is guarded for the web case
 * (`if (!window.presence) return`, `window.chat?.…`, `!!window.coreSetup`, etc.),
 * so the cleanest mobile base is exactly that web mode: leave the desktop/P2P
 * bridges undefined and the corresponding UI hides itself gracefully.
 *
 * This module therefore does NOT stub `electronAPI`, `coreSetup`, `presence`,
 * `chat`, `call`, `groupCall` or `audioSurface`: doing so would falsely flip
 * those features "on" and surface buttons that cannot work yet. Instead it:
 *   1. Detects the native Capacitor runtime.
 *   2. Adds mobile-shell niceties (hide splash, Android hardware back button).
 *   3. Marks the documented seam where later phases inject the *real*,
 *      Reticulum-backed `window.presence` / `window.chat` / `window.call` /
 *      `window.groupCall` implementations (see installReticulumBridges()).
 */

import { Capacitor } from '@capacitor/core';
import { Reticulum } from '../plugins/Reticulum';
import { compactDmVoiceJoinWireChatId } from '../lib/call/dmVoiceWire';
import { installMobileAudioSurface } from './mobileAudioSurface';
import { verifyQchatFileLinkAuth } from '../utils/qchatFileAuthVerify';
import {
  encodeJoinWire,
  encodeJoinIdentityWire,
  encodeLeaveWire,
  encodeKeyWire,
  encodeKeyRequestWire,
  decodeJoinWire,
  decodeKeyWireSingle,
  decodeKeyRequestWireSingle,
  decodeKeyBody,
  decodeKeyRequestBody,
  parseFragmentMeta,
  parseFragmentPart,
  reassembleBody,
  isGroupCallReticulumWireType,
  uint8ToBase64,
  base64ToUint8,
  type GcKeyDecoded,
  type GcKeyRequestDecoded,
  type FragmentMeta,
} from './groupCallWire';

/** True when running inside the native Capacitor Android/iOS WebView. */
export const isCapacitor = (): boolean => {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

/**
 * Event name dispatched on the Android hardware back press.
 * UI layers (e.g. the mobile tab bar / Group view stack) can listen and call
 * `event.preventDefault()` to consume it; otherwise the app is minimized.
 */
export const ANDROID_BACK_EVENT = 'qortal-android-back';

let installed = false;

export function installCapacitorBridge(): void {
  if (installed) return;
  installed = true;

  if (!isCapacitor()) {
    // Plain web / Electron: nothing to do here. Web-mode degradation and the
    // Electron preload bridges both work without this shim.
    return;
  }

  // Hide the native splash immediately. The launch window is just a solid dark
  // color (no logo), and the in-app HTML splash already covers the WebView, so
  // there's nothing to wait for and no old-logo flash to bridge.
  void import('@capacitor/splash-screen')
    .then(({ SplashScreen }) => {
      SplashScreen.hide().catch(() => {});
    })
    .catch(() => {});

  // Android hardware back button: let the UI handle it; default to minimizing
  // the app (never silently exit on a single back press).
  void import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('backButton', () => {
        const ev = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
        const notPrevented = window.dispatchEvent(ev);
        if (notPrevented) {
          App.minimizeApp().catch(() => {
            // minimizeApp is Android-only; ignore elsewhere.
          });
        }
      });
    })
    .catch(() => {});
}

let reticulumBridgesInstalled = false;

/**
 * Master switch for the native (Chaquopy) presence bridge. When false,
 * `window.presence` is never installed and the embedded Python/RNS transport is
 * never touched (the app behaves like the plain web build).
 */
const PRESENCE_BRIDGE_ENABLED = true;

/** Online entries expire if not refreshed within this window (heartbeats ~25 s). */
const PRESENCE_TTL_MS = 90_000;
/** Cap on fan-out neighbours we advertise to the bridge (matches OVERLAY_MAX). */
const MAX_NEIGHBORS = 24;
/** 16-byte Reticulum destination hash, hex. */
const DEST_HASH_RE = /^[0-9a-f]{32}$/;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const asUserStatus = (v: unknown): UserStatus | null =>
  v === 'online' || v === 'busy' || v === 'idle' ? v : null;

/**
 * Reticulum overlay health snapshot for the mobile shell.
 *
 * The desktop renderer reads `window.electronAPI.reticulumGetStatus()` to drive
 * the core P2P-health indicator (which also gates the voice-call button). On
 * mobile `window.electronAPI` is intentionally absent (defining it would flip
 * the app into HUB_ELECTRON mode), so we publish the same shape here and let
 * CoreSyncStatus consume it via getMobileReticulumStatus()/onMobileReticulumStatus().
 */
export type MobileReticulumStatus = {
  onlineRemoteHubInterfaces: number;
  p2pActiveOverlayPeers: number;
  bridgeState: 'starting' | 'ready';
};

let mobileReticulumStatus: MobileReticulumStatus | null = null;
const mobileReticulumStatusCbs = new Set<(s: MobileReticulumStatus) => void>();

export const getMobileReticulumStatus = (): MobileReticulumStatus | null =>
  mobileReticulumStatus;

export const onMobileReticulumStatus = (
  cb: (s: MobileReticulumStatus) => void
): (() => void) => {
  mobileReticulumStatusCbs.add(cb);
  if (mobileReticulumStatus) {
    try {
      cb(mobileReticulumStatus);
    } catch {
      /* ignore */
    }
  }
  return () => mobileReticulumStatusCbs.delete(cb);
};

const publishMobileReticulumStatus = (next: MobileReticulumStatus): void => {
  const prev = mobileReticulumStatus;
  if (
    prev &&
    prev.onlineRemoteHubInterfaces === next.onlineRemoteHubInterfaces &&
    prev.p2pActiveOverlayPeers === next.p2pActiveOverlayPeers &&
    prev.bridgeState === next.bridgeState
  ) {
    return;
  }
  mobileReticulumStatus = next;
  mobileReticulumStatusCbs.forEach((cb) => {
    try {
      cb(next);
    } catch {
      /* ignore */
    }
  });
};

/**
 * Local Reticulum identity exposed to the DM voice media helpers.
 *
 * The desktop reads `window.electronAPI.reticulumGet{LocalDestinationHash,
 * LocalIdentityPublicKeyBase64}`. Mobile keeps `electronAPI` undefined (defining
 * it flips HUB_ELECTRON), so we stash the bridge-reported values on a global the
 * patched `directVoiceReticulumMedia` fetchers fall back to.
 */
type MobileReticulumInfo = {
  destinationHash: string | null;
  identityPublicKeyBase64: string | null;
};

declare global {
  interface Window {
    __qortalMobileReticulum?: MobileReticulumInfo;
  }
}

const getMobileReticulumInfo = (): MobileReticulumInfo => {
  if (!window.__qortalMobileReticulum) {
    window.__qortalMobileReticulum = {
      destinationHash: null,
      identityPublicKeyBase64: null,
    };
  }
  return window.__qortalMobileReticulum;
};

/**
 * Polls the bridge-reported local Reticulum identity (set on the `ready`
 * frame). Mirrors the desktop preload's reticulumGetLocal* retry semantics so
 * the Q-Chat file transfer accept flow works the same on mobile.
 */
export const fetchMobileReticulumIdentity = async (): Promise<{
  destinationHash: string | null;
  identityPublicKeyBase64: string | null;
}> => {
  const maxAttempts = 35;
  const delayMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const info = getMobileReticulumInfo();
    if (info.destinationHash && info.identityPublicKeyBase64) {
      return { ...info };
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { ...getMobileReticulumInfo() };
};

// ── Bridge command/response correlation ─────────────────────────────────────
// presence_bridge.py answers every cmd with a `{type:"resp", id, ok, ...}`
// frame. The desktop daemon correlates these in its stdio pump; on mobile the
// frames arrive through the same `presence` listener as events, so we keep a
// pending-promise map keyed by the command id we pass to the native plugin.

let ensureBridgeStartedRef: (() => Promise<void>) | null = null;

const pendingCommandResps = new Map<
  string,
  (frame: Record<string, unknown>) => void
>();

const resolveCommandResp = (frame: Record<string, unknown>): void => {
  const id = typeof frame.id === 'string' ? frame.id : undefined;
  if (!id) return;
  const resolve = pendingCommandResps.get(id);
  if (resolve) resolve(frame);
};

/**
 * Sends a presence-bridge command and resolves with the bridge's resp frame
 * (`{ok: boolean, error?, reason?, ...}`). Used by flows that need the result
 * (Q-Chat file transfer), unlike the fire-and-forget presence/call paths.
 */
export const presenceCommandWithResult = async (
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> => {
  if (!ensureBridgeStartedRef) {
    throw new Error('Reticulum bridge is not installed');
  }
  await ensureBridgeStartedRef();
  const id = `cmd-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingCommandResps.delete(id);
      reject(new Error(`Reticulum command timed out: ${action}`));
    }, timeoutMs);
    pendingCommandResps.set(id, (frame) => {
      window.clearTimeout(timer);
      pendingCommandResps.delete(id);
      resolve(frame);
    });
  });
  try {
    await Reticulum.presenceCommand({ action, payload, id });
  } catch (err) {
    const resolve = pendingCommandResps.get(id);
    if (resolve) pendingCommandResps.delete(id);
    throw err;
  }
  return result;
};

// ── Q-Chat Reticulum file transfer (mobile) ─────────────────────────────────
// Mobile port of the desktop main-process logic in reticulum-daemon.ts:
//   • sender: register pending sends with the bridge, persist them across app
//     restarts, and answer inbound QCHAT_FILE_LINK_AUTH packets (verify the
//     downloader's signed auth, then authorize/reject the RNS link).
//   • receiver: forward accept commands and export completed files to the
//     public Downloads collection so the user can actually reach them.
// All transfer bytes move inside the Python bridge as RNS Resources; this
// layer only drives the control protocol.

type QchatPendingSendRecord = {
  transferId: string;
  senderAddress: string;
  allowedRecipientAddress: string;
  filePath: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
};

const QCHAT_PENDING_SENDS_STORAGE_KEY = 'qortal-mobile-qchat-pending-sends';
const QCHAT_FILE_OFFER_TTL_MS = 2 * 60 * 60 * 1000;
const QCHAT_COMPLETED_GRACE_MS = 10 * 60 * 1000;

const qchatPendingSends = new Map<string, QchatPendingSendRecord>();
const qchatCompletedSends = new Map<string, number>();
const qchatFileEventCbs = new Set<(payload: Record<string, unknown>) => void>();
let qchatPendingSendsLoaded = false;
let qchatPendingSendsHydrated = false;

const loadQchatPendingSends = (): void => {
  if (qchatPendingSendsLoaded) return;
  qchatPendingSendsLoaded = true;
  try {
    const raw = localStorage.getItem(QCHAT_PENDING_SENDS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const item of parsed) {
      const rec = asObject(item);
      if (!rec) continue;
      const transferId = asString(rec.transferId);
      const expiresAt = Number(rec.expiresAt || 0);
      if (!transferId || expiresAt <= now) continue;
      qchatPendingSends.set(transferId, {
        transferId,
        senderAddress: asString(rec.senderAddress) ?? '',
        allowedRecipientAddress: asString(rec.allowedRecipientAddress) ?? '',
        filePath: asString(rec.filePath) ?? '',
        fileName: asString(rec.fileName) ?? '',
        size: Number(rec.size || 0),
        sha256: asString(rec.sha256) ?? '',
        createdAt: Number(rec.createdAt || now),
        expiresAt,
      });
    }
  } catch {
    /* corrupted store; start fresh */
  }
};

const persistQchatPendingSends = (): void => {
  const now = Date.now();
  for (const [transferId, rec] of [...qchatPendingSends]) {
    if (rec.expiresAt <= now) qchatPendingSends.delete(transferId);
  }
  try {
    localStorage.setItem(
      QCHAT_PENDING_SENDS_STORAGE_KEY,
      JSON.stringify([...qchatPendingSends.values()])
    );
  } catch {
    /* storage full; pending sends survive only in memory */
  }
};

const markQchatSendCompleted = (transferId: string): void => {
  const now = Date.now();
  for (const [id, exp] of [...qchatCompletedSends]) {
    if (exp <= now) qchatCompletedSends.delete(id);
  }
  qchatCompletedSends.set(transferId, now + QCHAT_COMPLETED_GRACE_MS);
  if (qchatPendingSends.delete(transferId)) persistQchatPendingSends();
};

const emitQchatFileEvent = (payload: Record<string, unknown>): void => {
  qchatFileEventCbs.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      /* ignore */
    }
  });
};

/** Subscribe to Q-Chat file transfer events (mobile onQchatFileTransferEvent). */
export const onMobileQchatFileTransferEvent = (
  cb: (payload: Record<string, unknown>) => void
): (() => void) => {
  qchatFileEventCbs.add(cb);
  return () => {
    qchatFileEventCbs.delete(cb);
  };
};

/**
 * Look up an outgoing (sender-side) pending share by transferId. Used by the
 * transfer notification layer to detect direction and show time remaining.
 */
export const getQchatPendingSendInfo = (
  transferId: string
): { fileName: string; size: number; expiresAt: number } | null => {
  loadQchatPendingSends();
  const rec = qchatPendingSends.get(transferId);
  if (!rec) return null;
  return { fileName: rec.fileName, size: rec.size, expiresAt: rec.expiresAt };
};

const rejectQchatFileAuth = (
  linkId: string,
  transferId: string,
  reason: string
): void => {
  console.error('[QchatFile] auth rejected:', reason, transferId);
  emitQchatFileEvent({ status: 'failed', transferId, reason });
  void presenceCommandWithResult('reject_qchat_file_resource', {
    linkId,
    transferId,
    reason,
  }).catch((err) => console.error('[QchatFile] reject failed:', err));
};

const handleQchatFileAuth = async (
  payload: Record<string, unknown>
): Promise<void> => {
  const transferId = String(payload.transferId || '').trim();
  const linkId = String(payload.linkId || '');
  const auth = asObject(payload.auth);
  if (!transferId || !linkId || !auth) return;
  loadQchatPendingSends();
  const pending = qchatPendingSends.get(transferId);
  if (!pending) {
    if (qchatCompletedSends.has(transferId)) {
      console.log('[QchatFile] duplicate auth for completed transfer', transferId);
      return;
    }
    rejectQchatFileAuth(linkId, transferId, 'no_pending_transfer');
    return;
  }
  if (pending.expiresAt <= Date.now()) {
    qchatPendingSends.delete(transferId);
    persistQchatPendingSends();
    rejectQchatFileAuth(linkId, transferId, 'transfer_expired');
    return;
  }
  try {
    const stat = await Reticulum.qchatFileStat({ path: pending.filePath });
    if (!stat.exists) {
      qchatPendingSends.delete(transferId);
      persistQchatPendingSends();
      rejectQchatFileAuth(linkId, transferId, 'file_missing');
      return;
    }
  } catch {
    /* stat unavailable; let the bridge surface a send failure if needed */
  }
  const failure = verifyQchatFileLinkAuth(auth, pending);
  if (failure) {
    rejectQchatFileAuth(linkId, transferId, failure);
    return;
  }
  try {
    const res = await presenceCommandWithResult(
      'authorize_qchat_file_resource',
      { linkId, transferId }
    );
    if (res.ok !== true) {
      console.error(
        '[QchatFile] authorize failed:',
        res.error || res.reason || 'unknown'
      );
    }
  } catch (err) {
    console.error('[QchatFile] authorize failed:', err);
  }
};

const handleQchatFileTransferEvent = (
  payload: Record<string, unknown>
): void => {
  const status = asString(payload.status);
  if (status === 'auth') {
    void handleQchatFileAuth(payload);
    // The auth handshake is internal; the renderer only sees the outcome.
    return;
  }
  if (status === 'sent') {
    const transferId = asString(payload.transferId);
    if (transferId) markQchatSendCompleted(transferId);
  }
  if (status === 'received') {
    const savePath = asString(payload.path);
    const fileName = asString(payload.fileName) ?? undefined;
    if (savePath) {
      // Export to public Downloads first so the emitted event carries the
      // openable content:// URI (used by the chat's "Open" button).
      void Reticulum.qchatFileExportToDownloads({ path: savePath, fileName })
        .then((res) => {
          console.log('[QchatFile] exported to Downloads:', res.uri);
          emitQchatFileEvent({
            ...payload,
            ...(res.uri ? { downloadsUri: res.uri } : {}),
          });
        })
        .catch((err) => {
          console.error('[QchatFile] export to Downloads failed:', err);
          emitQchatFileEvent(payload);
        });
      return;
    }
  }
  emitQchatFileEvent(payload);
};

/** Mobile implementation of the chat's "Open" action for received files. */
export const mobileQchatFileOpen = async (payload: {
  uri: string;
  fileName?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  try {
    await Reticulum.qchatFileOpen(payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Re-register persisted pending sends with the (re)started bridge. */
const hydrateQchatPendingSends = (): void => {
  if (qchatPendingSendsHydrated) return;
  qchatPendingSendsHydrated = true;
  loadQchatPendingSends();
  const now = Date.now();
  for (const record of [...qchatPendingSends.values()]) {
    if (record.expiresAt <= now) {
      qchatPendingSends.delete(record.transferId);
      continue;
    }
    void (async () => {
      try {
        const stat = await Reticulum.qchatFileStat({ path: record.filePath });
        if (!stat.exists) {
          qchatPendingSends.delete(record.transferId);
          persistQchatPendingSends();
          return;
        }
        const res = await presenceCommandWithResult(
          'send_qchat_file_resource',
          {
            allowedRecipientAddress: record.allowedRecipientAddress,
            transferId: record.transferId,
            filePath: record.filePath,
            fileName: record.fileName,
            size: record.size,
            sha256: record.sha256,
            expiresAt: record.expiresAt,
          }
        );
        if (res.ok !== true) {
          console.error(
            '[QchatFile] pending send hydration failed:',
            record.transferId,
            res.error || res.reason
          );
        }
      } catch (err) {
        console.error('[QchatFile] pending send hydration failed:', err);
      }
    })();
  }
  persistQchatPendingSends();
};

/** Mobile implementation of electronAPI.qchatFileSend. */
export const mobileQchatFileSend = async (payload: {
  transferId: string;
  senderAddress?: string;
  allowedRecipientAddress?: string;
  recipientAddress?: string;
  filePath: string;
  fileName: string;
  size: number;
  sha256?: string;
  expiresAt?: number;
}): Promise<{ ok: boolean; error?: string }> => {
  try {
    const allowedRecipientAddress = String(
      payload.allowedRecipientAddress || payload.recipientAddress || ''
    ).trim();
    const senderAddress = String(payload.senderAddress || '').trim();
    const transferId = String(payload.transferId || '').trim();
    if (!allowedRecipientAddress) {
      return { ok: false, error: 'Missing allowed recipient address' };
    }
    if (!senderAddress) return { ok: false, error: 'Missing sender address' };
    if (!transferId) return { ok: false, error: 'Missing transfer id' };
    const createdAt = Date.now();
    const requestedExpiresAt = Number(payload.expiresAt || 0);
    const expiresAt =
      Number.isFinite(requestedExpiresAt) && requestedExpiresAt > createdAt
        ? requestedExpiresAt
        : createdAt + QCHAT_FILE_OFFER_TTL_MS;
    const sha256 =
      typeof payload.sha256 === 'string'
        ? payload.sha256.trim().toLowerCase()
        : '';
    const res = await presenceCommandWithResult('send_qchat_file_resource', {
      allowedRecipientAddress,
      transferId,
      filePath: payload.filePath,
      fileName: payload.fileName,
      size: Number(payload.size || 0),
      sha256,
      expiresAt,
    });
    if (res.ok !== true) {
      return {
        ok: false,
        error: String(res.error || res.reason || 'Reticulum send failed'),
      };
    }
    loadQchatPendingSends();
    qchatPendingSends.set(transferId, {
      transferId,
      senderAddress,
      allowedRecipientAddress,
      filePath: payload.filePath,
      fileName: payload.fileName,
      size: Number(payload.size || 0),
      sha256,
      createdAt,
      expiresAt,
    });
    persistQchatPendingSends();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Mobile implementation of electronAPI.qchatFileAccept. */
export const mobileQchatFileAccept = async (payload: {
  transferId: string;
  senderAddress?: string;
  recipientAddress?: string;
  authMessage?: Record<string, unknown>;
  savePath?: string;
  fileName: string;
  size: number;
  sha256?: string;
  senderReticulumDestinationHash?: string;
  senderReticulumIdentityPublicKeyBase64?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  try {
    const peerPresenceHash = String(
      payload.senderReticulumDestinationHash || ''
    )
      .trim()
      .toLowerCase();
    const reticulumIdentityPublicKeyBase64 = String(
      payload.senderReticulumIdentityPublicKeyBase64 || ''
    ).trim();
    if (!peerPresenceHash || !DEST_HASH_RE.test(peerPresenceHash)) {
      return {
        ok: false,
        error: 'Missing or invalid sender Reticulum destination hash in offer',
      };
    }
    if (!reticulumIdentityPublicKeyBase64) {
      return { ok: false, error: 'Missing sender Reticulum public key in offer' };
    }
    if (!payload.authMessage || typeof payload.authMessage !== 'object') {
      return { ok: false, error: 'Missing Reticulum link auth message' };
    }
    const res = await presenceCommandWithResult(
      'accept_qchat_file_resource',
      {
        peerPresenceHash,
        reticulumIdentityPublicKeyBase64,
        authMessage: payload.authMessage,
        transferId: String(payload.transferId || ''),
        savePath: String(payload.savePath || ''),
        fileName: String(payload.fileName || ''),
        size: Number(payload.size || 0),
        ...(typeof payload.sha256 === 'string'
          ? { sha256: payload.sha256 }
          : {}),
      },
      30_000
    );
    if (res.ok === true) return { ok: true };
    return {
      ok: false,
      error: String(
        res.error || res.reason || 'Reticulum transfer accept failed'
      ),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const setLocalReticulumDestinationHash = (hash: string): void => {
  getMobileReticulumInfo().destinationHash = hash;
};

const setLocalReticulumIdentity = (b64: string): void => {
  getMobileReticulumInfo().identityPublicKeyBase64 = b64;
};

/**
 * Phase 3a — presence over the native Reticulum transport.
 *
 * Wires `window.presence` to the native Chaquopy presence bridge
 * (presence_bridge.py via ReticulumPlugin) AND runs a minimal port of the
 * desktop presence overlay coordinator (electron/src/presence.ts).
 *
 * Outbound: the web layer builds + signs each PresenceEnvelope (usePresence +
 * signPresenceMessage); we forward announce/heartbeat/offline to the bridge.
 * Crucially, the bridge only fans presence out to neighbours it has been told
 * about, so we feed it the peers it discovers (`candidate_peer_discovered`,
 * inbound `presence_message`) back via `overlay_sync_state` + the
 * `overlayNeighborHashes` on each publish. Without that, fan-out is empty and
 * peers never see this account online.
 *
 * Inbound: the bridge emits a `presence_message` event for every signed
 * presence packet it receives. We aggregate those into a live session map so
 * getAllOnline()/getStatus()/onUpdate(Batch) surface who's online.
 *
 * MVP scope: we trust peers the bridge discovers rather than re-verifying each
 * Ed25519 signature in JS (the bridge already drops malformed packets; presence
 * is broadcast online-status). Full per-peer verification is a follow-up.
 *
 * window.chat / window.call / window.groupCall remain undefined (Phases 3b/3c).
 */
export function installReticulumBridges(): void {
  if (!PRESENCE_BRIDGE_ENABLED) return;
  if (reticulumBridgesInstalled) return;
  if (!isCapacitor()) return;
  reticulumBridgesInstalled = true;

  const startedCallbacks = new Set<() => void>();
  let bridgeReady = false;
  let bridgeStartPromise: Promise<void> | null = null;
  let frameListenerAttached = false;

  // ── Overlay coordinator state (minimal mobile port of presence.ts) ──────
  const neighborHashes = new Set<string>();
  const onlineByAddress = new Map<string, PresenceSession>();
  type UpdatePayload = {
    address: string;
    online: boolean;
    status: UserStatus | null;
  };
  const updateCbs = new Set<(p: UpdatePayload) => void>();
  const batchCbs = new Set<(ps: UpdatePayload[]) => void>();
  const clearedCbs = new Set<() => void>();

  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInFlight = false;
  let syncQueuedAgain = false;

  const neighborList = (): string[] => [...neighborHashes].slice(0, MAX_NEIGHBORS);

  // Mirror the desktop reticulumGetStatus snapshot for CoreSyncStatus/p2pHealth.
  let onlineRemoteHubInterfaces = 0;
  const refreshMobileStatus = (): void => {
    publishMobileReticulumStatus({
      onlineRemoteHubInterfaces,
      p2pActiveOverlayPeers: neighborHashes.size,
      bridgeState: bridgeReady ? 'ready' : 'starting',
    });
  };

  // Tell the bridge which discovered peers to fan presence out to. Debounced,
  // single-flight, and re-run if state changed while a sync was in flight.
  const pushOverlaySync = async (): Promise<void> => {
    if (!bridgeReady) return;
    if (syncInFlight) {
      syncQueuedAgain = true;
      return;
    }
    syncInFlight = true;
    try {
      await Reticulum.presenceCommand({
        action: 'overlay_sync_state',
        payload: { verifiedPeers: [], activeNeighborHashes: neighborList() },
      });
    } catch (err) {
      console.error('[Presence] overlay_sync_state failed:', err);
    } finally {
      syncInFlight = false;
      if (syncQueuedAgain) {
        syncQueuedAgain = false;
        scheduleSync();
      }
    }
  };

  const scheduleSync = (): void => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void pushOverlaySync();
    }, 400);
  };

  const addNeighbor = (raw: unknown): void => {
    const hash = asString(raw)?.trim().toLowerCase();
    if (!hash || !DEST_HASH_RE.test(hash)) return;
    if (neighborHashes.has(hash)) return;
    if (neighborHashes.size >= MAX_NEIGHBORS) return;
    neighborHashes.add(hash);
    refreshMobileStatus();
    scheduleSync();
  };

  const liveSessions = (): PresenceSession[] => {
    const now = Date.now();
    const out: PresenceSession[] = [];
    for (const [addr, session] of [...onlineByAddress]) {
      if (now - session.lastSeen > PRESENCE_TTL_MS) {
        onlineByAddress.delete(addr);
        continue;
      }
      out.push(session);
    }
    return out;
  };

  const emitUpdate = (
    address: string,
    online: boolean,
    status: UserStatus | null
  ): void => {
    const payload: UpdatePayload = { address, online, status };
    updateCbs.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* ignore */
      }
    });
    batchCbs.forEach((cb) => {
      try {
        cb([payload]);
      } catch {
        /* ignore */
      }
    });
  };

  // Inbound signed presence packet relayed by the bridge → update session map.
  const handlePresenceMessage = (payload: Record<string, unknown>): void => {
    const route = asObject(payload.route);
    if (route) {
      addNeighbor(route.destinationHash);
      addNeighbor(route.viaDestinationHash);
    }
    const env = asObject(payload.envelope);
    if (!env) return;
    const envPayload = asObject(env.payload) ?? {};
    const address =
      asString(envPayload.address) ?? asString(env.senderAddress) ?? '';
    if (!address) return;
    const type = asString(env.type);

    if (type === 'PRESENCE_OFFLINE') {
      onlineByAddress.delete(address);
      emitUpdate(address, false, null);
      return;
    }

    const status = asUserStatus(envPayload.status) ?? 'online';
    const now = Date.now();
    const existing = onlineByAddress.get(address);
    onlineByAddress.set(address, {
      address,
      publicKey: asString(envPayload.publicKey) ?? existing?.publicKey ?? '',
      sessionId: asString(envPayload.sessionId) ?? existing?.sessionId ?? '',
      lastSeen: now,
      firstSeen: existing?.firstSeen ?? now,
      originNodeId: 'reticulum',
      viaPeerId: asString(route?.destinationHash) ?? existing?.viaPeerId ?? '',
      clientVersion:
        asString(envPayload.clientVersion) ?? existing?.clientVersion,
      status,
      signatureValid: true,
    });
    emitUpdate(address, true, status);
  };

  // ── 1:1 call signaling (port of electron/src/call.ts) ──────────────────
  // Signaling only: CALL_REQUEST/ACCEPT/REJECT/HANGUP over the same Reticulum
  // overlay used by presence. The renderer (useVoiceCall) signs every envelope
  // via window.sendMessage('signPresenceMessage') BEFORE calling window.call.*,
  // so this layer just encodes the compact wire, floods it to overlay neighbours
  // (fanout_call, the bridge forwards by overlay target address U), and maps
  // inbound `call_message` frames to the renderer's call:* events.
  //
  // MVP scope: like presence, we trust the bridge-relayed signaling rather than
  // re-verifying Ed25519 in JS (full per-message verification is a follow-up).
  const CALL_MAX_HOPS = 4;
  const CALL_TTL_MS = 60_000;
  const CALL_OVERLAY_SEEN_TTL_MS = 60_000;
  const CALL_ACCEPT_REPEAT_ATTEMPTS = 5;
  const CALL_ACCEPT_REPEAT_MS = 350;
  const CALL_WIRE = {
    REQUEST: 'CR',
    ACCEPT: 'CA',
    REJECT: 'CX',
    HANGUP: 'CH',
  } as const;

  type CallDirection = 'outbound' | 'inbound';
  type CallEnvelope =
    | {
        type: 'CALL_REQUEST';
        callId: string;
        fromAddress: string;
        fromPublicKey: string;
        chatId: string;
        signature: string;
        timestamp: number;
      }
    | {
        type: 'CALL_ACCEPT' | 'CALL_HANGUP';
        callId: string;
        fromPublicKey: string;
        signature: string;
        timestamp: number;
      }
    | {
        type: 'CALL_REJECT';
        callId: string;
        reason?: string;
        fromPublicKey: string;
        signature: string;
        timestamp: number;
      };
  type CallRecord = {
    callId: string;
    localAddress: string;
    remoteAddress: string;
    chatId: string;
    direction: CallDirection;
    state: 'pending' | 'active' | 'ended';
    cleanupTimer?: ReturnType<typeof setTimeout>;
    repeatTimers?: Set<ReturnType<typeof setTimeout>>;
  };

  const callLocalAddresses = new Set<string>();
  const activeCalls = new Map<string, CallRecord>();
  const callEventCbs = new Set<(event: string, payload: unknown) => void>();
  const seenCallOverlayIds = new Map<string, number>();
  let pendingIncoming: Array<{
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>;
    senderHash: string;
    receivedAt: number;
  }> = [];

  const buildDirectCallChatId = (a: string, b: string): string =>
    `direct:${[a, b].sort().join(':')}`;

  const emitCall = (event: string, payload: unknown): void => {
    console.log('[Call] emit', event, payload, `(subs=${callEventCbs.size})`);
    callEventCbs.forEach((cb) => {
      try {
        cb(event, payload);
      } catch {
        /* ignore */
      }
    });
  };

  const clearCallTimers = (call: CallRecord): void => {
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.repeatTimers?.forEach((t) => clearTimeout(t));
    call.repeatTimers?.clear();
  };

  const encodeCallWire = (env: CallEnvelope): Record<string, unknown> => {
    switch (env.type) {
      case 'CALL_REQUEST': {
        const wire: Record<string, unknown> = {
          t: CALL_WIRE.REQUEST,
          c: env.callId,
          a: env.fromAddress,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
        // direct: chatId is derivable from sender + overlay target → omit (MDU).
        if (!env.chatId.startsWith('direct:')) wire.H = env.chatId;
        return wire;
      }
      case 'CALL_ACCEPT':
        return {
          t: CALL_WIRE.ACCEPT,
          c: env.callId,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      case 'CALL_REJECT':
        return {
          t: CALL_WIRE.REJECT,
          c: env.callId,
          ...(env.reason ? { e: env.reason } : {}),
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      case 'CALL_HANGUP':
        return {
          t: CALL_WIRE.HANGUP,
          c: env.callId,
          k: env.fromPublicKey,
          g: env.signature,
          m: env.timestamp,
        };
      default:
        return {};
    }
  };

  const decodeCallWire = (
    wire: Record<string, unknown>
  ): CallEnvelope | null => {
    const num = (v: unknown): v is number => typeof v === 'number';
    const str = (v: unknown): v is string => typeof v === 'string';
    switch (wire.t) {
      case CALL_WIRE.REQUEST: {
        if (!str(wire.c) || !str(wire.a) || !str(wire.k) || !str(wire.g) || !num(wire.m))
          return null;
        const chatId = str(wire.H)
          ? wire.H
          : str(wire.U) && wire.U.length > 0
            ? buildDirectCallChatId(wire.a, wire.U)
            : null;
        if (!chatId) return null;
        return {
          type: 'CALL_REQUEST',
          callId: wire.c,
          fromAddress: wire.a,
          fromPublicKey: wire.k,
          chatId,
          signature: wire.g,
          timestamp: wire.m,
        };
      }
      case CALL_WIRE.ACCEPT:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_ACCEPT',
          callId: wire.c,
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      case CALL_WIRE.REJECT:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_REJECT',
          callId: wire.c,
          ...(str(wire.e) ? { reason: wire.e } : {}),
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      case CALL_WIRE.HANGUP:
        if (!str(wire.c) || !str(wire.k) || !str(wire.g) || !num(wire.m)) return null;
        return {
          type: 'CALL_HANGUP',
          callId: wire.c,
          fromPublicKey: wire.k,
          signature: wire.g,
          timestamp: wire.m,
        };
      default:
        return null;
    }
  };

  const attachCallOverlayMeta = (
    wire: Record<string, unknown>,
    targetAddress: string,
    hops: number
  ): Record<string, unknown> => ({
    ...wire,
    U: targetAddress,
    L: Math.max(0, Math.trunc(hops)),
    X: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  });

  const seenCallOverlayId = (id: string): boolean => {
    const now = Date.now();
    for (const [k, exp] of [...seenCallOverlayIds]) {
      if (exp <= now) seenCallOverlayIds.delete(k);
    }
    if (seenCallOverlayIds.has(id)) return true;
    seenCallOverlayIds.set(id, now + CALL_OVERLAY_SEEN_TTL_MS);
    return false;
  };

  const fanoutCallWire = async (
    wire: Record<string, unknown>
  ): Promise<void> => {
    await ensureBridgeStarted();
    try {
      const res = await Reticulum.presenceCommand({
        action: 'fanout_call',
        payload: { messages: [wire], overlayNeighborHashes: neighborList() },
      });
      console.log(
        '[Call] fanout_call t=%s U=%s neighbors=%d ->',
        String(wire.t),
        String(wire.U ?? ''),
        neighborList().length,
        res
      );
    } catch (err) {
      console.error('[Call] fanout_call failed:', err);
    }
  };

  const sendCallEnvelope = (targetAddress: string, env: CallEnvelope): void => {
    const wire = attachCallOverlayMeta(
      encodeCallWire(env),
      targetAddress,
      CALL_MAX_HOPS
    );
    void fanoutCallWire(wire);
  };

  // Recipient address resolution for an inbound CALL_REQUEST (direct + support).
  const callRecipientAddresses = (
    chatId: string,
    fromAddress: string
  ): Set<string> | null => {
    if (chatId.startsWith('direct:')) {
      const parts = chatId.slice('direct:'.length).split(':').filter(Boolean);
      if (parts.length !== 2) return null;
      const set = new Set(parts);
      if (!set.has(fromAddress)) return null;
      set.delete(fromAddress);
      return set.size === 1 ? set : null;
    }
    if (chatId.startsWith('support:')) {
      if (chatId === 'support:queue') return null;
      const parts = chatId.slice('support:'.length).split(':').filter(Boolean);
      if (parts.length < 2) return null;
      const set = new Set(parts);
      set.delete(fromAddress);
      return set.size > 0 ? set : null;
    }
    return null;
  };

  const localCallRecipient = (
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>
  ): string | null => {
    const recipients = callRecipientAddresses(env.chatId, env.fromAddress);
    if (!recipients) return null;
    for (const addr of callLocalAddresses) {
      if (recipients.has(addr)) return addr;
    }
    return null;
  };

  const applyIncomingRequest = (
    env: Extract<CallEnvelope, { type: 'CALL_REQUEST' }>
  ): void => {
    if (activeCalls.has(env.callId)) return;
    const localRecipient = localCallRecipient(env);
    if (!localRecipient) return;

    const record: CallRecord = {
      callId: env.callId,
      localAddress: localRecipient,
      remoteAddress: env.fromAddress,
      chatId: env.chatId,
      direction: 'inbound',
      state: 'pending',
    };
    record.cleanupTimer = setTimeout(() => {
      if (activeCalls.get(env.callId)?.state === 'pending') {
        activeCalls.delete(env.callId);
      }
    }, CALL_TTL_MS);
    activeCalls.set(env.callId, record);
    emitCall('call:incoming', {
      callId: env.callId,
      fromAddress: env.fromAddress,
      chatId: env.chatId,
    });
  };

  const flushPendingIncoming = (): void => {
    if (callLocalAddresses.size === 0) return;
    const pending = pendingIncoming;
    pendingIncoming = [];
    const now = Date.now();
    for (const p of pending) {
      if (now - p.receivedAt > CALL_TTL_MS) continue;
      applyIncomingRequest(p.env);
    }
  };

  const handleCallEnvelope = (
    env: CallEnvelope,
    senderHash: string
  ): void => {
    if (env.type === 'CALL_REQUEST') {
      const skew = Date.now() - env.timestamp;
      if (skew > 30_000 || skew < -10_000) return;
      if (callLocalAddresses.size === 0) {
        pendingIncoming = pendingIncoming.filter(
          (p) => p.env.callId !== env.callId
        );
        pendingIncoming.push({ env, senderHash, receivedAt: Date.now() });
        return;
      }
      applyIncomingRequest(env);
      return;
    }
    const call = activeCalls.get(env.callId);
    if (!call) return;
    if (env.type === 'CALL_ACCEPT') {
      if (call.direction !== 'outbound') return;
      clearCallTimers(call);
      call.state = 'active';
      emitCall('call:accepted', { callId: env.callId });
    } else if (env.type === 'CALL_REJECT') {
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(env.callId);
      emitCall('call:rejected', { callId: env.callId, reason: env.reason });
    } else if (env.type === 'CALL_HANGUP') {
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(env.callId);
      emitCall('call:hangup', { callId: env.callId });
    }
  };

  // Inbound call signaling frame from the bridge → decode + dispatch.
  const handleCallMessage = (payload: Record<string, unknown>): void => {
    const wire = asObject(payload.wire);
    if (!wire) return;
    console.log(
      '[Call] rx call_message t=%s U=%s a=%s localAddrs=%d',
      String(wire.t),
      String(wire.U ?? ''),
      String(wire.a ?? ''),
      callLocalAddresses.size
    );
    const senderHash = asString(payload.senderDestinationHash) ?? '';
    // Overlay dedup + leaf targeting: only process wires addressed to us.
    if (typeof wire.X === 'string') {
      if (seenCallOverlayId(wire.X)) return;
      const target = asString(wire.U);
      if (
        target &&
        callLocalAddresses.size > 0 &&
        !callLocalAddresses.has(target)
      ) {
        // Not for us; mobile is a leaf and does not relay others' calls.
        return;
      }
    }
    const env = decodeCallWire(wire);
    if (!env) return;
    handleCallEnvelope(env, senderHash);
  };

  const handleFrame = (frameStr: string): void => {
    let frame: Record<string, unknown> | undefined;
    try {
      frame = asObject(JSON.parse(frameStr));
    } catch {
      return; // partial / non-JSON frame
    }
    if (!frame) return;
    if (frame.type === 'resp') {
      resolveCommandResp(frame);
      return;
    }
    if (frame.type !== 'event') return;
    switch (frame.event) {
      case 'ready': {
        bridgeReady = true;
        const readyPayload = asObject(frame.payload);
        const readyHash = asString(readyPayload?.destinationHash);
        if (readyHash && DEST_HASH_RE.test(readyHash.toLowerCase())) {
          setLocalReticulumDestinationHash(readyHash.toLowerCase());
        }
        const readyIdentity = asString(readyPayload?.identityPublicKeyBase64);
        if (readyIdentity) setLocalReticulumIdentity(readyIdentity);
        startedCallbacks.forEach((cb) => {
          try {
            cb();
          } catch {
            /* ignore */
          }
        });
        refreshMobileStatus();
        void pushOverlaySync();
        hydrateQchatPendingSends();
        break;
      }
      case 'transport_state': {
        const tp = asObject(frame.payload);
        const hubs = tp?.onlineRemoteHubInterfaces;
        if (typeof hubs === 'number') onlineRemoteHubInterfaces = hubs;
        refreshMobileStatus();
        break;
      }
      case 'candidate_peer_discovered':
        addNeighbor(asObject(frame.payload)?.peerHash);
        break;
      case 'presence_message':
        handlePresenceMessage(asObject(frame.payload) ?? {});
        break;
      case 'call_message':
        handleCallMessage(asObject(frame.payload) ?? {});
        break;
      case 'group_call_message':
        void handleGroupCallMessage(asObject(frame.payload) ?? {});
        break;
      case 'qchat_file_transfer':
        handleQchatFileTransferEvent(asObject(frame.payload) ?? {});
        break;
      case 'group_audio_packet':
        handleGroupAudioPacket(asObject(frame.payload) ?? {});
        break;
      case 'group_audio_link_established': {
        const lp = asObject(frame.payload);
        const peer = asString(lp?.peerPresenceHash)?.toLowerCase();
        const linkId = asString(lp?.linkId);
        if (peer && linkId) {
          establishedLinkIdByPeer.set(peer, linkId);
          console.log(
            '[GCall] audio link established peer=%s link=%s',
            peer.slice(0, 8),
            linkId.slice(0, 8)
          );
          // Authenticate every room this peer participates in (the link must be
          // verified before the Hub will deliver GC_KEY over it).
          for (const [rid, byAddr] of gcPeersByRoom) {
            for (const p of byAddr.values()) {
              if (p.destinationHash?.toLowerCase() === peer) {
                void sendLinkAuthForRoom(rid);
                break;
              }
            }
          }
        }
        break;
      }
      case 'group_audio_link_closed': {
        const lp = asObject(frame.payload);
        const peer = asString(lp?.peerPresenceHash)?.toLowerCase();
        if (peer) establishedLinkIdByPeer.delete(peer);
        break;
      }
      case 'group_audio_send_failed': {
        // The bridge drops an outbound audio packet (link not ready / closed /
        // generation changed / overlay congestion). The renderer's tx counter
        // only sees the send *command* succeed, so without this we can't see
        // the real delivery loss. Aggregate by reason and log (throttled) so we
        // can tell "link not ready" drops from genuine RNS packet loss.
        const lp = asObject(frame.payload);
        const reason = asString(lp?.reason) || asString(lp?.code) || 'unknown';
        audioSendFailCounts.set(
          reason,
          (audioSendFailCounts.get(reason) ?? 0) + 1
        );
        audioSendFailTotal += 1;
        const now = Date.now();
        if (now - audioSendFailLastLogAt >= 2500) {
          audioSendFailLastLogAt = now;
          const breakdown = [...audioSendFailCounts.entries()]
            .map(([r, n]) => `${r}=${n}`)
            .join(' ');
          console.log(
            '[GCall] audio send-failed total=%d %s',
            audioSendFailTotal,
            breakdown
          );
        }
        break;
      }
      default:
        break;
    }
  };

  // The native presence bridge boots an embedded CPython interpreter + RNS.
  // Start it LAZILY (first announce, i.e. after login) rather than at app
  // launch, and keep every failure contained so it can never regress the
  // stability of the login / core app.
  const ensureBridgeStarted = (): Promise<void> => {
    if (bridgeStartPromise) return bridgeStartPromise;
    bridgeStartPromise = (async () => {
      if (!frameListenerAttached) {
        frameListenerAttached = true;
        try {
          await Reticulum.addListener('presence', (event) => {
            handleFrame(event.frame);
          });
        } catch (err) {
          console.error('[Presence] addListener failed:', err);
        }
      }
      try {
        await Reticulum.presenceStart();
      } catch (err) {
        console.error('[Presence] presenceStart failed:', err);
        bridgeStartPromise = null; // allow retry on next announce
      }
    })();
    return bridgeStartPromise;
  };
  ensureBridgeStartedRef = ensureBridgeStarted;

  const publish = async (
    envelope: PresenceEnvelope
  ): Promise<{ success: boolean }> => {
    try {
      await ensureBridgeStarted();
      await Reticulum.presenceCommand({
        action: 'publish_presence',
        payload: { envelope, overlayNeighborHashes: neighborList() },
      });
      return { success: true };
    } catch (err) {
      console.error('[Presence] publish failed:', err);
      return { success: false };
    }
  };

  window.presence = {
    announce: publish,
    heartbeat: publish,
    offline: publish,
    getStatus: async (address: string) => {
      const sessions = liveSessions().filter((s) => s.address === address);
      const lastSeen = sessions.reduce((m, s) => Math.max(m, s.lastSeen), 0);
      return {
        online: sessions.length > 0,
        lastSeen: lastSeen || null,
        sessions,
      };
    },
    getOnlineAddresses: async () => [
      ...new Set(liveSessions().map((s) => s.address)),
    ],
    getAllOnline: async () => liveSessions(),
    onUpdate: (cb) => {
      updateCbs.add(cb);
      return () => updateCbs.delete(cb);
    },
    onUpdateBatch: (cb) => {
      batchCbs.add(cb);
      return () => batchCbs.delete(cb);
    },
    onCleared: (cb) => {
      clearedCbs.add(cb);
      return () => clearedCbs.delete(cb);
    },
    onStarted: (cb: () => void) => {
      startedCallbacks.add(cb);
      if (bridgeReady) {
        try {
          cb();
        } catch {
          /* ignore */
        }
      }
      return () => startedCallbacks.delete(cb);
    },
  };

  // ── window.call — 1:1 voice call signaling over Reticulum ──────────────
  window.call = {
    initiate: async (
      targetAddress: string,
      chatId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      callId: string,
      timestamp: number
    ) => {
      try {
        await ensureBridgeStarted();
        const record: CallRecord = {
          callId,
          localAddress,
          remoteAddress: targetAddress,
          chatId,
          direction: 'outbound',
          state: 'pending',
        };
        record.cleanupTimer = setTimeout(() => {
          if (activeCalls.get(callId)?.state === 'pending') {
            activeCalls.delete(callId);
          }
        }, CALL_TTL_MS);
        activeCalls.set(callId, record);
        sendCallEnvelope(targetAddress, {
          type: 'CALL_REQUEST',
          callId,
          fromAddress: localAddress,
          fromPublicKey: publicKey,
          chatId,
          signature,
          timestamp,
        });
        return { success: true, callId };
      } catch (err) {
        console.error('[Call] initiate failed:', err);
        return { success: false, error: String(err) };
      }
    },
    accept: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call || call.direction !== 'inbound') return { success: false };
      if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
      call.state = 'active';
      const env: CallEnvelope = {
        type: 'CALL_ACCEPT',
        callId,
        fromPublicKey: publicKey,
        signature,
        timestamp,
      };
      // Repeat the ACCEPT a few times — the caller may still be settling its
      // overlay route when the first packet floods out.
      call.repeatTimers?.forEach((t) => clearTimeout(t));
      call.repeatTimers = new Set();
      sendCallEnvelope(call.remoteAddress, env);
      for (let i = 1; i < CALL_ACCEPT_REPEAT_ATTEMPTS; i += 1) {
        const timer = setTimeout(() => {
          call.repeatTimers?.delete(timer);
          const latest = activeCalls.get(callId);
          if (latest && latest.state === 'active' && latest.direction === 'inbound') {
            sendCallEnvelope(latest.remoteAddress, env);
          }
        }, CALL_ACCEPT_REPEAT_MS * i);
        call.repeatTimers.add(timer);
      }
      return { success: true };
    },
    reject: async (
      callId: string,
      reason?: string,
      signature?: string,
      publicKey?: string,
      timestamp?: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call) return { success: false };
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(callId);
      sendCallEnvelope(call.remoteAddress, {
        type: 'CALL_REJECT',
        callId,
        reason,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
      });
      return { success: true };
    },
    hangup: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) => {
      const call = activeCalls.get(callId);
      if (!call) return { success: false };
      clearCallTimers(call);
      call.state = 'ended';
      activeCalls.delete(callId);
      sendCallEnvelope(call.remoteAddress, {
        type: 'CALL_HANGUP',
        callId,
        fromPublicKey: publicKey,
        signature,
        timestamp,
      });
      return { success: true };
    },
    setLocalAddresses: async (addresses: string[]) => {
      callLocalAddresses.clear();
      for (const a of addresses) {
        if (typeof a === 'string' && a) callLocalAddresses.add(a);
      }
      console.log('[Call] setLocalAddresses', [...callLocalAddresses]);
      flushPendingIncoming();
      return { success: true };
    },
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      callEventCbs.add(cb);
      // Replay any inbound call still ringing (renderer may subscribe late).
      for (const c of activeCalls.values()) {
        if (c.direction === 'inbound' && c.state === 'pending') {
          try {
            cb('call:incoming', {
              callId: c.callId,
              fromAddress: c.remoteAddress,
              chatId: c.chatId,
            });
          } catch {
            /* ignore */
          }
        }
      }
      return () => callEventCbs.delete(cb);
    },
  };

  // ── window.groupCall — DM (1:1) voice media coordination over Reticulum ──
  // Port of the desktop GroupCallManager, reduced to the 2-party DM path:
  //   • join/leave/key/key-request flood over the SAME overlay used for calls
  //     (fanout_group_call → peer receives group_call_message).
  //   • audio frames go over send_group_audio (FD3 replacement) routed by the
  //     peer's Reticulum destination hash learned from its GJ.
  //   • inbound group_call_message → gcall:* events for useVoiceCall; inbound
  //     group_audio_packet → gcall:audio for window.audioSurface to decrypt.
  // Like presence/call signaling this trusts bridge-relayed frames rather than
  // re-verifying Ed25519 in JS (full verification is a follow-up).
  const GC_OVERLAY_SEEN_TTL_MS = 60_000;
  type GcRoom = {
    chatId: string;
    callSessionId: string;
    mediaSessionGeneration: number;
  };
  type GcPeer = {
    address: string;
    destinationHash: string;
    identityPublicKeyBase64?: string;
  };
  const gcLocalAddresses = new Set<string>();
  const gcRooms = new Map<string, GcRoom>();
  // roomId → (address → peer); for DM there is a single peer.
  const gcPeersByRoom = new Map<string, Map<string, GcPeer>>();
  // roomId → our own signed GC_JOIN wire, replayed over the audio link as the
  // Hub's required link-auth (QGCCTL1) so the Hub marks our link "verified" and
  // stops dropping our audio with `audio-unverified-address`.
  const gcJoinWireByRoom = new Map<string, Record<string, unknown>>();
  // roomId → linkId observed on INBOUND audio-link frames (the Hub's established
  // RNS link to us). RNS links are bidirectional, so replying with our link-auth
  // over this exact linkId reaches the Hub on the link it associates with us —
  // the only way the Hub verifies our link and then delivers GC_KEY over it.
  // (Sends with an empty linkId fall back to the data-plane, which the Hub's
  // link-control decoder never sees.)
  const inboundAudioLinkIdByRoom = new Map<string, string>();
  const gcEventCbs = new Set<(event: string, payload: unknown) => void>();
  const establishedLinkIdByPeer = new Map<string, string>();
  const registeredPeerHashes = new Set<string>();
  // Outbound-audio delivery-failure diagnostics (see group_audio_send_failed).
  const audioSendFailCounts = new Map<string, number>();
  let audioSendFailTotal = 0;
  let audioSendFailLastLogAt = 0;
  const seenGcOverlayIds = new Map<string, number>();
  // Fragment reassembly buffers, keyed by digest `z`.
  type FragBuf = { meta: FragmentMeta; parts: Map<number, string>; expiresAt: number };
  const gkFragments = new Map<string, FragBuf>();
  const gqFragments = new Map<string, FragBuf>();

  const randomUuid = (): string => {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {
      /* fall through */
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
      .toString(36)
      .slice(2)}`;
  };

  const emitGc = (event: string, payload: unknown): void => {
    gcEventCbs.forEach((cb) => {
      try {
        cb(event, payload);
      } catch {
        /* ignore */
      }
    });
  };

  const seenGcOverlayId = (id: string): boolean => {
    const now = Date.now();
    for (const [k, exp] of [...seenGcOverlayIds]) {
      if (exp <= now) seenGcOverlayIds.delete(k);
    }
    if (seenGcOverlayIds.has(id)) return true;
    seenGcOverlayIds.set(id, now + GC_OVERLAY_SEEN_TTL_MS);
    return false;
  };

  const fanoutGroupCall = async (
    messages: Record<string, unknown>[]
  ): Promise<void> => {
    if (messages.length === 0) return;
    await ensureBridgeStarted();
    try {
      const res = await Reticulum.presenceCommand({
        action: 'fanout_group_call',
        payload: { messages, overlayNeighborHashes: neighborList() },
      });
      console.log(
        '[GCall] fanout t=%s neighbors=%d ->',
        String(messages[0]?.t ?? ''),
        neighborList().length,
        res
      );
    } catch (err) {
      console.error('[GCall] fanout_group_call failed:', err);
    }
  };

  // Point-to-point delivery of group-call control frames to one peer over the
  // established overlay link (handle_send_group_call → _send_wire_to_overlay_peer).
  // Single-frame signals (CR/CA/CH, GJ) cross the gossip fanout reliably, but the
  // *fragmented* room key (GK0/GK1) and key-request (GQ0/GQ1) lose fragments on the
  // multi-hop relay path so reassembly never completes and audio never decrypts.
  // The audio data-plane proves a reliable point-to-point route to the peer's
  // Reticulum destination exists, so we deliver every key fragment directly there
  // (in addition to fanout) — making the key cross as reliably as the audio.
  const sendGroupCallDirect = async (
    peerHash: string,
    frames: Record<string, unknown>[]
  ): Promise<boolean> => {
    const key = (peerHash || '').trim().toLowerCase();
    if (!DEST_HASH_RE.test(key) || frames.length === 0) return false;
    await ensureBridgeStarted();
    let allOk = true;
    for (const message of frames) {
      try {
        await Reticulum.presenceCommand({
          action: 'send_group_call',
          payload: { peerPresenceHash: key, message },
        });
      } catch (err) {
        allOk = false;
        console.error('[GCall] send_group_call (direct) failed:', err);
      }
    }
    console.log(
      '[GCall] direct t=%s frames=%d peer=%s ok=%s',
      String(frames[0]?.t ?? ''),
      frames.length,
      key.slice(0, 8),
      allOk
    );
    return allOk;
  };

  // Hub v2.0 gates inbound link audio behind an audio-link auth: the peer must
  // send `QGCCTL1\0` + a signed GC_JOIN *over the audio link* (decodeGcLinkControlWire
  // → handleReticulumLinkAuthJoinWire), otherwise the Hub closes the link with
  // `audio-unverified-address` and drops our audio. The desktop sends this through
  // the same enqueueGroupAudio path, so we replay our cached signed GJ as an opaque
  // audio frame (the bridge wraps QGAU, the peer bridge unwraps → the Hub sees the
  // QGCCTL1 frame). No Python bridge change needed.
  const GC_LINK_CONTROL_MAGIC = new TextEncoder().encode('QGCCTL1\u0000');
  // Per-room bounded resend of the link-auth (handles packet loss / the link
  // establishing without a renderer-visible event).
  const gcLinkAuthTimers = new Map<string, ReturnType<typeof setInterval>>();

  // Resolve the routable peer destination for a room (from any learned peer).
  const peerDestForRoomAny = (roomId: string): string => {
    const byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) return '';
    for (const peer of byAddr.values()) {
      if (peer.destinationHash && DEST_HASH_RE.test(peer.destinationHash)) {
        return peer.destinationHash.toLowerCase();
      }
    }
    return '';
  };

  // Send our cached signed GC_JOIN as a `QGCCTL1\0` link-control frame over the
  // same audio path the media uses. An empty linkId lets the bridge route it
  // over the peer's active audio link (identical to how audio frames flow), so
  // this does not depend on a renderer-visible `group_audio_link_established`.
  // All real audio links that might reach the peer for this room. The peer's
  // AUDIO reticulum destination often differs from its presence hash, and the
  // link can be inbound (Hub→us) or outbound (us→peer-audio-dest), so we collect
  // every established link plus the inbound link seen for the room. In a 1:1 DM
  // these all lead to the same peer, so fanning out is safe and robust.
  const candidateLinkIdsForRoom = (roomId: string): string[] => {
    const linkIds = new Set<string>();
    const peerDest = peerDestForRoomAny(roomId);
    if (peerDest) {
      const direct = establishedLinkIdByPeer.get(peerDest);
      if (direct) linkIds.add(direct);
    }
    for (const id of establishedLinkIdByPeer.values()) linkIds.add(id);
    const inbound = inboundAudioLinkIdByRoom.get(roomId);
    if (inbound) linkIds.add(inbound);
    return [...linkIds];
  };

  // Send group-call control wires (GC_JOIN auth, GC_KEY, GC_KEY_REQUEST) over the
  // established RNS audio link(s) as `QGCCTL1\0`+JSON link-control frames. The Hub
  // delivers AND accepts GC_KEY / GC_KEY_REQUEST *only* over these link-control
  // frames (electron group-call.ts sendKey → sendReticulumLinkControlToAddresses;
  // inbound via decodeGcLinkControlWire) — never over the overlay. So the room
  // key only crosses to the Hub when we ride the verified link here.
  const sendControlFramesOverLinks = async (
    roomId: string,
    frames: Record<string, unknown>[]
  ): Promise<boolean> => {
    if (frames.length === 0) return false;
    const linkIds = candidateLinkIdsForRoom(roomId);
    if (linkIds.length === 0) return false; // no real link yet
    const peerDest = peerDestForRoomAny(roomId);
    if (!peerDest) return false;
    let sentAny = false;
    for (const frame of frames) {
      const body = new TextEncoder().encode(JSON.stringify(frame));
      const buf = new Uint8Array(GC_LINK_CONTROL_MAGIC.length + body.length);
      buf.set(GC_LINK_CONTROL_MAGIC, 0);
      buf.set(body, GC_LINK_CONTROL_MAGIC.length);
      const b64 = uint8ToBase64(buf);
      for (const linkId of linkIds) {
        try {
          await Reticulum.presenceCommand({
            action: 'send_group_audio',
            payload: {
              linkId,
              roomId,
              peerPresenceHash: peerDest,
              peerDestinationHash: peerDest,
              receivedAtWallMs: Date.now(),
              data: b64,
            },
          });
          sentAny = true;
        } catch (err) {
          console.error('[GCall] control-over-link send failed:', err);
        }
      }
    }
    return sentAny;
  };

  const sendLinkAuthForRoom = async (roomId: string): Promise<void> => {
    const gj = gcJoinWireByRoom.get(roomId);
    if (!gj) return;
    const ok = await sendControlFramesOverLinks(roomId, [gj]);
    if (ok) {
      const linkIds = candidateLinkIdsForRoom(roomId);
      console.log(
        '[GCall] link-auth GJ sent room=%s peer=%s links=%d',
        roomId.slice(0, 12),
        peerDestForRoomAny(roomId).slice(0, 8),
        linkIds.length
      );
    }
  };

  // Begin resending link-auth for a room: fast (every 1.5s) so a verified link
  // comes up quickly through packet loss, bounded so we never spam forever. The
  // Hub only delivers GC_KEY over a *verified* link, so without this the room
  // key never crosses and audio never decrypts.
  const startLinkAuthForRoom = (roomId: string): void => {
    if (gcLinkAuthTimers.has(roomId)) return;
    let ticks = 0;
    void sendLinkAuthForRoom(roomId);
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 30 || !gcJoinWireByRoom.has(roomId)) {
        clearInterval(timer);
        gcLinkAuthTimers.delete(roomId);
        return;
      }
      void sendLinkAuthForRoom(roomId);
    }, 1500);
    gcLinkAuthTimers.set(roomId, timer);
  };

  const stopLinkAuthForRoom = (roomId: string): void => {
    const timer = gcLinkAuthTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      gcLinkAuthTimers.delete(roomId);
    }
  };

  const registerPeerIdentity = async (
    peerHash: string,
    identityPublicKeyBase64: string
  ): Promise<void> => {
    const key = peerHash.trim().toLowerCase();
    if (registeredPeerHashes.has(key)) return;
    registeredPeerHashes.add(key);
    try {
      await Reticulum.presenceCommand({
        action: 'register_peer_identity',
        payload: {
          peerPresenceHash: key,
          reticulumIdentityPublicKeyBase64: identityPublicKeyBase64,
        },
      });
    } catch (err) {
      registeredPeerHashes.delete(key);
      console.error('[GCall] register_peer_identity failed:', err);
    }
  };

  const openAudioLinkForPeer = async (peerHash: string): Promise<void> => {
    const key = peerHash.trim().toLowerCase();
    if (!DEST_HASH_RE.test(key)) return;
    // Fire-and-forget: the established linkId arrives via the
    // `group_audio_link_established` event (presenceCommand does not return the
    // bridge's resp payload). Opening warms the RNS path for the packet send too.
    try {
      await Reticulum.presenceCommand({
        action: 'open_group_audio_link',
        payload: { peerPresenceHash: key },
      });
    } catch (err) {
      console.error('[GCall] open_group_audio_link failed:', err);
    }
  };

  const recordPeerFromJoin = (
    roomId: string,
    peer: GcPeer,
    peerPresenceHash: string
  ): void => {
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    byAddr.set(peer.address, peer);
    const hash = (peerPresenceHash || peer.destinationHash).toLowerCase();
    if (peer.identityPublicKeyBase64) {
      void registerPeerIdentity(hash, peer.identityPublicKeyBase64);
    }
    void openAudioLinkForPeer(hash);
  };

  const DM_ROOM_PREFIX = 'dmv:';

  // DM voice peer learning that does NOT depend on the lossy overlay GJ. The
  // overlay broadcast of GJ/GK can be dropped between mobile and Hub, but the
  // direct-RNS audio data-plane reliably arrives. useVoiceCall hands us the peer
  // *address* via requestPeerMediaRecovery at media-start, and we learn the
  // peer's Reticulum *destination* from inbound audio packets. Together they let
  // the media-readiness gate pass and outbound audio resolve (packet-mode send
  // recalls the peer identity from its presence announce) even if no GJ arrives.
  const noteDmPeerAddress = (roomId: string, address: string): void => {
    if (!roomId.startsWith(DM_ROOM_PREFIX) || !address) return;
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    if (byAddr.has(address)) return;
    // Adopt a destination already learned from audio (stashed under its hash).
    let dest = '';
    for (const [k, p] of [...byAddr]) {
      if (!p.address && p.destinationHash) {
        dest = p.destinationHash;
        byAddr.delete(k);
        break;
      }
    }
    byAddr.set(address, { address, destinationHash: dest });
  };

  const noteDmPeerDestination = (roomId: string, destHash: string): void => {
    if (!roomId.startsWith(DM_ROOM_PREFIX)) return;
    const hash = (destHash || '').trim().toLowerCase();
    if (!DEST_HASH_RE.test(hash)) return;
    let byAddr = gcPeersByRoom.get(roomId);
    if (!byAddr) {
      byAddr = new Map();
      gcPeersByRoom.set(roomId, byAddr);
    }
    // DM has a single peer: fill the existing entry's destination, else stash it
    // under the hash until the address is known (requestPeerMediaRecovery).
    let existing: GcPeer | null = null;
    for (const p of byAddr.values()) {
      existing = p;
      break;
    }
    if (existing) {
      if (!existing.destinationHash) existing.destinationHash = hash;
    } else {
      byAddr.set(hash, { address: '', destinationHash: hash });
    }
    void openAudioLinkForPeer(hash);
  };

  const peerDestForRoom = (roomId: string, toAddress: string): string | null => {
    const byAddr = gcPeersByRoom.get(roomId);
    const peer = byAddr?.get(toAddress);
    if (peer?.destinationHash) return peer.destinationHash.toLowerCase();
    // DM fallback: single peer in the room.
    if (byAddr && byAddr.size === 1) {
      const only = [...byAddr.values()][0];
      return only?.destinationHash?.toLowerCase() ?? null;
    }
    return null;
  };

  const emitGcKey = (key: GcKeyDecoded): void => {
    emitGc('gcall:key', {
      roomId: key.roomId,
      recipientAddress: key.toAddress,
      fromAddress: key.fromAddress,
      fromPublicKey: key.fromPublicKey,
      encryptedKey: key.encryptedKey,
      timestamp: key.timestamp,
      keyMessageVersion: key.keyMessageVersion,
      callSessionId: key.callSessionId,
      mediaSessionGeneration: key.mediaSessionGeneration,
      keyCommitment: key.keyCommitment,
      verified: true,
      deliveryKind: 'live',
    });
  };

  const emitGcKeyRequest = (req: GcKeyRequestDecoded): void => {
    emitGc('gcall:key-request', {
      roomId: req.roomId,
      toAddress: req.toAddress,
      fromAddress: req.fromAddress,
      fromPublicKey: req.fromPublicKey,
      callSessionId: req.callSessionId,
      mediaSessionGeneration: req.mediaSessionGeneration,
      keyMessageVersion: req.keyMessageVersion,
      verified: true,
    });
  };

  const ingestFragment = async (
    wire: Record<string, unknown>,
    kind: 'GK' | 'GQ'
  ): Promise<void> => {
    const k0 = kind === 'GK' ? 'GK0' : 'GQ0';
    const k1 = kind === 'GK' ? 'GK1' : 'GQ1';
    const store = kind === 'GK' ? gkFragments : gqFragments;
    const now = Date.now();
    for (const [z, buf] of [...store]) {
      if (buf.expiresAt <= now) store.delete(z);
    }
    const meta = parseFragmentMeta(wire, k0);
    if (meta) {
      const existing = store.get(meta.z);
      store.set(meta.z, {
        meta,
        parts: existing?.parts ?? new Map(),
        expiresAt: now + 15_000,
      });
    } else {
      const part = parseFragmentPart(wire, k1);
      if (!part) return;
      let buf = store.get(part.z);
      if (!buf) {
        buf = { meta: { roomId: part.R, z: part.z, n: part.n, f: 0 }, parts: new Map(), expiresAt: now + 15_000 };
        store.set(part.z, buf);
      }
      buf.parts.set(part.x, part.p);
    }
    const buf = store.get(meta?.z ?? parseFragmentPart(wire, k1)?.z ?? '');
    if (!buf) return;
    console.log(
      '[GCall] %s frag z=%s parts=%d/%d',
      kind,
      buf.meta.z.slice(0, 8),
      buf.parts.size,
      buf.meta.n || 0
    );
    if (buf.meta.f <= 0 || buf.parts.size < buf.meta.n) return;
    const json = await reassembleBody(buf.meta.n, buf.meta.f, buf.meta.z, buf.parts);
    store.delete(buf.meta.z);
    if (!json) {
      console.warn('[GCall] %s reassembly FAILED z=%s', kind, buf.meta.z.slice(0, 8));
      return;
    }
    console.log('[GCall] %s reassembled OK z=%s', kind, buf.meta.z.slice(0, 8));
    if (kind === 'GK') {
      const key = decodeKeyBody(buf.meta.roomId, json);
      if (key && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(key.toAddress))) {
        emitGcKey(key);
      }
    } else {
      const req = decodeKeyRequestBody(buf.meta.roomId, json);
      if (req && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(req.toAddress))) {
        emitGcKeyRequest(req);
      }
    }
  };

  const handleGroupCallMessage = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const wire = asObject(payload.wire);
    if (!wire) return;
    if (typeof wire.X === 'string' && seenGcOverlayId(wire.X)) return;
    const peerPresenceHash = (asString(payload.peerPresenceHash) ?? '').toLowerCase();
    const t = asString(wire.t);
    // Learn the Hub's inbound RNS audio link for this room so we can reply with
    // link-auth over it (see inboundAudioLinkIdByRoom).
    const inLinkId = asString(payload.linkId);
    const inRoom = asString(wire.R);
    if (inLinkId && inRoom) {
      inboundAudioLinkIdByRoom.set(inRoom, inLinkId);
      // When mobile is the CALLER, the Hub's overlay GJ (which carries its audio
      // destination) often never arrives — but its link-control frames (GAC etc.)
      // do, and they carry the Hub's dest in senderDestinationHash. Learn it here
      // so the peer becomes routable and link-auth can ride this link. Without
      // this, peerDest stays empty → sendControlFramesOverLinks bails → no
      // link-auth is ever sent and readiness times out with establishedLinks=0.
      const learnedLinkDest =
        asString(payload.senderDestinationHash) ||
        asString(payload.peerDestinationHash) ||
        peerPresenceHash ||
        '';
      if (learnedLinkDest) noteDmPeerDestination(inRoom, learnedLinkDest);
      // Kick off (idempotent) link-auth over this newly-known link so the Hub
      // verifies us and flips from "connecting" to connected. No-op if we never
      // joined this room (gcJoinWireByRoom empty).
      startLinkAuthForRoom(inRoom);
    }
    if (t && t !== 'GJ' && t !== 'GI') {
      console.log(
        '[GCall] rx wire t=%s src=%s room=%s',
        t,
        inLinkId ? 'audio-link' : 'overlay',
        (asString(wire.R) ?? '').slice(0, 18)
      );
    }
    if (t === 'GJ') {
      const join = decodeJoinWire(wire);
      if (!join) return;
      if (!gcRooms.has(join.roomId)) return; // not a room we're in
      recordPeerFromJoin(
        join.roomId,
        {
          address: join.fromAddress,
          destinationHash: join.reticulumDestinationHash,
          identityPublicKeyBase64: join.reticulumIdentityPublicKeyBase64,
        },
        peerPresenceHash
      );
      emitGc('gcall:participant-joined', {
        roomId: join.roomId,
        chatId: join.chatId,
        address: join.fromAddress,
        publicKey: join.fromPublicKey,
        timestamp: join.timestamp,
        ...(typeof join.joinGeneration === 'number'
          ? { joinGeneration: join.joinGeneration }
          : {}),
      });
      return;
    }
    if (t === 'GI') {
      const d = asString(wire.d)?.toLowerCase();
      const rk = asString(wire.rk);
      if (d && rk) void registerPeerIdentity(peerPresenceHash || d, rk);
      return;
    }
    if (t === 'GK') {
      const key = decodeKeyWireSingle(wire);
      if (key && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(key.toAddress))) {
        emitGcKey(key);
      }
      return;
    }
    if (t === 'GQ') {
      const req = decodeKeyRequestWireSingle(wire);
      if (req && (gcLocalAddresses.size === 0 || gcLocalAddresses.has(req.toAddress))) {
        emitGcKeyRequest(req);
      }
      return;
    }
    if (t === 'GK0' || t === 'GK1') {
      await ingestFragment(wire, 'GK');
      return;
    }
    if (t === 'GQ0' || t === 'GQ1') {
      await ingestFragment(wire, 'GQ');
      return;
    }
    // GL / GH / GT etc.: not needed for DM media.
  };

  const handleGroupAudioPacket = (payload: Record<string, unknown>): void => {
    const roomId = asString(payload.roomId) ?? '';
    const dataB64 = asString(payload.data);
    const inLinkId = asString(payload.linkId);
    if (inLinkId && roomId) inboundAudioLinkIdByRoom.set(roomId, inLinkId);
    // Learn the peer's Reticulum AUDIO destination from EVERY inbound frame —
    // including link-control frames (the Hub sends only key-requests over the
    // link until it has the key, so if we only learned the dest from raw audio
    // the caller could never open an outbound link, leaving establishedLinks=0
    // and timing out media readiness). This opens our link back to the right
    // audio dest (which differs from the presence hash).
    const learnedDestEarly =
      asString(payload.peerDestinationHash) ||
      asString(payload.peerPresenceHash) ||
      '';
    if (roomId && learnedDestEarly) noteDmPeerDestination(roomId, learnedDestEarly);
    if (!dataB64) return;
    let bytes: Uint8Array;
    try {
      bytes = base64ToUint8(dataB64);
    } catch {
      return;
    }
    // The Hub delivers GK/GQ control frames over the audio link as a link-control
    // wire: the bridge unwraps the QGAU envelope and hands us the inner payload,
    // which is either bare JSON or `QGCCTL1\0` + JSON (decodeGcLinkControlWire on
    // desktop). Detect both, strip the magic, and reroute to the control handler
    // instead of treating it as (undecodable) audio.
    let jsonBytes: Uint8Array | null = null;
    if (bytes.length > 1 && bytes[0] === 0x7b /* '{' */) {
      jsonBytes = bytes;
    } else if (
      bytes.length > GC_LINK_CONTROL_MAGIC.length &&
      GC_LINK_CONTROL_MAGIC.every((b, i) => bytes[i] === b)
    ) {
      jsonBytes = bytes.subarray(GC_LINK_CONTROL_MAGIC.length);
    }
    if (jsonBytes) {
      try {
        const obj = JSON.parse(new TextDecoder().decode(jsonBytes));
        if (obj && isGroupCallReticulumWireType(obj.t)) {
          void handleGroupCallMessage({
            wire: obj,
            senderDestinationHash: payload.peerDestinationHash,
            peerPresenceHash: payload.peerPresenceHash,
            linkId: payload.linkId,
          });
          return;
        }
      } catch {
        /* not JSON → real audio */
      }
    }
    // Learn the peer's Reticulum destination from the (reliable) audio data-plane
    // so readiness can pass and outbound audio can be routed even when the
    // overlay GJ never arrived.
    const learnedDest =
      asString(payload.peerDestinationHash) ||
      asString(payload.peerPresenceHash) ||
      '';
    if (roomId && learnedDest) noteDmPeerDestination(roomId, learnedDest);
    emitGc('gcall:audio', {
      roomId,
      data: bytes,
      transport: asString(payload.linkId) ? 'link' : 'packet',
      peerPresenceHash: asString(payload.peerPresenceHash) ?? '',
      peerDestinationHash: asString(payload.peerDestinationHash) ?? '',
      bridgeReceivedAtWallMs: Number(payload.receivedAtWallMs) || Date.now(),
    });
  };

  window.groupCall = {
    setLocalAddresses: async (addresses: string[]) => {
      gcLocalAddresses.clear();
      for (const a of addresses) {
        if (typeof a === 'string' && a) gcLocalAddresses.add(a);
      }
      return { success: true };
    },
    join: async (
      roomId: string,
      chatId: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      reticulumDestinationHash: string,
      _topologyHint?: unknown,
      joinGeneration?: number,
      reticulumIdentityPublicKeyBase64?: string,
      joinRkSignature?: string
    ) => {
      try {
        await ensureBridgeStarted();
        const existing = gcRooms.get(roomId);
        const room: GcRoom = existing ?? {
          chatId,
          callSessionId: randomUuid(),
          mediaSessionGeneration: 1,
        };
        gcRooms.set(roomId, room);
        gcLocalAddresses.add(fromAddress);
        const isDm = roomId.startsWith('dmv:');
        const wireChatId = compactDmVoiceJoinWireChatId(roomId, chatId);
        const gj = encodeJoinWire({
          roomId,
          chatId: wireChatId,
          fromAddress,
          fromPublicKey,
          signature,
          timestamp,
          reticulumDestinationHash,
          reticulumIdentityPublicKeyBase64,
          // DM joins are signed WITHOUT joinGeneration → omit it on the wire.
          ...(isDm ? {} : { joinGeneration }),
        });
        const messages: Record<string, unknown>[] = [gj];
        if (reticulumIdentityPublicKeyBase64 && joinRkSignature) {
          const gi = encodeJoinIdentityWire({
            fromAddress,
            signature: joinRkSignature,
            timestamp,
            reticulumDestinationHash,
            reticulumIdentityPublicKeyBase64,
            ...(isDm ? {} : { joinGeneration }),
          });
          if (gi) messages.push(gi);
        }
        // Cache our signed join so it can be replayed as the Hub's required
        // QGCCTL1 audio-link auth, and start resending it over the audio path so
        // the Hub verifies our link and begins delivering GC_KEY over it.
        gcJoinWireByRoom.set(roomId, gj);
        startLinkAuthForRoom(roomId);
        await fanoutGroupCall(messages);
        return {
          success: true,
          callSessionId: room.callSessionId,
          mediaSessionGeneration: room.mediaSessionGeneration,
        };
      } catch (err) {
        console.error('[GCall] join failed:', err);
        return { success: false, error: String(err) };
      }
    },
    leave: async (
      roomId: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number
    ) => {
      const peers = gcPeersByRoom.get(roomId);
      stopLinkAuthForRoom(roomId);
      gcRooms.delete(roomId);
      gcPeersByRoom.delete(roomId);
      gcJoinWireByRoom.delete(roomId);
      inboundAudioLinkIdByRoom.delete(roomId);
      try {
        await fanoutGroupCall([
          encodeLeaveWire({ roomId, fromAddress, fromPublicKey, signature, timestamp }),
        ]);
      } catch {
        /* ignore */
      }
      if (peers) {
        for (const peer of peers.values()) {
          const hash = peer.destinationHash.toLowerCase();
          establishedLinkIdByPeer.delete(hash);
          try {
            await Reticulum.presenceCommand({
              action: 'close_group_audio_link',
              payload: { peerPresenceHash: hash },
            });
          } catch {
            /* ignore */
          }
        }
      }
      return { success: true };
    },
    sendKey: async (
      roomId: string,
      toAddress: string,
      encryptedKey: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      meta: {
        keyMessageVersion: number;
        callSessionId: string;
        mediaSessionGeneration: number;
        keyCommitment: string;
        encryptedKeyDigest: string;
      }
    ) => {
      noteDmPeerAddress(roomId, toAddress);
      try {
        const frames = await encodeKeyWire({
          type: 'GC_KEY',
          roomId,
          toAddress,
          fromAddress,
          fromPublicKey,
          encryptedKey,
          keyMessageVersion: meta.keyMessageVersion,
          callSessionId: meta.callSessionId,
          mediaSessionGeneration: meta.mediaSessionGeneration,
          keyCommitment: meta.keyCommitment,
          encryptedKeyDigest: meta.encryptedKeyDigest,
          signature,
          timestamp,
        });
        // The Hub accepts GC_KEY ONLY over the RNS audio link as a QGCCTL1
        // link-control frame (never the overlay), so ride the verified link
        // first. Keep the direct/fanout overlay paths as best-effort fallbacks.
        await sendControlFramesOverLinks(roomId, frames);
        const peerDest = peerDestForRoom(roomId, toAddress);
        if (peerDest) await sendGroupCallDirect(peerDest, frames);
        await fanoutGroupCall(frames);
        return { success: true };
      } catch (err) {
        console.error('[GCall] sendKey failed:', err);
        return { success: false, error: String(err) };
      }
    },
    sendKeyRequest: async (
      roomId: string,
      toAddress: string,
      fromAddress: string,
      signature: string,
      fromPublicKey: string,
      timestamp: number,
      callSessionId: string,
      mediaSessionGeneration: number
    ) => {
      noteDmPeerAddress(roomId, toAddress);
      try {
        const frames = await encodeKeyRequestWire({
          type: 'GC_KEY_REQUEST',
          roomId,
          toAddress,
          fromAddress,
          fromPublicKey,
          callSessionId,
          mediaSessionGeneration,
          keyMessageVersion: 3,
          signature,
          timestamp,
        });
        // Mirror the Hub: GC_KEY_REQUEST also rides the link-control path.
        await sendControlFramesOverLinks(roomId, frames);
        const peerDest = peerDestForRoom(roomId, toAddress);
        if (peerDest) await sendGroupCallDirect(peerDest, frames);
        await fanoutGroupCall(frames);
        return { success: true };
      } catch (err) {
        console.error('[GCall] sendKeyRequest failed:', err);
        return { success: false, error: String(err) };
      }
    },
    sendAudio: async (roomId: string, toAddress: string, data: Uint8Array) => {
      const peerDest = peerDestForRoom(roomId, toAddress);
      if (!peerDest) return { sent: 0, reason: 'no_peer' };
      // Ride a real established audio link so our audio is on a verified link
      // (the Hub drops audio from an unverified link / the data-plane). The
      // peer's AUDIO reticulum dest often differs from its presence hash, so
      // fall back to ANY established link for the call, then the inbound link.
      const candidates = candidateLinkIdsForRoom(roomId);
      // Prefer the Hub's INBOUND link — the one its GAC/link-control arrives on
      // and the one we send link-auth over, so the Hub verifies it. RNS links
      // are bidirectional, so sending audio back over that same link lands on
      // the link the Hub associates with us. Sending over our own separately
      // established link (establishedLinkIdByPeer) lands the audio on a link the
      // Hub never verified → it drops it as unverified and stays "connecting".
      const linkId =
        inboundAudioLinkIdByRoom.get(roomId) ||
        establishedLinkIdByPeer.get(peerDest) ||
        candidates[0] ||
        '';
      try {
        await Reticulum.presenceCommand({
          action: 'send_group_audio',
          payload: {
            linkId,
            roomId,
            peerPresenceHash: peerDest,
            peerDestinationHash: peerDest,
            receivedAtWallMs: Date.now(),
            data: uint8ToBase64(data),
          },
        });
        return { sent: 1 };
      } catch (err) {
        return { sent: 0, reason: String(err) };
      }
    },
    getRoomParticipants: async (roomId: string) => {
      const byAddr = gcPeersByRoom.get(roomId);
      if (!byAddr) return [];
      return [...byAddr.values()]
        .filter((p) => !!p.address)
        .map((p) => ({ address: p.address }));
    },
    getLinkStats: async (roomId: string) => {
      const byAddr = gcPeersByRoom.get(roomId);
      if (!byAddr) {
        return { success: true, stats: { establishedLinks: 0, participants: 0 } };
      }
      let established = 0;
      let routable = 0;
      for (const peer of byAddr.values()) {
        const hash = peer.destinationHash?.toLowerCase();
        if (hash && DEST_HASH_RE.test(hash)) {
          routable += 1;
          if (establishedLinkIdByPeer.has(hash)) established += 1;
        }
      }
      // On mobile, audio rides the overlay/packet path keyed by the peer's
      // Reticulum destination hash (learned from its GJ). A dedicated RNS link
      // is an optimization, not a precondition for sending audio — so treat a
      // known, routable peer destination as a "ready route". Without this the
      // shared DM readiness gate (which requires establishedLinks > 0) always
      // false-times-out at 12s and the call drops at ~14s with no audio.
      const establishedLinks = established > 0 ? established : routable;
      return {
        success: true,
        stats: { establishedLinks, participants: byAddr.size },
      };
    },
    requestPeerMediaRecovery: async (
      roomId: string,
      toAddress: string,
      _reason?: string
    ) => {
      // Record the DM peer address up-front (the overlay GJ may never arrive),
      // so the readiness gate can recognize the peer once its destination is
      // learned from the inbound audio data-plane.
      noteDmPeerAddress(roomId, toAddress);
      const peerDest = peerDestForRoom(roomId, toAddress);
      if (peerDest) {
        await openAudioLinkForPeer(peerDest);
        // Ensure link-auth is running for this room (no-op if already started).
        startLinkAuthForRoom(roomId);
        void sendLinkAuthForRoom(roomId);
      }
      return { success: true };
    },
    reportTransportHealth: async (_roomId: string, _peers: string[]) => {
      return { success: true };
    },
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      gcEventCbs.add(cb);
      return () => gcEventCbs.delete(cb);
    },
  } as unknown as Window['groupCall'];

  // window.audioSurface — in-WebView WebCodecs/AudioWorklet duplex engine that
  // rides on the window.groupCall transport above (installed only when the
  // WebView supports WebCodecs; otherwise the call stays connected but silent).
  installMobileAudioSurface();

  // Keep the bridge's neighbour leases warm (30 s grace window) and prune
  // expired online entries so the UI doesn't show stale peers.
  setInterval(() => {
    if (bridgeReady && neighborHashes.size > 0) void pushOverlaySync();
    refreshMobileStatus();
    const before = onlineByAddress.size;
    const live = liveSessions();
    if (live.length !== before) {
      // Some sessions expired; nudge listeners with the current truth.
      batchCbs.forEach((cb) => {
        try {
          cb(
            live.map((s) => ({
              address: s.address,
              online: true,
              status: s.status,
            }))
          );
        } catch {
          /* ignore */
        }
      });
    }
  }, 20_000);
}
