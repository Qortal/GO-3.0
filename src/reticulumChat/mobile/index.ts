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
import { Reticulum } from '../../plugins/Reticulum';

type ReadinessState = 'idle' | 'starting' | 'ready' | 'failed';
type ReadinessStatus = {
  state: ReadinessState;
  revision: number;
  error?: string;
  warning?: string;
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
  'setDeviceState',
  'getDeviceStates',
  'getDeviceStateSyncPeers',
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
  onDeviceStateChanged: 'reticulumChat:deviceStateChanged',
  onSilenceChanged: 'reticulumChat:silenceChanged',
  onResource: 'reticulumChat:resource',
  onTyping: 'reticulumChat:typing',
  onLandState: 'reticulumChat:landState',
  onLandChat: 'reticulumChat:landChat',
  onLandAction: 'reticulumChat:landAction',
  onLandCall: 'reticulumChat:landCall',
};

// Boot budget for the engine worker. Covers sqlite-wasm instantiation plus
// schema migration of a large history DB; hardened WebViews that run wasm in
// an interpreter (GrapheneOS Vanadium with JIT off) are 10-50x slower here
// than a stock WebView, so the budget is generous rather than tight.
const ENGINE_START_TIMEOUT_MS = 180_000;

const PY_EVENTS_FOR_WORKER = new Set([
  'ready',
  'reticulum_chat_message',
  'reticulum_chat_resource',
  'reticulum_resource',
  'reticulum_resource_session',
  'qchat_file_transfer',
  'overlay_link_state',
]);

let worker: Worker | null = null;
let rpcPort: MessagePort | null = null;
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
/**
 * True while the worker holds its own loopback socket to the native bridge
 * (see BridgeSocketServer.kt). Python events are then delivered to it
 * directly and must not be relayed a second time from this thread.
 */
let workerHasDirectBridge = false;
let presenceFeedTimer: number | null = null;
/** Automatic engine restarts after the SQLite shim discarded a corrupt file. */
let dbRebuildRestarts = 0;
const MAX_DB_REBUILD_RESTARTS = 2;

// Non-fatal condition worth showing the user (e.g. interpreted wasm because
// the WebView runs without JIT). Cleared when the engine is stopped.
let readinessWarning: string | undefined;

