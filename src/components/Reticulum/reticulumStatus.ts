import { useEffect, useState } from 'react';
import { Reticulum } from '../../plugins/Reticulum';
import type { ReticulumStatus } from '../../plugins/Reticulum';

export type ReticulumPhase =
  | 'idle'
  | 'starting'
  | 'online'
  | 'connecting'
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
  try {
    await Reticulum.addListener('status', (s) => set({ status: s }));
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
    // event-driven; this poll only reconciles counters. Poll slowly (battery)
    // and not at all while the app is backgrounded — but poll faster for the
    // first 30s so the UI reflects the initial connect promptly.
    const startedAt = Date.now();
    const pollStatus = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const cur = await Reticulum.getStatus();
        set({ status: cur, phase: cur.online ? 'online' : 'connecting' });
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
    default:
      return '#888';
  }
}
