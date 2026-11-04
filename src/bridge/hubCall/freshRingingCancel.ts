/**
 * GO-only, wire-neutral: when a call GO placed is answered on one of the
 * callee's devices, the callee's OTHER devices stop ringing, also when the
 * answer came more than 30 s after the call started.
 *
 * Hub 3.0.3 already cancels the other devices (call.ts handleAccept →
 * cancelOtherRingingEndpoints ~2597), with two gaps:
 *   - the CALL_HANGUP it pins is the one the renderer pre-signed at request
 *     time (useVoiceCall.ts initiateCall, `cancellationTimestamp = timestamp`),
 *     and receivers drop CALL_* signatures older than 30 s
 *     (ed25519-verify-common.ts verifyCallSignedDetached), so a late answer
 *     leaves the other devices ringing until their own 60 s timeout;
 *   - it goes only to `invitedReticulumPeerHashes`, the callee routes the
 *     caller knew when the call started.
 *
 * On `call:accepted` this signs a fresh CALL_HANGUP (same field set and signer
 * as the pre-signed one) and pins it, through the manager's own bounded-retry
 * sender, to every endpoint of the callee known now (invited + live presence)
 * except the device that answered. Receivers see an ordinary caller hangup
 * from the caller's bound endpoint; a device that already stopped ringing
 * ignores it (no record for the callId). Hub's own pre-signed copy still goes
 * out first, unchanged.
 *
 * Never flood this hangup over the overlay: the device that answered belongs
 * to the same address and would end the call.
 */
import type { CallManager } from '../../../electron/src/call';
import { verifyCallSignedDetached } from '../../../electron/src/ed25519-verify-common';

/** Mirror of call.ts CALL_WIRE_HANGUP / encodeCallWire('CALL_HANGUP'). */
const CALL_WIRE_HANGUP = 'CH';

export type CancelSigningFields = {
  type: 'CALL_HANGUP';
  callId: string;
  timestamp: number;
};

export type FreshRingingCancelDeps = {
  /** Signs with the account key; the Base58 signature, or null. */
  sign: (fields: CancelSigningFields) => Promise<string | null>;
  /** Live Reticulum endpoints (presence destination hashes) of an account. */
  getEndpoints: (address: string) => string[];
  now?: () => number;
};

export type FreshRingingCancel = {
  /** False when CallManager internals changed: the fix is off. */
  readonly installed: boolean;
  dispose(): void;
};

/** The CallRecord fields read here (call.ts interface CallRecord). */
type CallRecordView = {
  localAddress?: unknown;
  remoteAddress?: unknown;
  direction?: unknown;
  state?: unknown;
  acceptedReticulumPeerHash?: unknown;
  invitedReticulumPeerHashes?: unknown;
  cancellationSignature?: unknown;
  cancellationPublicKey?: unknown;
};

type CallManagerInternals = {
  activeCalls?: unknown;
  sendPinnedCallWireWhenReady?: unknown;
};

function normalizeHash(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function installFreshRingingCancel(
  callManager: CallManager,
  deps: FreshRingingCancelDeps
): FreshRingingCancel {
  const internals = callManager as unknown as CallManagerInternals;
  const activeCalls = internals.activeCalls;
  if (
    !(activeCalls instanceof Map) ||
    typeof internals.sendPinnedCallWireWhenReady !== 'function'
  ) {
    return { installed: false, dispose: () => {} };
  }
  const sendPinned = (peer: string, wire: Record<string, unknown>): void => {
    (
      internals.sendPinnedCallWireWhenReady as (
        peer: string,
        wire: Record<string, unknown>,
        attempt: number
      ) => void
    ).call(callManager, peer, wire, 0);
  };
  const now = deps.now ?? Date.now;
  let disposed = false;

  const sendFreshCancel = async (
    callId: string,
    localAddress: string,
    publicKey: string,
    targets: string[]
  ): Promise<void> => {
    const timestamp = now();
    let signature: string | null = null;
    try {
      signature = await deps.sign({ type: 'CALL_HANGUP', callId, timestamp });
    } catch (err) {
      console.warn('[GO call] fresh ringing cancel: signing failed', err);
      return;
    }
    if (disposed || !signature) return;
    // Never send a signature the callee's devices would drop (account switched
    // mid-call, signer error).
    if (
      !verifyCallSignedDetached(
        'CALL_HANGUP',
        callId,
        timestamp,
        signature,
        publicKey,
        localAddress
      )
    ) {
      console.warn('[GO call] fresh ringing cancel: signature did not verify');
      return;
    }
    const wire = {
      t: CALL_WIRE_HANGUP,
      c: callId,
      k: publicKey,
      g: signature,
      m: timestamp,
    };
    for (const peer of targets) sendPinned(peer, wire);
  };

  const onAccepted = (payload: unknown): void => {
    if (disposed) return;
    const callId = (payload as { callId?: unknown } | null)?.callId;
    if (typeof callId !== 'string' || !callId) return;
    const call = activeCalls.get(callId) as CallRecordView | undefined;
    if (!call || call.direction !== 'outbound' || call.state !== 'active') {
      return;
    }
    const localAddress = call.localAddress;
    const remoteAddress = call.remoteAddress;
    const publicKey = call.cancellationPublicKey;
    // Same gate as Hub: calls placed without a pre-signed cancellation (e.g.
    // API-signed signalling) are left alone.
    if (
      typeof localAddress !== 'string' ||
      !localAddress ||
      typeof remoteAddress !== 'string' ||
      !remoteAddress ||
      typeof publicKey !== 'string' ||
      !publicKey ||
      typeof call.cancellationSignature !== 'string' ||
      !call.cancellationSignature
    ) {
      return;
    }
    const targets = new Set<string>();
    if (call.invitedReticulumPeerHashes instanceof Set) {
      for (const peer of call.invitedReticulumPeerHashes) {
        targets.add(normalizeHash(peer));
      }
    }
    try {
      for (const peer of deps.getEndpoints(remoteAddress)) {
        targets.add(normalizeHash(peer));
      }
    } catch {
      // Presence is best effort; the invited endpoints still get the cancel.
    }
    targets.delete(normalizeHash(call.acceptedReticulumPeerHash));
    targets.delete('');
    if (targets.size === 0) return;
    void sendFreshCancel(callId, localAddress, publicKey, [...targets]);
  };

  callManager.on('call:accepted', onAccepted);
  return {
    installed: true,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      callManager.off('call:accepted', onAccepted);
    },
  };
}
