/**
 * Mobile `window.reticulumChat`: a faithful twin of the Electron preload
 * surface, backed by the chat engine running in a dedicated worker instead of
 * the main process.
 *
 * Responsibilities:
 *  - worker lifecycle with a SingleFlight readiness statechart mirroring
 *    desktop (idle → starting → ready/failed, onReadinessChanged fanout),
 *  - RPC for the 67 invoke methods, local event bus for the 16 on* streams,
 *  - relaying python event frames into the worker and worker python commands
 *    out through the native Reticulum plugin,
 *  - answering the worker's signing requests via the renderer's existing
 *    `signReticulumChatEvent` background case,
 *  - feeding presence peers/leases/health into the engine.
 */
import {
  ensureReticulumBridgeStarted,
  getReticulumChatPresenceSnapshot,
  isCapacitor,
  presenceCommandWithResult,
  registerPythonEventTap,
} from '../../bridge/capacitorBridge';
import { getBaseApiReact } from '../../App';

type ReadinessState = 'idle' | 'starting' | 'ready' | 'failed';
type ReadinessStatus = {
  state: ReadinessState;
  revision: number;
  error?: string;
};

const INVOKE_METHODS = [
  'setLocalGroupMemberships',
  'setPublicGroupDirectory',
  'getPublicGroupActivity',
  'getPublicGroupActivitySnapshot',
  'setLocalDmAddresses',
  'clearLocalAccountState',
  'getSilence',
  'listSilences',
  'setSilence',
  'clearSilence',
  'setActiveDirectChat',
  'subscribeGroup',
  'subscribeChannel',
  'unsubscribeChannel',
  'unsubscribeGroup',
  'publishEvent',
  'reserveAuthorSequence',
  'releaseAuthorSequence',
  'publishDirectEvent',
  'getDirectAuthorStreamId',
  'getDirectExpiryPreference',
  'setDirectExpiryPreference',
  'getCalendarEvents',
  'getCalendarEvent',
  'createCalendarEvent',
  'updateCalendarEvent',
  'deleteCalendarEvent',
  'getCalendarReminder',
  'setCalendarReminder',
  'sendDirectTyping',
  'getDirectHistory',
  'getDirectSummaries',
  'getDirectCallHistory',
  'markDirectRead',
  'sendTyping',
  'sendLandState',
  'sendLandChat',
  'sendLandAction',
  'sendLandCall',
  'requestResource',
  'requestDirectResource',
  'cancelResource',
  'getHistory',
  'getMessageHistory',
  'getMessageHistoryPage',
  'getDiscussionIndex',
  'getDiscussionMessages',
  'getChannelMetadataHistory',
  'getChannels',
  'getCategories',
  'getChannelMetadataBundle',
  'applyChannelMetadata',
  'getSyncState',
  'getSummaries',
  'search',
  'getMessageWindowAroundEvent',
  'getMessageWindowPageAroundEvent',
  'indexSearchText',
  'deleteSearchText',
  'replaceMentions',
  'deleteMentions',
  'markRead',
  'markGroupsRead',
  'getSubscriptions',
  'updateMentionBadge',
] as const;

/** preload `onX` name → worker event channel */
const EVENT_SUBSCRIPTIONS: Record<string, string> = {
  onEvent: 'reticulumChat:event',
  onSummaryChanged: 'reticulumChat:summaryChanged',
  onCalendarChanged: 'reticulumChat:calendarChanged',
  onCalendarReminderDue: 'reticulumChat:calendarReminderDue',
  onDirectEvent: 'reticulumChat:directEvent',
  onDirectCallHistory: 'reticulumChat:directCallHistory',
  onDirectTyping: 'reticulumChat:directTyping',
  onDirectSummaryChanged: 'reticulumChat:directSummaryChanged',
  onSilenceChanged: 'reticulumChat:silenceChanged',
  onResource: 'reticulumChat:resource',
  onTyping: 'reticulumChat:typing',
  onLandState: 'reticulumChat:landState',
  onLandChat: 'reticulumChat:landChat',
  onLandAction: 'reticulumChat:landAction',
  onLandCall: 'reticulumChat:landCall',
};

