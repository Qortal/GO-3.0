/**
 * `window.call` for GO on top of a hosted Hub `CallManager`.
 *
 * A port of the desktop preload API (electron/src/preload.ts ~3816-3951) and
 * its main-process IPC handlers (electron/src/setup.ts ~6500-6641), with the
 * same return values:
 *   initiate  → { success:true, callId } | { success:false, error:'Target offline' }
 *   accept    → { success:true } | { success:false, error:'Call is no longer ringing' }
 *   reject / hangup / setLocalAddresses → always { success:true }
 *   sendRtcSignal → CallManager.sendRtcSignal (legacy path, unused by renderers)
 *   onEvent   → call:incoming / accepted / rejected / hangup / rtc-signal;
 *               the first subscriber gets the replay of ringing inbound and
 *               accepted outbound calls (setup.ts `call:subscribe`), minus
 *               any it already heard live before the replay ran.
 *
 * Only types are imported from the managers so a lazy wrapper can expose
 * this API before the (large) hosted module is loaded.
 */
import type { CallManager } from '../../../electron/src/call';
import type { EventEmitter } from 'events';

export type WindowCallApi = NonNullable<Window['call']>;

export const CALL_EVENT_CHANNELS = [
  'call:incoming',
  'call:accepted',
  'call:rejected',
  'call:hangup',
  'call:rtc-signal',
] as const;

export type CallIpcContext = {
  callManager: CallManager;
  /** Renderer-facing call channels (manager events + GO-synthesised ones). */
  events: EventEmitter;
  /** The local user ended this call (no timeout hangup must be synthesised). */
  noteLocalCallEnd(callId: string): void;
};

const MANAGER_NOT_RUNNING = {
  success: false,
  error: 'Call manager not running',
} as const;

export function createWindowCallApi(
  getContext: () => CallIpcContext | null
): WindowCallApi {
  let subscriberCount = 0;

  const api: WindowCallApi = {
    initiate: async (
      targetAddress,
      chatId,
      localAddress,
      signature,
      publicKey,
      callId,
      timestamp,
      cancellationSignature,
      cancellationPublicKey,
      cancellationTimestamp
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      const resultCallId = await ctx.callManager.initiateCall(
        targetAddress,
        chatId,
        localAddress,
        signature,
        publicKey,
        callId,
        timestamp,
        cancellationSignature,
        cancellationPublicKey,
        cancellationTimestamp
      );
      return resultCallId
        ? { success: true, callId: resultCallId }
        : { success: false, error: 'Target offline' };
    },

    accept: async (callId, signature, publicKey, timestamp) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      return ctx.callManager.acceptCall(callId, signature, publicKey, timestamp)
        ? { success: true }
        : { success: false, error: 'Call is no longer ringing' };
    },

    reject: async (
      callId,
      reason,
      signature,
      publicKey,
      timestamp,
      reasonSignature
    ) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.noteLocalCallEnd(callId);
      ctx.callManager.rejectCall(
        callId,
        reason,
        signature,
        publicKey,
        timestamp,
        reasonSignature
      );
      return { success: true };
    },

    hangup: async (callId, signature, publicKey, timestamp) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.noteLocalCallEnd(callId);
      await ctx.callManager.hangUp(callId, signature, publicKey, timestamp);
      return { success: true };
    },

    sendRtcSignal: async (input) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      return ctx.callManager.sendRtcSignal(input);
    },

    setLocalAddresses: async (addresses) => {
      const ctx = getContext();
      if (!ctx) return { ...MANAGER_NOT_RUNNING };
      ctx.callManager.setLocalAddresses(
        Array.isArray(addresses) ? addresses : []
      );
      return { success: true };
    },

    onEvent: (cb) => {
      const ctx = getContext();
      if (!ctx) return () => {};
      // Calls this subscriber hears about live before the replay below runs
      // (desktop replays in the same step as subscribing; here it waits a
      // tick, so a call can ring in between): the replay skips them, or the
      // subscriber would get call:incoming twice for the same call.
      let replayPending = false;
      const heardLive = {
        incoming: new Set<string>(),
        accepted: new Set<string>(),
      };
      const handlers = CALL_EVENT_CHANNELS.map((channel) => {
        const handler = (payload: unknown) => {
          if (
            replayPending &&
            (channel === 'call:incoming' || channel === 'call:accepted')
          ) {
            const callId = (payload as { callId?: unknown } | null)?.callId;
            if (typeof callId === 'string') {
              heardLive[
                channel === 'call:incoming' ? 'incoming' : 'accepted'
              ].add(callId);
            }
          }
          try {
            cb(channel, payload);
          } catch (err) {
            console.warn('[GO call] call event subscriber failed', err);
          }
        };
        ctx.events.on(channel, handler);
        return [channel, handler] as const;
      });
      subscriberCount += 1;
      if (subscriberCount === 1) {
        // setup.ts `call:subscribe`: replay to the (first) subscriber after
        // the IPC round trip, i.e. asynchronously.
        replayPending = true;
        setTimeout(() => {
          replayPending = false;
          const skipIncoming = heardLive.incoming;
          const skipAccepted = heardLive.accepted;
          heardLive.incoming = new Set();
          heardLive.accepted = new Set();
          if (!handlers.length) return;
          const manager = ctx.callManager;
          for (const payload of manager.getPendingInboundRingingPayloads()) {
            if (skipIncoming.has(payload.callId)) continue;
            try {
              cb('call:incoming', payload);
            } catch {
              /* ignore */
            }
          }
          for (const payload of manager.getActiveOutboundAcceptedPayloads()) {
            if (skipAccepted.has(payload.callId)) continue;
            try {
              cb('call:accepted', payload);
            } catch {
              /* ignore */
            }
          }
        }, 0);
      }
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        for (const [channel, handler] of handlers) {
          ctx.events.off(channel, handler);
        }
        handlers.length = 0;
        subscriberCount = Math.max(0, subscriberCount - 1);
      };
    },
  };
  return api;
}
