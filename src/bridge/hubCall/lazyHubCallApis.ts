/**
 * `window.call` / `window.groupCall` objects that exist immediately while the
 * hosted Hub call managers (src/bridge/hubCall/hostedCallManagers.ts, which
 * pulls in electron/src/call.ts + group-call.ts) load lazily on first use.
 *
 * Every method awaits the stack and forwards to the real API; `onEvent` /
 * `onQortalGroupCallActivity` register now and attach when the stack is
 * ready; `leaveSync` (synchronous on desktop) works once loaded and otherwise
 * reports the desktop "manager not running" error. A failed load never
 * throws into the renderer and is retried by the next method call or
 * `ensureLoaded()`; while early subscribers are waiting it is also retried
 * on its own (LOAD_RETRY_DELAYS_MS). Waiting subscribers attach on whichever
 * load succeeds.
 *
 * Imports types only, so it adds nothing heavy to the bundle it lives in.
 */
import type { WindowCallApi } from './callIpc';
import type { WindowGroupCallApi } from './groupCallIpc';
import type { HostedCallStack } from './hostedCallManagers';

export type LazyHubCallApisOptions = {
  /**
   * When false, `window.groupCall.sendRtcSignal` reads as `undefined`, so the
   * shared call hook never negotiates WebRTC (useVoiceCall
   * prefersDirectVoiceWebRtc) and the group runtime sends no DataChannel
   * signals: calls stay on Reticulum media ("Private calls (Reticulum
   * only)"). Default true.
   */
  exposeRtcSignal?: boolean;
  /**
   * Read on every access of `groupCall.sendRtcSignal` (a getter): false
   * hides it whatever `exposeRtcSignal` says — e.g. while GO's audio surface
   * that runs start-direct-voice-rtc is not installed. Default: supported.
   */
  isRtcSignalSupported?: () => boolean;
  onLoadError?: (error: unknown) => void;
};

export type LazyHubCallApis = {
  call: WindowCallApi;
  groupCall: WindowGroupCallApi;
  /** The stack if it finished loading. */
  getLoaded(): HostedCallStack | null;
  /** Loads (or returns) the stack; null if loading failed. */
  ensureLoaded(): Promise<HostedCallStack | null>;
  /**
   * Shows/hides `groupCall.sendRtcSignal` (settings toggle). It is a getter
   * on the same object that reads `undefined` while hidden, so
   * `typeof window.groupCall.sendRtcSignal === 'function'` (useVoiceCall,
   * on every render and before every RTC signal) and the group runtime's
   * `!window.groupCall?.sendRtcSignal` check follow it at once. Hiding is
   * DEFERRED while a 1:1 call's media room (`dmv:`) is joined: that call
   * keeps WebRTC signalling (ICE restart, reconnect) until it ends; the next
   * call uses the new setting. Showing is immediate.
   */
  setRtcSignalExposed(exposed: boolean): void;
  /** What `groupCall.sendRtcSignal` currently reads as a function. */
  isRtcSignalExposed(): boolean;
};

/** Self-retry of a failed load while early subscribers wait (then stop). */
export const LOAD_RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 60_000, 120_000];
/** How often a deferred RTC removal re-checks for the end of the DM call. */
const RTC_REMOVAL_RECHECK_MS = 2_000;

const CALL_NOT_RUNNING = {
  success: false,
  error: 'Call manager not running',
} as const;
const GROUP_CALL_NOT_RUNNING = {
  success: false,
  error: 'GroupCall manager not running',
} as const;

