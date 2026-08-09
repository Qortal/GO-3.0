import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface ReticulumStatus {
  started: boolean;
  online: boolean;
  networkName: string;
  /** IFAC code size in bytes (16 when network_name-derived IFAC is active). */
  ifacSize: number;
  interfaces: number;
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
 * Wraps the Kotlin RNS stack (reticulum-kt) running in client-only mode and
 * connected to the Qortal community hubs (network_name = "qortal-hub").
 * This is the substrate for v2.0 voice calls, direct file transfer, and
 * online presence on mobile.
 */
export interface ReticulumPlugin {
  /** Start the transport and connect to the Qortal Reticulum hubs. */
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
   * Stage a picked file (content:// / file:// URI) into app cache for a
   * Reticulum file transfer: copies the bytes and computes SHA-256.
   */
  qchatFilePrepare(options: {
    uri: string;
    name?: string;
  }): Promise<{ path: string; name: string; size: number; sha256: string }>;

  /** Unique bridge-writable save path for an inbound file transfer. */
  qchatFileSavePath(options: { fileName: string }): Promise<{ path: string }>;

  /** Existence/size probe for a staged file path. */
  qchatFileStat(options: {
    path: string;
  }): Promise<{ exists: boolean; size: number }>;

  /** Copy a completed inbound transfer into the public Downloads collection. */
  qchatFileExportToDownloads(options: {
    path: string;
    fileName?: string;
  }): Promise<{ ok: boolean; uri?: string }>;

  /** Open a received file (content:// URI or app-storage path) in a viewer app. */
  qchatFileOpen(options: {
    uri: string;
    fileName?: string;
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
