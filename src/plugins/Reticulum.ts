import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface ReticulumStatus {
  started: boolean;
  online: boolean;
  networkName: string;
  /** IFAC code size in bytes (16 when network_name-derived IFAC is active). */
  ifacSize: number;
  /** Hub interfaces currently online. */
  interfaces: number;
  /** Destinations learned from announces (RNS path table size). */
  announces: number;
  rxBytes: number;
  txBytes: number;
}

export interface ReticulumAnnounceEvent {
  destinationHash: string;
}

/** One newline-delimited JSON frame emitted by the Python presence bridge. */
export interface ReticulumPresenceFrameEvent {
  /** Raw JSON frame: `{"type":"resp"|"event", ...}` from presence_bridge.py. */
  frame: string;
}

/**
 * Native Reticulum transport bridge.
 *
 * Hosts the embedded Python presence bridge, which owns the RNS instance
 * connected to the Qortal community hubs (network_name = "qortal-hub"). Chat,
 * presence, voice calls and direct file transfer all ride on it; start() /
 * getStatus() report that instance's hub interfaces for the status badge.
 */
export interface ReticulumPlugin {
  /** Mark the transport status feed active; the bridge itself is started by presenceStart(). */
  start(options?: { networkName?: string }): Promise<ReticulumStatus>;

  /** Current transport status (online, byte counters, announce count). */
  getStatus(): Promise<ReticulumStatus>;

  /** Stop the transport and release the network interfaces. */
  stop(): Promise<{ stopped: boolean }>;

  /**
   * Start the native (Chaquopy) Qortal presence bridge: a standalone RNS
   * instance + presence destination on the Qortal hubs. Idempotent.
   */
  presenceStart(): Promise<{ started: boolean }>;

  /**
   * Publish a signed presence envelope (announce / heartbeat / offline) to the
   * overlay. The envelope is produced and signed by the web layer
   * (signPresenceMessage) and gossiped to Qortal peers over RNS links.
   */
  publishPresence(options: { envelope: unknown }): Promise<{ ok: boolean }>;

  /**
   * Generic command passthrough to presence_bridge.py. Used by the mobile
   * presence coordinator to drive the overlay protocol the desktop normally
   * drives from presence.ts — e.g. `overlay_sync_state` (tell the bridge which
   * discovered peers to fan out to) and `publish_presence` with neighbor hashes.
   */
  presenceCommand(options: {
    action: string;
    payload?: Record<string, unknown>;
    /**
     * Optional command id. When provided, the bridge's `{type:"resp", id, ...}`
     * frame for this command carries the same id so the JS layer can correlate
     * request and response (see presenceCommandWithResult in capacitorBridge).
     */
    id?: string;
  }): Promise<{ ok: boolean; id?: string }>;

  /** Stop the presence bridge. */
  presenceStop(): Promise<{ stopped: boolean }>;

  /**
   * Logout: close the hub sockets while the Python bridge stays up. The
   * native default delay (5 s) lets an offline presence notice sent just
   * before leave first; the next presenceStart or status service start
   * redials. Clamped to 0-60 000 ms natively.
   */
  presencePauseNetwork(options?: {
    delayMs?: number;
    reason?: string;
  }): Promise<{ ok: boolean }>;

  /**
   * Loopback WebSocket endpoint for the chat engine worker. Commands sent on
   * it are fed to presence_bridge.py and every bridge frame is mirrored back,
   * bypassing the WebView main thread that plugin calls and listeners use.
   * The token must be presented as the `token` query parameter.
   */
  bridgeSocket(): Promise<{ url: string; token: string }>;

  /**
   * Stage a picked file (content:// / file:// URI) into app cache for a
   * Reticulum file transfer: copies the bytes and computes SHA-256.
   */
  qchatFilePrepare(options: {
    uri: string;
    name?: string;
  }): Promise<{ path: string; name: string; size: number; sha256: string }>;

  /** Unique bridge-writable save path for an inbound file transfer. */
  qchatFileSavePath(options: { fileName: string }): Promise<{ path: string }>;

  /**
   * Existence/size probe for a staged send or a received file. Any other
   * path reads as missing (FileOpenPolicy.java).
   */
  qchatFileStat(options: {
    path: string;
  }): Promise<{ exists: boolean; size: number }>;

  /**
   * Open a received or saved file (MediaStore content:// URI, or a path in
   * GO's received-file or share-staging folders or, on Android 8/9, in
   * Documents/Qortal Go or Downloads) in a viewer app. Rejects with code
   * NOT_FOUND for anything else. Received files stay in GO's private
   * storage: nothing copies them to Downloads (N-22).
   */
  qchatFileOpen(options: {
    uri: string;
    fileName?: string;
    /** Overrides the type guessed from the file extension. */
    mimeType?: string;
  }): Promise<{ ok: boolean }>;

  /**
   * Chat-engine resource staging. The engine's filesystem is OPFS inside a
   * worker, which the python bridge cannot read or write, so resource payloads
   * are handed over through real files in a private cache directory. All four
   * calls are confined to that directory.
   */
  chatResourcePath(options: { name?: string }): Promise<{ path: string }>;
  chatResourceWrite(options: {
    path: string;
    dataBase64: string;
  }): Promise<{ path: string; size: number }>;
  chatResourceRead(options: {
    path: string;
  }): Promise<{ dataBase64: string; size: number }>;
  chatResourceDelete(options: { path: string }): Promise<void>;

  /** Fired for every announce received from the Reticulum network. */
  addListener(
    eventName: 'announce',
    listenerFunc: (event: ReticulumAnnounceEvent) => void
  ): Promise<PluginListenerHandle>;

  /** Fired when transport status changes (e.g. comes online). */
  addListener(
    eventName: 'status',
    listenerFunc: (event: ReticulumStatus) => void
  ): Promise<PluginListenerHandle>;

  /** Fired for every JSON frame emitted by the Python presence bridge. */
  addListener(
    eventName: 'presence',
    listenerFunc: (event: ReticulumPresenceFrameEvent) => void
  ): Promise<PluginListenerHandle>;
}

const Reticulum = registerPlugin<ReticulumPlugin>('Reticulum');

export { Reticulum };
