/**
 * Unlock timing breakdown for Copy diagnostics.
 *
 * A slow login is reported after the fact, from a later session, so the last
 * events are mirrored to localStorage. Only step names, durations and short
 * technical details are kept — never passwords, keys or addresses.
 */

export type UnlockTimingEvent = {
  /** Epoch ms when the step finished. */
  at: number;
  /** Short step name, e.g. 'node-check', 'kdf', 'decrypt', 'fingerprint'. */
  step: string;
  /** How long the step took (or how long its caller waited for it). */
  ms: number;
  /** Optional short technical detail, e.g. 'native, 16 jobs, pool 7'. */
  detail?: string;
};

export type UnlockTimingSnapshot = {
  events: UnlockTimingEvent[];
};

const STORAGE_KEY = 'go_unlock_timings_v1';
const MAX_EVENTS = 24;
const MAX_DETAIL_LENGTH = 160;

let events: UnlockTimingEvent[] | null = null;

function load(): UnlockTimingEvent[] {
  if (events) return events;
  events = [];
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      events = parsed
        .filter(
          (e) =>
            e &&
            typeof e.at === 'number' &&
            typeof e.step === 'string' &&
            typeof e.ms === 'number'
        )
        .slice(-MAX_EVENTS);
    }
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return events;
}

function persist(list: UnlockTimingEvent[]): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* best effort */
  }
}

/** Record one finished unlock step. Never throws. */
export function recordUnlockTiming(
  step: string,
  ms: number,
  detail?: string
): void {
  try {
    const list = load();
    const event: UnlockTimingEvent = {
      at: Date.now(),
      step: String(step).slice(0, 40),
      ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : -1,
    };
    if (detail) event.detail = String(detail).slice(0, MAX_DETAIL_LENGTH);
    list.push(event);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
    persist(list);
  } catch {
    /* diagnostics must never break unlock */
  }
}

/** Oldest first. */
export function getUnlockTimingSnapshot(): UnlockTimingSnapshot {
  return { events: load().slice() };
}

/** Test helper: forget the in-memory copy and the stored one. */
export function resetUnlockTimingsForTests(): void {
  events = null;
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
