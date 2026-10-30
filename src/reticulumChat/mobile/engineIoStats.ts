/**
 * Where the engine worker's time goes, for Copy diagnostics: page -> engine
 * RPCs per method, OPFS flushes (every SQLite sync ends in
 * FileSystemSyncAccessHandle.flush), SQLite commits, and Python frames that
 * waited for the worker back to back on the bridge socket.
 *
 * Counters only: nothing here schedules work or logs. Lives in the worker;
 * only the plain snapshot from `getEngineIoStats` crosses to the page.
 */
import {
  createLatencyStats,
  noteLatency,
  summarizeLatency,
  type LatencyStats,
  type LatencySummary,
} from './latencyStats';
import type { SocketEventQueueStats } from './socketEventPump';

const MINUTE_MS = 60_000;
/** Minutes the per-minute rates cover. */
const ENGINE_IO_WINDOW_MINUTES = 10;

/** A count since start plus one-minute slots for the last 10 minutes. */
type RateCounter = {
  total: number;
  firstAt: number;
  slots: Array<{ minute: number; n: number }>;
};

const createRateCounter = (): RateCounter => ({
  total: 0,
  firstAt: 0,
  slots: [],
});

function noteRate(counter: RateCounter, at: number, n = 1): void {
  counter.total += n;
  if (!counter.firstAt) counter.firstAt = at;
  const minute = Math.floor(at / MINUTE_MS);
  let slot = counter.slots[counter.slots.length - 1];
  if (!slot || slot.minute !== minute) {
    slot = { minute, n: 0 };
    counter.slots.push(slot);
    while (counter.slots.length > ENGINE_IO_WINDOW_MINUTES) {
      counter.slots.shift();
    }
  }
  slot.n += n;
}

export type EngineRateSummary = {
  total: number;
  /** Count in the last `minutes` minutes. */
  recent: number;
  /** Minutes `recent` covers: up to 10, fewer right after the first count. */
  minutes: number;
};

function summarizeRate(counter: RateCounter, now: number): EngineRateSummary {
  const minute = Math.floor(now / MINUTE_MS);
  const fromMinute = minute - ENGINE_IO_WINDOW_MINUTES + 1;
  let recent = 0;
  for (const slot of counter.slots) {
    if (slot.minute >= fromMinute && slot.minute <= minute) recent += slot.n;
  }
  return {
    total: counter.total,
    recent,
    minutes: counter.firstAt
      ? Math.min(
          ENGINE_IO_WINDOW_MINUTES,
          Math.max(1, minute - Math.floor(counter.firstAt / MINUTE_MS) + 1)
        )
      : 0,
  };
}

// ── page -> engine RPCs ──────────────────────────────────────────────────────

type RpcMethodStats = {
  n: number;
  errors: number;
  totalMs: number;
  /** Longest synchronous part: the handler call until it returned. */
  syncMaxMs: number;
  latency: LatencyStats;
};

/** Method names come from the page; past this many, new ones count as `other`. */
const RPC_METHODS_MAX = 96;
const rpcMethods = new Map<string, RpcMethodStats>();

/**
 * One finished RPC: `syncMs` is the handler's synchronous part (it blocks the
 * worker), `totalMs` includes awaits (Core requests, native round trips).
 */
export function noteEngineRpc(
  method: string,
  syncMs: number,
  totalMs: number,
  ok: boolean,
  at = Date.now()
): void {
  const raw = /^[\w:.-]{1,64}$/.test(method) ? method : 'other';
  const key =
    rpcMethods.has(raw) || rpcMethods.size < RPC_METHODS_MAX ? raw : 'other';
  let stats = rpcMethods.get(key);
  if (!stats) {
    stats = {
      n: 0,
      errors: 0,
      totalMs: 0,
      syncMaxMs: 0,
      latency: createLatencyStats(),
    };
    rpcMethods.set(key, stats);
  }
  const total = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
  stats.n += 1;
  if (!ok) stats.errors += 1;
  stats.totalMs += total;
  if (Number.isFinite(syncMs)) {
    stats.syncMaxMs = Math.max(stats.syncMaxMs, syncMs);
  }
  noteLatency(stats.latency, total, at);
}

export type EngineRpcMethodSummary = {
  method: string;
  n: number;
  errors: number;
  /** Sum of the whole-call times, ms. */
  totalMs: number;
  /** p95 / max of the whole-call time, since start. */
  p95: number;
  max: number;
  syncMaxMs: number;
};

// ── OPFS flushes and SQLite commits ─────────────────────────────────────────

const flushRate = createRateCounter();
const flushLatency = createLatencyStats();
let flushProbeInstalled = false;

/**
 * Count and time every FileSystemSyncAccessHandle.flush in this worker (the
 * SQLite VFS and the fs shim). Idempotent; false where the API is missing
 * (Node, jsdom, an old WebView).
 */
export function installOpfsFlushProbe(scope: unknown = globalThis): boolean {
  if (flushProbeInstalled) return true;
  const ctor = (scope as { FileSystemSyncAccessHandle?: unknown })
    ?.FileSystemSyncAccessHandle as
    | { prototype?: { flush?: (...args: unknown[]) => unknown } }
    | undefined;
  const proto = ctor?.prototype;
  const original = proto?.flush;
  if (!proto || typeof original !== 'function') return false;
  proto.flush = function flushTimed(this: unknown, ...args: unknown[]) {
    const startedAt = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      noteOpfsFlush(performance.now() - startedAt);
    }
  };
  flushProbeInstalled = true;
  return true;
}