const PY_EVENTS_FOR_WORKER = new Set([
  'ready',
  'reticulum_chat_message',
  'reticulum_chat_resource',
  'reticulum_resource',
  'reticulum_resource_session',
]);

let worker: Worker | null = null;
let readiness: ReadinessStatus = { state: 'idle', revision: 0 };
const readinessSubscribers = new Set<(status: ReadinessStatus) => void>();
const eventSubscribers = new Map<string, Set<(payload: unknown) => void>>();

let nextRpcId = 1;
const pendingRpc = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

let startPromise: Promise<void> | null = null;
let untapPython: (() => void) | null = null;
let presenceFeedTimer: number | null = null;

function setReadiness(state: ReadinessState, error?: string): void {
  readiness = {
    state,
    revision: readiness.revision + 1,
    ...(error ? { error } : {}),
  };
  for (const cb of [...readinessSubscribers]) {
    try {
      cb(readiness);
    } catch {
      /* subscriber errors are not ours */
    }
  }
}

function emitEvent(channel: string, payload: unknown): void {
  const subs = eventSubscribers.get(channel);
  if (!subs) return;
  for (const cb of [...subs]) {
    try {
      cb(payload);
    } catch (err) {
      console.warn(`[MobileChat] ${channel} subscriber failed`, err);
    }
  }
}

async function answerSignRequest(id: number, fields: Record<string, unknown>) {
  let result: unknown = null;
  try {
    const response = await window.sendMessage(
      'signReticulumChatEvent',
      fields,
      10_000
    );
    if (!(response && typeof response === 'object' && response.error)) {
      result = response;
    }
  } catch (err) {
    console.warn('[MobileChat] signReticulumChatEvent failed', err);
  }
  worker?.postMessage({ t: 'signres', id, result });
}

async function answerCommandRequest(
  id: number,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs?: number
) {
  let frame: Record<string, unknown>;
  try {
    frame = await presenceCommandWithResult(action, payload, timeoutMs);
  } catch (err) {
    frame = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  worker?.postMessage({ t: 'cmdres', id, frame });
}

function pushPresenceState(): void {
  if (!worker) return;
  const snapshot = getReticulumChatPresenceSnapshot();
  worker.postMessage({
    t: 'presence-state',
    peers: snapshot.peers,
    leases: snapshot.leases,
    healthy: snapshot.healthy,
  });
}

function handleWorkerMessage(event: MessageEvent): void {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  switch (data.t) {
    case 'rpcres': {
      const pending = pendingRpc.get(data.id);
      if (pending) {
        pendingRpc.delete(data.id);
        if (data.ok) pending.resolve(data.value);
        else pending.reject(new Error(data.error || 'reticulumChat RPC failed'));
      }
      break;
    }
    case 'evt':
      emitEvent(data.channel, data.payload);
      break;
    case 'cmd':
      void answerCommandRequest(data.id, data.action, data.payload, data.timeoutMs);
      break;
    case 'sign':
      void answerSignRequest(data.id, data.fields);
      break;
    case 'engine-ready':
      setReadiness('ready');
      break;
    case 'engine-failed':
      setReadiness('failed', String(data.error || 'engine failed'));
      break;
    default:
      break;
  }
}

function rpc(method: string, args: unknown[], timeoutMs = 45_000): Promise<unknown> {
  return ensureStarted().then(
    () =>
      new Promise((resolve, reject) => {
        if (!worker) {
          reject(new Error('Reticulum chat engine is not running'));
          return;
        }
        const id = nextRpcId++;
        const timer = window.setTimeout(() => {
          pendingRpc.delete(id);
          reject(new Error(`reticulumChat:${method} timed out`));
        }, timeoutMs);
        pendingRpc.set(id, {
          resolve: (v) => {
            window.clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            window.clearTimeout(timer);
            reject(e);
          },
        });
        worker.postMessage({ t: 'rpc', id, method, args });
      })
  );
}

async function getNodeApiConfig(): Promise<{ apiBase: string; apiKey?: string }> {
  try {
    const apiKey = await window.sendMessage('getApiKey');
    if (apiKey && typeof apiKey === 'object' && apiKey.url) {
      return { apiBase: String(apiKey.url), apiKey: String(apiKey.apikey || '') };
    }
  } catch {
    /* fall through to the public/base API */
  }
  return { apiBase: getBaseApiReact() };
}

function ensureStarted(): Promise<void> {
  if (startPromise) return startPromise;
  setReadiness('starting');
  startPromise = (async () => {
    // Native Reticulum must be pumping frames before the engine attaches.
    await ensureReticulumBridgeStarted();

    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'reticulum-chat-engine',
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => {
      console.error('[MobileChat] engine worker error', err);
      setReadiness('failed', err.message || 'worker error');
    };

    const config = await getNodeApiConfig();
    worker.postMessage({ t: 'boot', config });

    untapPython = registerPythonEventTap((frame) => {
      const eventName = String(frame.event || '');
      if (!PY_EVENTS_FOR_WORKER.has(eventName)) return;
      worker?.postMessage({
        t: 'pyevent',
        event: eventName,
        payload: frame.payload ?? {},
      });
    });

    // The bridge may already be ready (its `ready` fired before our tap):
    // re-emit a synthetic ready so the engine's transport goes live.
    void presenceCommandWithResult('get_transport_state', {}, 8_000)
      .then(() => {
        worker?.postMessage({ t: 'pyevent', event: 'ready', payload: {} });
      })
      .catch(() => {
        /* the real ready event will arrive through the tap */
      });

    pushPresenceState();
    if (presenceFeedTimer == null) {
      presenceFeedTimer = window.setInterval(pushPresenceState, 5_000);
    }

    // Readiness flips to `ready` when the worker reports engine-ready.
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (readiness.state === 'ready') return resolve();
        if (readiness.state === 'failed') {
          return reject(new Error(readiness.error || 'engine failed'));
        }
        if (Date.now() - started > 60_000) {
          setReadiness('failed', 'Chat engine start timed out');
          return reject(new Error('Chat engine start timed out'));
        }
        window.setTimeout(poll, 120);
      };
      poll();
    });
  })().catch((err) => {
    startPromise = null;
    setReadiness('failed', err instanceof Error ? err.message : String(err));
    throw err;
  });
  return startPromise;
}

