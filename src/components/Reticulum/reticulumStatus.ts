import { useEffect, useState } from 'react';
import { Reticulum } from '../../plugins/Reticulum';
import type { ReticulumStatus } from '../../plugins/Reticulum';
import { QortalBackground } from '../../plugins/QortalBackground';
import { isCapacitor } from '../../utils/platform';
import { onMobileReticulumStatus } from '../../bridge/capacitorBridge';

export type ReticulumPhase =
  | 'idle'
  | 'starting'
  | 'online'
  | 'connecting'
  | 'offline'
  | 'error';

export interface ReticulumState {
  phase: ReticulumPhase;
  status: ReticulumStatus | null;
  error: string | null;
  /**
   * Failure of the Python presence/chat bridge (separate from the Kotlin
   * transport above). The transport can be online while the bridge that
   * carries every chat message never booted; this is what tells the user.
   */
  bridgeError: string | null;
  /** Non-fatal chat engine condition (e.g. running on interpreted wasm). */
  bridgeWarning: string | null;
  /** Chat engine worker state — independent of the transport badge. */
  chatEngineState: string | null;
  /** When the engine entered its current state (ms since epoch). */
  chatEngineSince: number | null;
  /** How long the last engine boot took, once ready. */
  chatEngineBootMs: number | null;
}

type ChatEngineReadiness = {
  state: string;
  revision: number;
  error?: string;
  warning?: string;
  since?: number;
  bootMs?: number;
};

// Single shared transport lifecycle: no matter how many UI surfaces (top-bar
// badge, diagnostic chip) subscribe, Reticulum.start() + polling happens once.
let current: ReticulumState = {
  phase: 'idle',
  status: null,
  error: null,
  bridgeError: null,
  bridgeWarning: null,
  chatEngineState: null,
  chatEngineSince: null,
  chatEngineBootMs: null,
};
let started = false;
let bridgeStatusSubscribed = false;
// Booting Python/RNS is CPU-heavy and floods the JS bridge with events; doing
// it before login starves the biometric prompt and wallet decrypt. Hold the
// transport until the app says it's safe (post-authentication).
let startAllowed = false;
const listeners = new Set<(s: ReticulumState) => void>();

function set(next: Partial<ReticulumState>) {
  current = { ...current, ...next };
  listeners.forEach((l) => l(current));
}

/** Unblock the transport (call after authentication). Starts it if UI already subscribed. */
export function allowReticulumStart() {
  if (startAllowed) return;
  startAllowed = true;
  if (listeners.size > 0) {
    void ensureStarted();
  }
}

let pythonBridgeError: string | null = null;
let chatEngineError: string | null = null;
let lastChatEngineRevision = -1;

function publishBridgeError() {
  const next = pythonBridgeError ?? chatEngineError ?? null;
  if (next !== current.bridgeError) set({ bridgeError: next });
}

/**
 * Apply one chat-engine readiness report. Reports arrive from the live
 * subscription and from the one-off replay right after subscribing; the
 * revision keeps a late replay from overwriting a newer live state.
 */
export function applyChatEngineReadiness(status: ChatEngineReadiness): void {
  if (!status || typeof status.revision !== 'number') return;
  if (status.revision < lastChatEngineRevision) return;
  lastChatEngineRevision = status.revision;
  chatEngineError =
    status.state === 'failed'
      ? `Chat engine failed to start: ${status.error || 'unknown error'}`
      : null;
  publishBridgeError();
  const warning = status.warning || null;
  const nextState = status.state || null;
  const since =
    typeof status.since === 'number' && status.since > 0
      ? status.since
      : current.chatEngineState === nextState && current.chatEngineSince
        ? current.chatEngineSince
        : Date.now();
  const bootMs = typeof status.bootMs === 'number' ? status.bootMs : null;
  if (
    warning !== current.bridgeWarning ||
    nextState !== current.chatEngineState ||
    since !== current.chatEngineSince ||
    bootMs !== current.chatEngineBootMs
  ) {
    set({
      bridgeWarning: warning,
      chatEngineState: nextState,
      chatEngineSince: since,
      chatEngineBootMs: bootMs,
    });
  }
}

/** Seconds since the engine entered its current state. */
export function chatEngineStateAgeSec(
  state: Pick<ReticulumState, 'chatEngineSince'>,
  now = Date.now()
): number {
  if (!state.chatEngineSince) return 0;
  return Math.max(0, Math.round((now - state.chatEngineSince) / 1000));
}

/**
 * Label for the badge's "Chat engine" row. `starting` carries how long it has
 * been booting: on a WebView without JIT that is the number that explains a
 * chat that "does nothing" for a minute.
 */
export function chatEngineLabel(
  state: Pick<ReticulumState, 'chatEngineState' | 'chatEngineSince'>,
  now = Date.now()
): string {
  const engine = state.chatEngineState || 'idle';
  if (engine !== 'starting') return engine;
  const age = chatEngineStateAgeSec(state, now);
  return age >= 5 ? `starting · ${age} s` : 'starting';
}