export function createLazyHubCallApis(
  load: () => Promise<HostedCallStack>,
  options: LazyHubCallApisOptions = {}
): LazyHubCallApis {
  let loaded: HostedCallStack | null = null;
  let loading: Promise<HostedCallStack | null> | null = null;
  /** Early subscribers waiting for a successful load (any caller's). */
  const pendingAttachments = new Set<(stack: HostedCallStack) => void>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failedLoadsInARow = 0;
  /** Set by the RTC exposure logic below; runs after every successful load. */
  let onStackLoaded: ((stack: HostedCallStack) => void) | null = null;

  const scheduleLoadRetry = (): void => {
    if (retryTimer || loaded || pendingAttachments.size === 0) return;
    const delay = LOAD_RETRY_DELAYS_MS[failedLoadsInARow - 1];
    if (delay === undefined) return; // gave up; a later call still loads
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (loaded || pendingAttachments.size === 0) return;
      void ensureLoaded();
    }, delay);
  };

  const ensureLoaded = (): Promise<HostedCallStack | null> => {
    if (loaded) return Promise.resolve(loaded);
    if (!loading) {
      loading = load()
        .then((stack) => {
          loaded = stack;
          failedLoadsInARow = 0;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = null;
          for (const attachNow of [...pendingAttachments]) {
            try {
              attachNow(stack);
            } catch (err) {
              console.warn('[GO call] early subscriber failed to attach', err);
            }
          }
          pendingAttachments.clear();
          onStackLoaded?.(stack);
          return stack;
        })
        .catch((error) => {
          options.onLoadError?.(error);
          loading = null;
          failedLoadsInARow += 1;
          scheduleLoadRetry();
          return null;
        });
    }
    return loading;
  };

  /** Subscribe now, attach to the real API once the stack exists. */
  const deferredSubscribe = <Cb>(
    cb: Cb,
    attach: (stack: HostedCallStack, cb: Cb) => () => void
  ): (() => void) => {
    let detach: (() => void) | null = null;
    let cancelled = false;
    const attachNow = (stack: HostedCallStack): void => {
      pendingAttachments.delete(attachNow);
      if (cancelled || detach) return;
      detach = attach(stack, cb);
    };
    if (loaded) {
      attachNow(loaded);
    } else {
      pendingAttachments.add(attachNow);
      void ensureLoaded();
    }
    return () => {
      cancelled = true;
      pendingAttachments.delete(attachNow);
      detach?.();
      detach = null;
    };
  };

  const call: WindowCallApi = {
    initiate: async (...args) =>
      (await ensureLoaded())?.call.initiate(...args) ?? { ...CALL_NOT_RUNNING },
    accept: async (...args) =>
      (await ensureLoaded())?.call.accept(...args) ?? { ...CALL_NOT_RUNNING },
    reject: async (...args) =>
      (await ensureLoaded())?.call.reject(...args) ?? { ...CALL_NOT_RUNNING },
    hangup: async (...args) =>
      (await ensureLoaded())?.call.hangup(...args) ?? { ...CALL_NOT_RUNNING },
    sendRtcSignal: async (...args) =>
      (await ensureLoaded())?.call.sendRtcSignal(...args) ?? {
        ...CALL_NOT_RUNNING,
      },
    setLocalAddresses: async (...args) =>
      (await ensureLoaded())?.call.setLocalAddresses(...args) ?? {
        ...CALL_NOT_RUNNING,
      },
    onEvent: (cb) =>
      deferredSubscribe(cb, (stack, subscriber) =>
        stack.call.onEvent(subscriber)
      ),
  };

  const gc = async (): Promise<WindowGroupCallApi | null> =>
    (await ensureLoaded())?.groupCall ?? null;

  const groupCall: WindowGroupCallApi = {
    join: async (...args) =>
      (await gc())?.join(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    leave: async (...args) =>
      (await gc())?.leave(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    leaveSync: (...args) =>
      loaded?.groupCall.leaveSync?.(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    broadcastTopology: async (...args) =>
      (await gc())?.broadcastTopology(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    sendClusterHeartbeat: async (...args) =>
      (await gc())?.sendClusterHeartbeat?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    // Hot path (every voice frame, 50/s): straight to the loaded API.
    sendAudio: (...args) =>
      loaded
        ? loaded.groupCall.sendAudio(...args)
        : gc().then(
            (api) => api?.sendAudio(...args) ?? { ...GROUP_CALL_NOT_RUNNING }
          ),
    sendAudioBatch: (...args) =>
      loaded?.groupCall.sendAudioBatch
        ? loaded.groupCall.sendAudioBatch(...args)
        : gc().then(
            (api) =>
              api?.sendAudioBatch?.(...args) ?? { ...GROUP_CALL_NOT_RUNNING }
          ),
    sendRtcSignal: async (...args) =>
      (await gc())?.sendRtcSignal(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    requestPeerMediaRecovery: async (...args) =>
      (await gc())?.requestPeerMediaRecovery?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    getAudioDataPlaneSession: async (...args) =>
      (await gc())?.getAudioDataPlaneSession?.(...args) ?? {
        ok: false,
        reason: 'manager-unavailable',
      },
    sendKey: async (...args) =>
      (await gc())?.sendKey(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    sendKeyRequest: async (...args) =>
      (await gc())?.sendKeyRequest(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    requestSessionBreak: async (...args) =>
      (await gc())?.requestSessionBreak(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    setLocalAddresses: async (...args) =>
      (await gc())?.setLocalAddresses(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    setQortalGroupReticulumTargets: async (...args) =>
      (await gc())?.setQortalGroupReticulumTargets?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    reportTransportHealth: async (...args) =>
      (await gc())?.reportTransportHealth?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    reportGcallAudioEscalation: async (...args) =>
      (await gc())?.reportGcallAudioEscalation?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    getLinkStats: async (...args) =>
      (await gc())?.getLinkStats?.(...args) ?? { ...GROUP_CALL_NOT_RUNNING },
    getRoomParticipants: async (...args) =>
      (await gc())?.getRoomParticipants(...args) ?? [],
    getRoomBootstrapState: async (...args) =>
      (await gc())?.getRoomBootstrapState?.(...args) ?? null,
    setWatchedQortalGroupIds: async (...args) =>
      (await gc())?.setWatchedQortalGroupIds?.(...args) ?? {
        ...GROUP_CALL_NOT_RUNNING,
      },
    onQortalGroupCallActivity: (cb) =>
      deferredSubscribe(
        cb,
        (stack, subscriber) =>
          stack.groupCall.onQortalGroupCallActivity?.(subscriber) ?? (() => {})
      ),
    getPendingKeyMetrics: async () =>
      (await gc())?.getPendingKeyMetrics?.() ?? {
        pending_key_flush_success: 0,
        pending_key_expired: 0,
        pendingRooms: 0,
      },
    requestRetainedKeyReplay: () => {
      void gc().then((api) => api?.requestRetainedKeyReplay?.());
    },
    onEvent: (cb) =>
      deferredSubscribe(cb, (stack, subscriber) =>
        stack.groupCall.onEvent(subscriber)
      ),
  };
  const sendRtcSignal = groupCall.sendRtcSignal;
  let rtcExposedWanted = options.exposeRtcSignal !== false;
  /** The property's state (wanted, or kept for a live 1:1 call). */
  let rtcExposedNow = false;
  let rtcRemovalTimer: ReturnType<typeof setInterval> | null = null;

  const rtcSupported = (): boolean => {
    if (!options.isRtcSignalSupported) return true;
    try {
      return options.isRtcSignalSupported() === true;
    } catch {
      return false;
    }
  };
  // A getter, not a data property that is added and deleted: everything that
  // reads it (useVoiceCall's typeof check, the group runtime, MAS-support
  // changes) sees the current state, and no caller can cache a stale method.
  delete (groupCall as Partial<WindowGroupCallApi>).sendRtcSignal;
  Object.defineProperty(groupCall, 'sendRtcSignal', {
    configurable: true,
    enumerable: true,
    get: () => (rtcExposedNow && rtcSupported() ? sendRtcSignal : undefined),
  });

  const directVoiceCallActive = (): boolean => {
    try {
      return loaded?.hasActiveDirectVoiceRoom?.() === true;
    } catch {
      return false;
    }
  };

  const stopRtcRemovalRecheck = (): void => {
    if (rtcRemovalTimer) clearInterval(rtcRemovalTimer);
    rtcRemovalTimer = null;
  };

  /** Brings the property in line with the wanted state when that is safe. */
  const applyRtcExposure = (): void => {
    if (rtcExposedWanted) {
      stopRtcRemovalRecheck();
      rtcExposedNow = true;
      return;
    }
    if (!rtcExposedNow) {
      stopRtcRemovalRecheck();
      return;
    }
    if (directVoiceCallActive()) {
      // A live 1:1 call keeps its RTC signalling until its media room ends
      // (leave/leaveSync below re-apply at once; this catches rooms the
      // manager leaves on its own, e.g. logout or takeover).
      if (!rtcRemovalTimer) {
        rtcRemovalTimer = setInterval(applyRtcExposure, RTC_REMOVAL_RECHECK_MS);
      }
      return;
    }
    stopRtcRemovalRecheck();
    rtcExposedNow = false;
  };

  const setRtcSignalExposed = (exposed: boolean): void => {
    rtcExposedWanted = exposed;
    applyRtcExposure();
  };

  // A pending removal re-checks as soon as a DM media room is left.
  const leave = groupCall.leave;
  groupCall.leave = async (...args) => {
    const result = await leave(...args);
    if (!rtcExposedWanted) applyRtcExposure();
    return result;
  };
  const leaveSync = groupCall.leaveSync;
  groupCall.leaveSync = (...args) => {
    const result = leaveSync!(...args);
    if (!rtcExposedWanted) applyRtcExposure();
    return result;
  };
  onStackLoaded = () => {
    if (!rtcExposedWanted) applyRtcExposure();
  };
  applyRtcExposure();

  return {
    call,
    groupCall,
    getLoaded: () => loaded,
    ensureLoaded,
    setRtcSignalExposed,
    isRtcSignalExposed: () => typeof groupCall.sendRtcSignal === 'function',
  };
}