export function stopMobileReticulumChat(): void {
  untapPython?.();
  untapPython = null;
  if (presenceFeedTimer != null) {
    window.clearInterval(presenceFeedTimer);
    presenceFeedTimer = null;
  }
  worker?.postMessage({ t: 'stop' });
  window.setTimeout(() => {
    worker?.terminate();
    worker = null;
  }, 500);
  startPromise = null;
  setReadiness('idle');
}

/** Install the preload-twin API. Safe to call once at bridge install time. */
export function installMobileReticulumChat(): void {
  if (!isCapacitor()) return;

  const api: Record<string, unknown> = {
    isEnabled: async () => {
      try {
        const settings = await window.sendMessage('getUserSettings', {
          key: 'reticulumChatEnabled',
        });
        if (settings === false) return false;
      } catch {
        /* default on */
      }
      return true;
    },
    getReadinessStatus: async () => {
      // Kick the engine on first interest so the UI's readiness listeners
      // drive startup exactly like desktop's ensureReticulumManagersStarted.
      void ensureStarted().catch(() => {});
      return readiness;
    },
    onReadinessChanged: (cb: (status: ReadinessStatus) => void) => {
      readinessSubscribers.add(cb);
      void ensureStarted().catch(() => {});
      return () => {
        readinessSubscribers.delete(cb);
      };
    },
  };

  for (const method of INVOKE_METHODS) {
    api[method] = (...args: unknown[]) => rpc(method, args);
  }

  for (const [name, channel] of Object.entries(EVENT_SUBSCRIPTIONS)) {
    api[name] = (cb: (payload: unknown) => void) => {
      let subs = eventSubscribers.get(channel);
      if (!subs) {
        subs = new Set();
        eventSubscribers.set(channel, subs);
      }
      subs.add(cb);
      void ensureStarted().catch(() => {});
      return () => {
        subs?.delete(cb);
      };
    };
  }

  (window as any).reticulumChat = api;
}