function setReadiness(state: ReadinessState, error?: string): void {
  if (state === 'idle') readinessWarning = undefined;
  readiness = {
    state,
    revision: readiness.revision + 1,
    ...(error ? { error } : {}),
    ...(readinessWarning ? { warning: readinessWarning } : {}),
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
  let error: string | undefined;
  // The worker waits 30 s. A JIT-less WebView (GrapheneOS with the WebView
  // JIT toggle restricted; it is allowed by default) signs ~10x slower and,
  // during engine boot, queues behind interpreted wasm work on the main
  // thread; the old 10 s cap returned null and dropped every
  // history/group_sub/DM-probe signature. Stock Android signs in
  // milliseconds, so a longer budget does not change it.
  const signTimeoutMs = readinessWarning ? 45_000 : 30_000;
  try {
    const response = await window.sendMessage(
      'signReticulumChatEvent',
      fields,
      signTimeoutMs
    );
    const failure =
      response && typeof response === 'object'
        ? (response as { error?: unknown }).error
        : null;
    if (failure) {
      error = String(failure);
      // Every sync primitive (history pages, state heads, group key requests,
      // DM discovery) is signed; a silent failure here looks like a dead
      // network, so make the reason visible.
      console.error(
        '[MobileChat] control signing rejected',
        failure,
        typeof fields.type === 'string' ? fields.type : ''
      );
    } else {
      result = response;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('[MobileChat] signReticulumChatEvent failed', err);
  }
  worker?.postMessage({
    t: 'signres',
    id,
    result,
    ...(error ? { error } : {}),
  });
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

/**
 * Resource payloads have to cross between the worker's OPFS filesystem and the
 * real files the python bridge reads and writes. The worker cannot reach the
 * native plugin directly, so it asks the main thread to do the staging I/O.
 */
async function answerNativeFsRequest(
  id: number,
  op: string,
  args: Record<string, unknown>
) {
  let result: unknown = null;
  let error = '';
  try {
    switch (op) {
      case 'path':
        result = await Reticulum.chatResourcePath({
          name: String(args.name ?? 'blob'),
        });
        break;
      case 'read':
        result = await Reticulum.chatResourceRead({
          path: String(args.path ?? ''),
        });
        break;
      case 'write':
        result = await Reticulum.chatResourceWrite({
          path: String(args.path ?? ''),
          dataBase64: String(args.dataBase64 ?? ''),
        });
        break;
      case 'delete':
        await Reticulum.chatResourceDelete({ path: String(args.path ?? '') });
        result = {};
        break;
      default:
        error = `unknown native fs op: ${op}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  worker?.postMessage({ t: 'nativefsres', id, result, error });
}

const NODE_API_CONFIG_REFRESH_MS = 30_000;
let lastPresenceSnapshotKey = '';
let lastNodeApiConfigCheckAt = 0;

function pushPresenceState(force = false): void {
  if (!worker) return;
  const snapshot = getReticulumChatPresenceSnapshot();
  // This runs every 5 s for the life of the app. The worker only replaces
  // its copy of the snapshot, so an unchanged one is not worth a structured
  // clone + message hop; the Core API key is likewise near-constant and does
  // not need a background round trip every tick.
  const key = JSON.stringify([
    snapshot.peers,
    snapshot.leases,
    snapshot.healthy,
  ]);
  if (force || key !== lastPresenceSnapshotKey) {
    lastPresenceSnapshotKey = key;
    worker.postMessage({
      t: 'presence-state',
      peers: snapshot.peers,
      leases: snapshot.leases,
      healthy: snapshot.healthy,
    });
  }
  const now = Date.now();
  if (force || now - lastNodeApiConfigCheckAt >= NODE_API_CONFIG_REFRESH_MS) {
    lastNodeApiConfigCheckAt = now;
    pushNodeApiConfig();
  }
  pushLocalIdentity();
}

let lastPushedApiConfig = '';
let lastAckedIdentityKey = '';
let transportIdentityInFlight = false;

function currentIdentityKey(): string {
  const info = window.__qortalMobileReticulum;
  const destinationHash = info?.destinationHash || '';
  const identityPublicKeyBase64 = info?.identityPublicKeyBase64 || '';
  if (!destinationHash) return '';
  return `${destinationHash}:${identityPublicKeyBase64}`;
}

function refreshTransportIdentity(): void {
  if (transportIdentityInFlight) return;
  transportIdentityInFlight = true;
  void presenceCommandWithResult('get_local_identity_public_key', {}, 8_000)
    .then((frame) => {
      const hash = String(frame?.payload?.destinationHash || '')
        .trim()
        .toLowerCase();
      const publicKey = String(frame?.payload?.publicKeyBase64 || '');
      if (!/^[0-9a-f]{32}$/.test(hash)) return;
      if (!window.__qortalMobileReticulum) {
        window.__qortalMobileReticulum = {
          destinationHash: null,
          identityPublicKeyBase64: null,
        };
      }
      window.__qortalMobileReticulum.destinationHash = hash;
      if (publicKey) {
        window.__qortalMobileReticulum.identityPublicKeyBase64 = publicKey;
      }
      lastAckedIdentityKey = '';
    })
    .catch(() => null)
    .finally(() => {
      transportIdentityInFlight = false;
      if (worker && currentIdentityKey()) pushLocalIdentity();
    });
}

/**
 * The engine's bridge learns its own peer hash from the python `ready` payload,
 * but the worker can attach after that frame has already been consumed. Keep
 * pushing until the worker acks the same hash — a one-shot miss isolates GO
 * until the process is killed.
 */
function pushLocalIdentity(): void {
  if (!worker) return;
  const info = window.__qortalMobileReticulum;
  const destinationHash = info?.destinationHash || '';
  const identityPublicKeyBase64 = info?.identityPublicKeyBase64 || null;
  if (!destinationHash) {
    refreshTransportIdentity();
    return;
  }
  const identityKey = `${destinationHash}:${identityPublicKeyBase64 ?? ''}`;
  if (identityKey === lastAckedIdentityKey) return;
  worker.postMessage({
    t: 'local-identity',
    destinationHash,
    identityPublicKeyBase64,
  });
  worker.postMessage({
    t: 'pyevent',
    event: 'ready',
    payload: {
      destinationHash,
      identityPublicKeyBase64: identityPublicKeyBase64 || undefined,
    },
  });
}

/**
 * The engine validates group membership against the Core API. The base API can
 * still be resolving when the worker boots, and it changes when the user
 * switches nodes — without a refresh the engine keeps a stale (or empty) URL
 * and every membership check comes back unavailable.
 */
function pushNodeApiConfig(): void {
  if (!worker) return;
  void getNodeApiConfig().then((config) => {
    if (!worker || !config.apiBase) return;
    const next = `${config.apiBase}|${config.apiKey || ''}`;
    if (next === lastPushedApiConfig) return;
    lastPushedApiConfig = next;
    worker.postMessage({ t: 'config', config });
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
        else
          pending.reject(new Error(data.error || 'reticulumChat RPC failed'));
      }
      break;
    }
    case 'evt':
      emitEvent(data.channel, data.payload);
      break;
    case 'cmd':
      void answerCommandRequest(
        data.id,
        data.action,
        data.payload,
        data.timeoutMs
      );
      break;
    case 'sign':
      void answerSignRequest(data.id, data.fields);
      break;
    case 'nativefs':
      void answerNativeFsRequest(data.id, data.op, data.args);
      break;
    case 'engine-ready':
      setReadiness('ready');
      pushLocalIdentity();
      break;
    case 'engine-failed':
      setReadiness('failed', String(data.error || 'engine failed'));
      break;
    case 'engine-slow':
      // sqlite-wasm took seconds to start: interpreted wasm (WebView JIT off).
      // Re-publish readiness with the hint; state is unchanged.
      console.warn(
        `[MobileChat] slow engine runtime ms=${data.ms}: ${data.hint}`
      );
      readinessWarning = String(data.hint || '');
      setReadiness(readiness.state, readiness.error);
      break;
    case 'db-rebuilt':
      // The SQLite shim discarded an unrecoverably corrupt file. Restart the
      // engine on a fresh DB; history re-syncs from peers.
      console.error(
        `[MobileChat] chat database ${data.name} discarded after corruption: ${data.error}`
      );
      if (dbRebuildRestarts < MAX_DB_REBUILD_RESTARTS) {
        dbRebuildRestarts += 1;
        stopMobileReticulumChat();
        window.setTimeout(() => {
          void ensureStarted().catch(() => {
            /* readiness already reports the failure */
          });
        }, 600);
      } else {
        setReadiness('failed', 'chat database corrupt; restart the app');
      }
      break;
    case 'identity-ack': {
      const hash = String(data.destinationHash || '').trim();
      if (hash) {
        lastAckedIdentityKey = `${hash}:${data.identityPublicKeyBase64 || ''}`;
      }
      break;
    }
    case 'direct-bridge':
      workerHasDirectBridge = data.connected === true;
      break;
    case 'bridge-traffic': {
      const fmt = (pairs: Array<[string, number]>) =>
        pairs.map(([k, n]) => `${k}=${n}`).join(' ');
      const bytes = Array.isArray(data.resourceBytes)
        ? ` resource_bytes{ ${fmt(data.resourceBytes)} }`
        : '';
      console.info(
        `[MobileChat] bridge_traffic ${data.seconds}s out{ ${fmt(data.commands)} } in{ ${fmt(data.events)} }${bytes}`
      );
      break;
    }
    default:
      break;
  }
}

/**
 * Hand the worker the native bridge's loopback socket so its commands and
 * events stop queueing behind UI work on this thread. Best effort: without it
 * the worker keeps using the main-thread relay.
 */
function pushBridgeSocket(target: Worker): void {
  const plugin = Reticulum as { bridgeSocket?: () => Promise<unknown> };
  if (typeof plugin.bridgeSocket !== 'function') return;
  void plugin
    .bridgeSocket()
    .then((info) => {
      const { url, token } = (info ?? {}) as { url?: string; token?: string };
      if (worker !== target || !url || !token) return;
      target.postMessage({ t: 'bridge-socket', url, token });
    })
    .catch((err) => {
      console.warn('[MobileChat] bridge socket unavailable', err);
    });
}

function rpc(
  method: string,
  args: unknown[],
  timeoutMs?: number
): Promise<unknown> {
  // Interpreted wasm (GrapheneOS JIT off) makes history reads slow; stock
  // Android still returns in milliseconds and never uses this extra budget.
  const budget = timeoutMs ?? (readinessWarning ? 90_000 : 45_000);
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
        }, budget);
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
        const target = rpcPort || worker;
        target.postMessage({ t: 'rpc', id, method, args });
      })
  );
}

async function getNodeApiConfig(): Promise<{
  apiBase: string;
  apiKey?: string;
}> {
  try {
    const apiKey = await window.sendMessage('getApiKey');
    if (apiKey && typeof apiKey === 'object' && apiKey.url) {
      return {
        apiBase: String(apiKey.url),
        apiKey: String(apiKey.apikey || ''),
      };
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
    // Local history lives in the worker SQLite DB. Do not wait for the
    // Python radio bridge (or Core API key) before booting it — those can
    // sit for tens of seconds and leave the DM screen empty.
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'reticulum-chat-engine',
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => {
      // An uncaught exception in a worker timer/callback does not stop the
      // worker; the engine keeps running. Log it, but do not let it bubble to
      // window.onerror (that shows the "GO runtime error" modal) and do not
      // demote a running engine to `failed` — boot failures arrive as an
      // explicit engine-failed message instead.
      err.preventDefault?.();
      console.error(
        '[MobileChat] engine worker error',
        err.message || err,
        err.filename ? `${err.filename}:${err.lineno}` : ''
      );
      if (readiness.state !== 'ready') {
        setReadiness('failed', err.message || 'worker error');
      }
    };
    const rpcChan = new MessageChannel();
    rpcPort = rpcChan.port1;
    rpcPort.onmessage = handleWorkerMessage;
    worker.postMessage({ t: 'rpc-port' }, [rpcChan.port2]);

    const config = { apiBase: getBaseApiReact() };
    lastPushedApiConfig = `${config.apiBase}|`;
    worker.postMessage({ t: 'boot', config });
    workerHasDirectBridge = false;
    pushBridgeSocket(worker);

    untapPython = registerPythonEventTap((frame) => {
      if (workerHasDirectBridge) return;
      const eventName = String(frame.event || '');
      if (!PY_EVENTS_FOR_WORKER.has(eventName)) return;
      worker?.postMessage({
        t: 'pyevent',
        event: eventName,
        payload: frame.payload ?? {},
      });
    });

    const attachRadio = (): void => {
      pushLocalIdentity();
      pushPresenceState(true);
      if (presenceFeedTimer == null) {
        const armPresenceFeed = (): void => {
          if (presenceFeedTimer != null) {
            window.clearInterval(presenceFeedTimer);
          }
          const ms =
            typeof document !== 'undefined' && document.hidden ? 20_000 : 5_000;
          presenceFeedTimer = window.setInterval(() => pushPresenceState(), ms);
        };
        armPresenceFeed();
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) pushPresenceState();
          if (worker) armPresenceFeed();
        });
      }
    };
    attachRadio();
    // Once the Python radio is up, re-push identity/presence so the engine's
    // transport goes live; the real `ready` also arrives through the tap.
    void ensureReticulumBridgeStarted()
      .then(() => attachRadio())
      .catch(() => {
        /* readiness listeners re-run ensureStarted on the next attempt */
      });

    // Readiness flips to `ready` when the worker reports engine-ready.
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (readiness.state === 'ready') return resolve();
        if (readiness.state === 'failed') {
          return reject(new Error(readiness.error || 'engine failed'));
        }
        if (Date.now() - started > ENGINE_START_TIMEOUT_MS) {
          setReadiness('failed', 'Chat engine start timed out');
          return reject(new Error('Chat engine start timed out'));
        }
        window.setTimeout(poll, 120);
      };
      poll();
    });
  })().catch((err) => {
    // Tear the failed worker down before allowing a retry. It still owns the
    // OPFS access handles of the SQLite pool; a second worker booted next to
    // it cannot open the database and fails too, and from then on every chat
    // call rejected until the app was restarted.
    untapPython?.();
    untapPython = null;
    const failedWorker = worker;
    const failedPort = rpcPort;
    worker = null;
    rpcPort = null;
    workerHasDirectBridge = false;
    try {
      failedPort?.close();
    } catch {
      /* already closed */
    }
    failedWorker?.terminate();
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
  // Capture the instances being stopped: ensureStarted() may create a new
  // worker before the grace timer fires, and that one must not be terminated.
  const stoppingWorker = worker;
  const stoppingPort = rpcPort;
  worker = null;
  rpcPort = null;
  workerHasDirectBridge = false;
  stoppingWorker?.postMessage({ t: 'stop' });
  window.setTimeout(() => {
    try {
      stoppingPort?.close();
    } catch {
      /* already closed */
    }
    stoppingWorker?.terminate();
  }, 500);
  startPromise = null;
  lastAckedIdentityKey = '';
  lastPushedApiConfig = '';
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
  // Diagnostics (read-only): self-DM state as the engine sees it.
  api.debugSelfDm = () => rpc('debug:selfDm', []);
  api.debugLogs = (filter?: string) => rpc('debug:logs', [filter]);

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
  installMobileReticulumResources();
}

/**
 * `window.reticulumResources` twin.
 *
 * Desktop serves assembled files over a custom `qortal-reticulum-resource://`
 * protocol registered in the Electron main process. The WebView has no such
 * protocol, so `getUrl` pulls the bytes out of the worker and hands back a
 * `blob:` URL instead, and `open` shows the file in the in-app viewer rather
 * than an OS app. Everything else is a thin RPC.
 */
function installMobileReticulumResources(): void {
  const blobUrls = new Map<string, string>();
  // WebView-picked files have no filesystem path. The composers require a
  // path for non-image attachments (`addPendingReticulumFile` refuses to
  // buffer them as base64) and then import through `importFilePath`, so hand
  // out a synthetic `mobile-file://` key per File and resolve it back to the
  // File at import time. Copying the bytes into native staging here bought
  // nothing: the import can only read through the worker, which sees OPFS.
  const stagedPaths = new WeakMap<File, string>();
  const stagedFiles = new Map<string, File>();
  let stagedSequence = 0;

  const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };

  const resources = {
    getPathForFile: (file?: unknown) =>
      (file instanceof Blob && stagedPaths.get(file as File)) || '',

    stageFileForPath: async (file: File): Promise<string> => {
      const existing = stagedPaths.get(file);
      if (existing) return existing;
      const path = `mobile-file://${Date.now()}-${++stagedSequence}/${file.name || 'attachment.bin'}`;
      stagedPaths.set(file, path);
      stagedFiles.set(path, file);
      return path;
    },

    importBase64: (payload: unknown) => rpc('resource:importBase64', [payload]),

    // Path-based import resolves the staged File and streams it to the worker
    // as base64 (same path images take). Unknown paths cannot be read here.
    importFilePath: async (payload: unknown) => {
      const record =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {};
      const filePath = String(record.filePath ?? '');
      const file = stagedFiles.get(filePath);
      if (!file) {
        return {
          success: false,
          error: 'File path import is not available on mobile',
        };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { filePath: _ignored, ...rest } = record;
      const result = (await rpc('resource:importBase64', [
        {
          ...rest,
          fileName: rest.fileName || file.name || 'attachment.bin',
          mimeType: rest.mimeType || file.type || 'application/octet-stream',
          base64: encodeBase64(bytes),
        },
      ])) as { success?: boolean } | null;
      if (result?.success) {
        stagedFiles.delete(filePath);
        stagedPaths.delete(file);
      }
      return result;
    },

    getUrl: async (fileHash: string) => {
      const hash = String(fileHash ?? '').trim();
      if (!hash) return { success: false, error: 'Invalid file hash' };
      const cached = blobUrls.get(hash);
      if (cached) {
        const status = (await rpc('resource:getStatus', [hash]).catch(
          () => null
        )) as { manifest?: unknown } | null;
        return { success: true, url: cached, manifest: status?.manifest };
      }
      let res: {
        success: boolean;
        bytes?: Uint8Array;
        manifest?: { mimeType?: string };
        error?: string;
      };
      try {
        res = (await rpc('resource:bytes', [hash])) as typeof res;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Resource unavailable',
        };
      }
      if (!res?.success || !res.bytes) {
        return { success: false, error: res?.error || 'Resource unavailable' };
      }
      const url = URL.createObjectURL(
        new Blob([res.bytes], {
          type: res.manifest?.mimeType || 'application/octet-stream',
        })
      );
      blobUrls.set(hash, url);
      return { success: true, url, manifest: res.manifest };
    },

    getStatus: (fileHash: string) => rpc('resource:getStatus', [fileHash]),
    getStorageStatus: () => rpc('resource:getStorageStatus', []),
    cleanupStorage: () => rpc('resource:cleanupStorage', []),

    saveAs: async (fileHash: string, suggestedFileName?: string) => {
      let res: {
        success: boolean;
        bytes?: Uint8Array;
        manifest?: { fileName?: string; mimeType?: string };
        error?: string;
      };
      try {
        res = (await rpc('resource:bytes', [fileHash])) as typeof res;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Resource unavailable',
        };
      }
      if (!res?.success || !res.bytes) {
        return { success: false, error: res?.error || 'Resource unavailable' };
      }
      try {
        const { saveStreamToMobileDocuments } =
          await import('../../utils/mobileFileSave');
        // Base64-ing the whole transfer for a single bridge call stalls the
        // WebView (and can run it out of memory) on anything large, so hand it
        // over in slices instead.
        const bytes = res.bytes;
        const SLICE_BYTES = 384 * 1024;
        const slices = (async function* () {
          for (let offset = 0; offset < bytes.length; offset += SLICE_BYTES) {
            yield bytes.subarray(offset, offset + SLICE_BYTES);
          }
        })();
        const saved = await saveStreamToMobileDocuments(
          suggestedFileName || res.manifest?.fileName || 'qortal-file',
          slices,
          res.manifest?.mimeType || 'application/octet-stream'
        );
        return { success: true, path: saved.path, uri: saved.uri };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Save failed',
        };
      }
    },

    // `window.open(blobUrl)` does not open a new window in the WebView: it
    // navigates the app itself to the raw file, with no way back. Files open
    // in the in-app viewer instead, which also offers share / open with.
    open: async (fileHash: string, suggestedFileName?: string) => {
      const hash = String(fileHash ?? '').trim();
      if (!hash) return { success: false, error: 'Invalid file hash' };
      const { openFileViewer } = await import('../../utils/fileViewerEvents');
      openFileViewer({ fileHash: hash, fileName: suggestedFileName });
      return { success: true };
    },

    // Needs native image tooling the WebView doesn't have; callers treat a
    // failure here as "send the GIF as-is".
    convertGifToWebp: async () => ({
      success: false,
      error: 'GIF conversion is not available on mobile',
    }),
    releaseConvertedMedia: async () => ({ success: true }),
  };

  (window as any).reticulumResources = resources;
}
