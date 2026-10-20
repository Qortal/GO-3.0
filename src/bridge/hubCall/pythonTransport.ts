/**
 * The seam between GO's hosted Hub call managers and GO's Python Reticulum
 * bridge (android/app/src/main/python, reached through the Capacitor
 * `Reticulum` plugin). Everything in src/bridge/hubCall talks to Python only
 * through this interface, so the adapters can be tested against an
 * in-memory fake and wired to capacitorBridge.ts in one place.
 *
 * Frame shapes are exactly what presence_bridge.py emits:
 *   resp:  { type: 'resp', id, ok, payload?, error? }
 *   event: { type: 'event', event, payload? }
 */

export type PythonRespFrame = {
  type?: 'resp';
  id?: string;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
};

export type PythonEventFrame = {
  type?: 'event';
  event: string;
  payload?: unknown;
};

/** One outbound audio-link frame (`send_group_audio` command, contract §1.4). */
export type OutboundAudioFrame = {
  linkId: string;
  roomId: string;
  peerPresenceHash: string;
  peerDestinationHash: string;
  /** 0 bypasses Python's 320 ms outbound deadline (control frames). */
  receivedAtWallMs: number;
  /** Standard base64 of the raw frame (media packet or `QGCCTL1\0`+JSON). */
  data: string;
};

export interface HubCallPythonTransport {
  /**
   * Correlated command: resolves with Python's `resp` frame for this command.
   * Rejects (message containing "timed out") when no resp arrives in time.
   * capacitorBridge: `presenceCommandWithResult(action, payload, timeoutMs)`.
   */
  commandWithResult(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<PythonRespFrame>;
  /**
   * Fire-and-forget command (resolves once queued, not when Python answers).
   * capacitorBridge: `Reticulum.presenceCommand({ action, payload })`.
   */
  command(action: string, payload: Record<string, unknown>): Promise<void>;
  /**
   * Optional fast path for audio-link frames. When present the adapter hands
   * every outbound frame batch (collected within one task) to it instead of
   * one `send_group_audio` command per frame. Return false to fall back to
   * per-frame commands.
   */
  sendAudioFrames?(frames: OutboundAudioFrame[]): boolean;
  /** Subscribe to Python event frames. Returns an unsubscribe function. */
  onEvent(cb: (frame: PythonEventFrame) => void): () => void;
  /** True once Python emitted `ready` (and not failed since). */
  isReady(): boolean;
  /** Optional readiness notifications (re-attach / flush on `ready`). */
  onReadyChange?(cb: (ready: boolean) => void): () => void;
  /** GO's presence destination hash (python `_destination`), lowercase hex. */
  getLocalDestinationHash(): string | undefined;
}
