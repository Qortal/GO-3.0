import { useEffect, useState } from 'react';
import { Reticulum } from '../../plugins/Reticulum';
import type { ReticulumStatus } from '../../plugins/Reticulum';
import { QortalBackground } from '../../plugins/QortalBackground';
import { isCapacitor } from '../../utils/platform';

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
}

// Single shared transport lifecycle: no matter how many UI surfaces (top-bar
// badge, diagnostic chip) subscribe, Reticulum.start() + polling happens once.
let current: ReticulumState = { phase: 'idle', status: null, error: null };
let started = false;
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

async function ensureStarted() {
  if (started || !startAllowed) return;
  started = true;
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
        set({ status: cur, phase: phaseFor(cur.online) });
      } catch {
        /* transient */
      }
    };
    const scheduleNext = () => {
      const interval = Date.now() - startedAt < 30_000 ? 3_000 : 20_000;
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
  if (!deviceOnline || phase === 'offline' || phase === 'error') {
    return phase === 'error' ? 'error' : 'offline';
  }
  if (onlineCount > 0) return 'online';
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