function noteOpfsFlush(ms: number, at = Date.now()): void {
  noteRate(flushRate, at);
  noteLatency(flushLatency, ms, at);
}

const commitRate = createRateCounter();

/** One SQLite commit: a transaction's COMMIT or an autocommit write. */
export function noteSqliteCommit(at = Date.now()): void {
  noteRate(commitRate, at);
}

// ── socket frames ───────────────────────────────────────────────────────────

/**
 * A frame that starts this soon after the previous one ended was already
 * waiting in the worker's queue: a run of them is a backlog, and its length
 * is how deep the queue got.
 */
const BACK_TO_BACK_GAP_MS = 2;
const socketFrameRate = createRateCounter();
let lastFrameEndedAt = -Infinity;
let frameRun = 0;
let maxFrameRun = 0;
let maxFrameRunAt = 0;
/** Longest run per minute, last 10 minutes. */
const frameRunSlots: Array<{ minute: number; max: number }> = [];

/** One bridge-socket frame handled from `startedAt` to `endedAt` (performance.now()). */
export function noteSocketFrame(
  startedAt: number,
  endedAt: number,
  at = Date.now()
): void {
  noteRate(socketFrameRate, at);
  frameRun =
    startedAt - lastFrameEndedAt <= BACK_TO_BACK_GAP_MS ? frameRun + 1 : 1;
  lastFrameEndedAt = endedAt;
  if (frameRun > maxFrameRun) {
    maxFrameRun = frameRun;
    maxFrameRunAt = at;
  }
  const minute = Math.floor(at / MINUTE_MS);
  let slot = frameRunSlots[frameRunSlots.length - 1];
  if (!slot || slot.minute !== minute) {
    slot = { minute, max: 0 };
    frameRunSlots.push(slot);
    while (frameRunSlots.length > ENGINE_IO_WINDOW_MINUTES) {
      frameRunSlots.shift();
    }
  }
  slot.max = Math.max(slot.max, frameRun);
}

// ── snapshot ────────────────────────────────────────────────────────────────

export type EngineIoStats = {
  rpc: {
    calls: number;
    /** Most total time first, at most `limit`. */
    methods: EngineRpcMethodSummary[];
  };
  flush: {
    /** False when the probe could not wrap flush (no OPFS sync handles). */
    installed: boolean;
    rate: EngineRateSummary;
    /** Flush time over the last 10 minutes. */
    recent: LatencySummary | null;
  };
  commits: EngineRateSummary;
  socketFrames: {
    rate: EngineRateSummary;
    /** Most frames handled back to back since start, and when. */
    maxBackToBack: number;
    maxBackToBackAt: number | null;
    /** The same over the last 10 minutes. */
    recentMaxBackToBack: number;
  };
  /**
   * Python event frames waiting for the engine (socketEventPump.ts): depth,
   * age, wait and stale gossip dropped. Filled by engineHost; absent from
   * older workers.
   */
  socketQueue?: SocketEventQueueStats | null;
};

export function getEngineIoStats(now = Date.now(), limit = 5): EngineIoStats {
  let calls = 0;
  const methods: EngineRpcMethodSummary[] = [];
  for (const [method, stats] of rpcMethods) {
    calls += stats.n;
    const summary = summarizeLatency(stats.latency, now);
    methods.push({
      method,
      n: stats.n,
      errors: stats.errors,
      totalMs: Math.round(stats.totalMs),
      p95: summary?.p95 ?? 0,
      max: summary?.max ?? 0,
      syncMaxMs: Math.round(stats.syncMaxMs),
    });
  }
  methods.sort(
    (a, b) => b.totalMs - a.totalMs || a.method.localeCompare(b.method)
  );
  const fromMinute = Math.floor(now / MINUTE_MS) - ENGINE_IO_WINDOW_MINUTES + 1;
  return {
    rpc: { calls, methods: methods.slice(0, Math.max(0, limit)) },
    flush: {
      installed: flushProbeInstalled,
      rate: summarizeRate(flushRate, now),
      recent: summarizeLatency(
        flushLatency,
        now,
        ENGINE_IO_WINDOW_MINUTES * MINUTE_MS
      ),
    },
    commits: summarizeRate(commitRate, now),
    socketFrames: {
      rate: summarizeRate(socketFrameRate, now),
      maxBackToBack: maxFrameRun,
      maxBackToBackAt: maxFrameRunAt || null,
      recentMaxBackToBack: frameRunSlots
        .filter((slot) => slot.minute >= fromMinute)
        .reduce((max, slot) => Math.max(max, slot.max), 0),
    },
  };
}

export function resetEngineIoStatsForTests(): void {
  rpcMethods.clear();
  Object.assign(flushRate, createRateCounter());
  Object.assign(flushLatency, createLatencyStats());
  Object.assign(commitRate, createRateCounter());
  Object.assign(socketFrameRate, createRateCounter());
  lastFrameEndedAt = -Infinity;
  frameRun = 0;
  maxFrameRun = 0;
  maxFrameRunAt = 0;
  frameRunSlots.length = 0;
  flushProbeInstalled = false;
}