function ensureBridgeStatusSubscribed() {
  if (bridgeStatusSubscribed || !isCapacitor()) return;
  bridgeStatusSubscribed = true;
  onMobileReticulumStatus((s) => {
    pythonBridgeError = s.bridgeError ?? null;
    publishBridgeError();
  });
  // The chat engine worker (SQLite/OPFS/wasm) can fail independently of the
  // Python bridge; its failure is otherwise only visible in devtools.
  const readinessApi = (
    window as unknown as {
      reticulumChat?: {
        onReadinessChanged?: (
          cb: (status: ChatEngineReadiness) => void
        ) => () => void;
        getReadinessStatus?: () => Promise<ChatEngineReadiness>;
      };
    }
  ).reticulumChat;
  readinessApi?.onReadinessChanged?.(applyChatEngineReadiness);
  // The subscription only reports transitions. The engine is usually already
  // booting by now (any chat surface that mounted first kicked it), so
  // without this replay the badge sat on "idle" through the whole boot — and
  // through a boot that never finished — telling the user nothing.
  void readinessApi
    ?.getReadinessStatus?.()
    .then((status) => applyChatEngineReadiness(status))
    .catch(() => {
      /* engine start failures are reported through the subscription */
    });
}

async function ensureStarted() {
  if (started || !startAllowed) return;
  started = true;
  // Only after login: subscribing to chat readiness boots the engine worker.
  ensureBridgeStatusSubscribed();
  const startedAt = Date.now();
  const phaseFor = (online: boolean): ReticulumPhase => {
    if (online) return 'online';
    return Date.now() - startedAt < 30_000 ? 'connecting' : 'offline';
  };
  try {
    await Reticulum.addListener('status', (s) =>
      set({ status: s, phase: phaseFor(s.online) })
    );
    await Reticulum.addListener('announce', () =>
      set({
        status: current.status
          ? { ...current.status, announces: current.status.announces + 1 }
          : current.status,
      })
    );

    set({ phase: 'starting' });
    const s = await Reticulum.start();
    set({ status: s, phase: s.online ? 'online' : 'connecting' });

    // The `status` listener above already delivers transport changes
    // event-driven; this poll reconciles counters and flips to offline when
    // hubs drop (airplane mode / radio loss). Keep polling in the background
    // so the tray is not stuck on "online".
    const pollStatus = async () => {
      try {
        const cur = await Reticulum.getStatus();
        const nextPhase = phaseFor(cur.online);
        set({ status: cur, phase: nextPhase });
      } catch {
        /* transient */
      }
    };
    const scheduleNext = () => {
      const connecting =
        Date.now() - startedAt < 30_000 || current.phase !== 'online';
      const hidden = typeof document !== 'undefined' && document.hidden;
      const interval = connecting
        ? Date.now() - startedAt < 30_000
          ? 3_000
          : 20_000
        : hidden
          ? 90_000
          : 60_000;
      setTimeout(async () => {
        await pollStatus();
        scheduleNext();
      }, interval);
    };
    scheduleNext();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void pollStatus();
      });
    }
  } catch (e: unknown) {
    // Most likely web (no native plugin).
    set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function useReticulumStatus(): ReticulumState {
  const [state, setState] = useState<ReticulumState>(current);
  useEffect(() => {
    const l = (s: ReticulumState) => setState(s);
    listeners.add(l);
    void ensureStarted();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}

export function subscribeReticulumStatus(
  listener: (state: ReticulumState) => void
): () => void {
  listeners.add(listener);
  void ensureStarted();
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function reticulumPhaseColor(phase: ReticulumPhase): string {
  switch (phase) {
    case 'online':
      return '#3ddc84';
    case 'connecting':
    case 'starting':
      return '#f5a623';
    case 'offline':
    case 'error':
      return '#e53935';
    default:
      return '#888';
  }
}

/**
 * What the badge / tray should show. Transport `online` means an RNS
 * interface is up, not that any Qortal peers have been reached.
 */
export function reticulumDisplayPhase(
  phase: ReticulumPhase,
  onlineCount: number,
  deviceOnline: boolean
): ReticulumPhase {
  if (phase === 'error') return 'error';
  if (!deviceOnline) return 'offline';
  if (onlineCount > 0) return 'online';
  if (phase === 'offline') return 'offline';
  if (phase === 'idle') return 'idle';
  return phase === 'starting' ? 'starting' : 'connecting';
}

export function reticulumDisplayLabel(displayPhase: ReticulumPhase): string {
  switch (displayPhase) {
    case 'online':
      return 'online';
    case 'offline':
    case 'error':
      return 'offline';
    case 'idle':
      return 'idle';
    default:
      return 'connecting';
  }
}

let deviceOnline =
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;
const deviceListeners = new Set<(online: boolean) => void>();
let deviceWatchersBound = false;

function setDeviceOnline(next: boolean) {
  if (deviceOnline === next) return;
  deviceOnline = next;
  deviceListeners.forEach((listener) => listener(deviceOnline));
}

function bindDeviceOnlineWatchers() {
  if (deviceWatchersBound || typeof window === 'undefined') return;
  deviceWatchersBound = true;
  window.addEventListener('online', () => setDeviceOnline(true));
  window.addEventListener('offline', () => setDeviceOnline(false));
  if (!isCapacitor()) return;
  void QortalBackground.getDeviceNetwork()
    .then((result) => setDeviceOnline(result.online !== false))
    .catch(() => {
      /* plugin missing on web */
    });
  void QortalBackground.addListener('deviceNetwork', (event) => {
    setDeviceOnline(event.online !== false);
  });
}

export function getDeviceOnline(): boolean {
  bindDeviceOnlineWatchers();
  return deviceOnline;
}

export function subscribeDeviceOnline(
  listener: (online: boolean) => void
): () => void {
  bindDeviceOnlineWatchers();
  deviceListeners.add(listener);
  listener(deviceOnline);
  return () => {
    deviceListeners.delete(listener);
  };
}

export function useDeviceOnline(): boolean {
  const [online, setOnline] = useState(deviceOnline);
  useEffect(() => subscribeDeviceOnline(setOnline), []);
  return online;
}
