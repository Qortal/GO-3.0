/**
 * Ordered queue for Python event frames that arrive on the bridge socket.
 *
 * Before this, every socket frame ran its engine work inside its own
 * `onmessage` task. A command reply that arrived behind a few hundred event
 * frames waited for all of them, timed out after 25 s and came back late (a
 * field report: 213 timeouts, 213 late replies). Now `onmessage` only parses:
 * replies (`resp`, `fsres`) settle at once, and event frames wait here and
 * are handed to the engine in short slices, so a reply never waits for more
 * than one slice.
 *
 * Event frames keep their relative order. Two things can leave the queue
 * without reaching the engine:
 *  - gossip past the engine's own lifetime for its kind (typing, a public
 *    activity request, a DM notify or probe). The engine would drop these
 *    itself; after a freeze there can be thousands.
 *  - while the queue is long (after a freeze), an older copy of a group state
 *    digest from the same origin, when a newer one is already queued: the
 *    newer state supersedes it. The survivor keeps its own place.
 * Nothing else is ever dropped: no group_sub, nothing that carries an event,
 * no resource or link status.
 *
 * Lives in the engine worker; only the plain `stats()` snapshot leaves it.
 */
import {
  createLatencyStats,
  noteLatency,
  summarizeLatency,
  type LatencySummary,
} from './latencyStats';

/** A parsed `{"type":"event", event, payload, _queuedAtMs?, ... }` frame. */
export type SocketEventFrame = Record<string, any>;

/** Longest a slice keeps handing frames to the engine before it yields. */
export const SOCKET_EVENT_SLICE_MS = 8;
/** Above this many waiting frames, queued digests are merged per origin. */
export const SOCKET_EVENT_COALESCE_ABOVE = 200;

// The engine's own lifetimes (electron/src/reticulum-chat.ts): a frame past
// them is ignored there anyway, so it is not worth the engine's time here.
/** RETICULUM_CHAT_TYPING_TTL_MS: a typing indicator lives 8 s. */
const TYPING_TTL_MS = 8_000;
/** RETICULUM_PUBLIC_ACTIVITY_REQUEST_TTL_MS: the asker stops listening after 30 s. */
const PUBLIC_ACTIVITY_REQUEST_TTL_MS = 30_000;
/** RETICULUM_CHAT_DM_TIMED_WIRE_ACCEPT_TTL_MS: signed DM notify/probe wires. */
const DM_TIMED_WIRE_TTL_MS = 120_000;
/**
 * Python's queue stamp is on the same device clock; one further off than this
 * from our receive time means the clock jumped, and the receive time is used.
 */
const STAMP_MAX_SKEW_MS = 60 * 60_000;
const RECENT_WINDOW_MS = 600_000;
const STALE_KINDS_MAX = 16;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The chat wire of a `reticulum_chat_message` frame, or null. */
function chatWireOf(frame: SocketEventFrame): Record<string, any> | null {
  if (frame?.event !== 'reticulum_chat_message') return null;
  const wire = frame.payload?.wire;
  return wire && typeof wire === 'object' && wire.t === 'RCHAT' ? wire : null;
}

/**
 * When this phone first had the frame: Python's queue stamp when it is
 * sane, else the moment the worker received it.
 */
function localOriginAt(frame: SocketEventFrame, receivedAt: number): number {
  const queuedAt = finite(frame?._queuedAtMs);
  if (
    queuedAt !== null &&
    queuedAt <= receivedAt + 1_000 &&
    receivedAt - queuedAt <= STAMP_MAX_SKEW_MS
  ) {
    return Math.min(queuedAt, receivedAt);
  }
  return receivedAt;
}

/**
 * The wire kind when this frame is gossip past the engine's own lifetime for
 * it at `now`, else null. Signed times are judged exactly as the engine
 * judges them (same clock, same bound), so dropping one here changes
 * nothing the engine would have done. Kinds the engine does not time
 * (DM typing, public activity requests) use how long the frame has been on
 * this phone, so a sender's clock can never make them look old.
 */
export function staleSocketFrameKind(
  frame: SocketEventFrame,
  now: number,
  receivedAt: number
): string | null {
  const wire = chatWireOf(frame);
  if (!wire) return null;
  switch (wire.k) {
    case 'typing': {
      const ts = finite(wire.ts);
      return ts !== null && ts < now - TYPING_TTL_MS ? 'typing' : null;
    }
    case 'dm_typing':
      return now - localOriginAt(frame, receivedAt) > TYPING_TTL_MS
        ? 'dm_typing'
        : null;
    case 'public_activity_req_v1':
      return now - localOriginAt(frame, receivedAt) >
        PUBLIC_ACTIVITY_REQUEST_TTL_MS
        ? 'public_activity_req_v1'
        : null;
    case 'dm_notify': {
      const signedAt = finite(wire.d?.n);
      return signedAt !== null && signedAt < now - DM_TIMED_WIRE_TTL_MS
        ? 'dm_notify'
        : null;
    }
    case 'dm_probe': {
      const signedAt = finite(wire.q?.n);
      return signedAt !== null && signedAt < now - DM_TIMED_WIRE_TTL_MS
        ? 'dm_probe'
        : null;
    }
    default:
      return null;
  }
}

/**
 * `<group>|<origin>` of a group state digest frame, or null for anything
 * else. The origin is the wire's `o` (the node whose state it is); a digest
 * without one is the sender's own.
 */
export function digestCoalesceKey(frame: SocketEventFrame): string | null {
  const wire = chatWireOf(frame);
  if (!wire || wire.k !== 'group_state_digest_v3') return null;
  const groupId = Number(wire.g);
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  if (typeof wire.o === 'string' && wire.o) return `${groupId}|o:${wire.o}`;
  const payload = frame.payload ?? {};
  const sender =
    (typeof payload.peerPresenceHash === 'string' &&
      payload.peerPresenceHash) ||
    (typeof payload.senderDestinationHash === 'string' &&
      payload.senderDestinationHash) ||
    '';
  return sender ? `${groupId}|p:${sender.trim().toLowerCase()}` : null;
}

function digestGeneratedAt(frame: SocketEventFrame): number | null {
  return finite(chatWireOf(frame)?.d?.generatedAt);
}

type Entry = {
  frame: SocketEventFrame;
  receivedAt: number;
  dropped: boolean;
  digestKey: string | null;
};

export type SocketEventQueueStats = {
  /** Frames waiting now, and how long the oldest has waited. */
  depth: number;
  oldestAgeMs: number | null;
  /** Most frames ever waiting, and when. */
  maxDepth: number;
  maxDepthAt: number | null;
  enqueued: number;
  handled: number;
  /** Time from the socket to the engine, since start / last 10 minutes. */
  wait: LatencySummary | null;
  waitRecent: LatencySummary | null;
  slices: number;
  /** Longest slice (one engine handler can overrun the 8 ms budget). */
  maxSliceMs: number;
  /** Frames never handed to the engine: stale gossip plus merged digests. */
  staleGossipDropped: number;
  /** The same per wire kind; merged digests count as group_state_digest_v3. */
  staleGossipByKind: Record<string, number>;
  /** Older digests replaced by a newer one from the same origin. */
  digestsCoalesced: number;
  /** Frames thrown away because the engine stopped. */
  cleared: number;
};

export type SocketEventPumpOptions = {
  /** Hands one frame to the engine. A throw is reported and the pump goes on. */
  handle: (frame: SocketEventFrame) => void;
  /** Runs `run` in a later macrotask (a MessageChannel post in the worker). */
  schedule: (run: () => void) => void;
  /** Wall clock (Date.now): frame ages and wire times. */
  now?: () => number;
  /** Monotonic clock for slice budgets. */
  perfNow?: () => number;
  sliceMs?: number;
  coalesceAbove?: number;
  onError?: (err: unknown) => void;
};

export class SocketEventPump {
  private readonly handle: (frame: SocketEventFrame) => void;
  private readonly schedule: (run: () => void) => void;
  private readonly now: () => number;
  private readonly perfNow: () => number;
  private readonly sliceMs: number;
  private readonly coalesceAbove: number;
  private readonly onError: (err: unknown) => void;

  private items: Array<Entry | undefined> = [];
  private head = 0;
  /** Entries not yet handled and not dropped. */
  private live = 0;
  private scheduled = false;
  /** The newest queued digest per group and origin. */
  private readonly digestByKey = new Map<string, Entry>();

  private enqueued = 0;
  private handled = 0;
  private maxDepth = 0;
  private maxDepthAt = 0;
  private slices = 0;
  private maxSliceMs = 0;
  private staleDropped = 0;
  private readonly staleByKind = new Map<string, number>();
  private digestsCoalesced = 0;
  private cleared = 0;
  private readonly waitStats = createLatencyStats();

  constructor(options: SocketEventPumpOptions) {
    this.handle = options.handle;
    this.schedule = options.schedule;
    this.now = options.now ?? (() => Date.now());
    this.perfNow =
      options.perfNow ??
      (() =>
        typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.sliceMs = options.sliceMs ?? SOCKET_EVENT_SLICE_MS;
    this.coalesceAbove = options.coalesceAbove ?? SOCKET_EVENT_COALESCE_ABOVE;
    this.onError =
      options.onError ??
      ((err) => console.warn('[MobileChat] socket event failed', err));
  }

  /** Queues one event frame received at `receivedAt` (wall clock). */
  push(frame: SocketEventFrame, receivedAt = this.now()): void {
    this.enqueued += 1;
    const digestKey = digestCoalesceKey(frame);
    if (digestKey) {
      const queued = this.digestByKey.get(digestKey);
      if (queued && !queued.dropped && this.live > this.coalesceAbove) {
        const queuedAt = digestGeneratedAt(queued.frame);
        const incomingAt = digestGeneratedAt(frame);
        if (queuedAt !== null && incomingAt !== null && incomingAt < queuedAt) {
          // Relayed out of order: the queued copy is the newer state.
          this.noteDigestCoalesced();
          return;
        }
        queued.dropped = true;
        this.live -= 1;
        this.noteDigestCoalesced();
      }
    }
    const entry: Entry = { frame, receivedAt, dropped: false, digestKey };
    if (digestKey) this.digestByKey.set(digestKey, entry);
    this.items.push(entry);
    this.live += 1;
    if (this.live > this.maxDepth) {
      this.maxDepth = this.live;
      this.maxDepthAt = receivedAt;
    }
    this.scheduleRun();
  }

  get depth(): number {
    return this.live;
  }

  /** Drops everything still waiting (the engine stopped). */
  clear(): void {
    this.cleared += this.live;
    this.items = [];
    this.head = 0;
    this.live = 0;
    this.digestByKey.clear();
  }

  /** Hands every waiting frame to the engine now (tests). */
  drainAll(): void {
    while (this.live > 0) this.runSlice(Infinity);
  }

  stats(now = this.now()): SocketEventQueueStats {
    let oldestAgeMs: number | null = null;
    for (let i = this.head; i < this.items.length; i += 1) {
      const entry = this.items[i];
      if (entry && !entry.dropped) {
        oldestAgeMs = Math.max(0, now - entry.receivedAt);
        break;
      }
    }
    return {
      depth: this.live,
      oldestAgeMs,
      maxDepth: this.maxDepth,
      maxDepthAt: this.maxDepthAt || null,
      enqueued: this.enqueued,
      handled: this.handled,
      wait: summarizeLatency(this.waitStats, now),
      waitRecent: summarizeLatency(this.waitStats, now, RECENT_WINDOW_MS),
      slices: this.slices,
      maxSliceMs: Math.round(this.maxSliceMs * 10) / 10,
      staleGossipDropped: this.staleDropped,
      staleGossipByKind: Object.fromEntries(this.staleByKind),
      digestsCoalesced: this.digestsCoalesced,
      cleared: this.cleared,
    };
  }

  private noteDigestCoalesced(): void {
    this.digestsCoalesced += 1;
    this.noteStale('group_state_digest_v3');
  }

  private noteStale(kind: string): void {
    this.staleDropped += 1;
    const key =
      this.staleByKind.has(kind) || this.staleByKind.size < STALE_KINDS_MAX
        ? kind
        : 'other';
    this.staleByKind.set(key, (this.staleByKind.get(key) ?? 0) + 1);
  }

  private scheduleRun(): void {
    if (this.scheduled || this.live === 0) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      try {
        this.runSlice(this.sliceMs);
      } finally {
        // Whatever happened in the slice, frames left behind get a next one.
        this.scheduleRun();
      }
    });
  }

  private runSlice(budgetMs: number): void {
    const startedAt = this.perfNow();
    let ran = false;
    while (this.head < this.items.length) {
      const entry = this.items[this.head];
      this.items[this.head] = undefined;
      this.head += 1;
      if (!entry || entry.dropped) continue;
      this.live -= 1;
      if (entry.digestKey && this.digestByKey.get(entry.digestKey) === entry) {
        this.digestByKey.delete(entry.digestKey);
      }
      const now = this.now();
      noteLatency(this.waitStats, now - entry.receivedAt, now);
      const staleKind = staleSocketFrameKind(
        entry.frame,
        now,
        entry.receivedAt
      );
      if (staleKind) {
        this.noteStale(staleKind);
      } else {
        ran = true;
        this.handled += 1;
        try {
          this.handle(entry.frame);
        } catch (err) {
          try {
            this.onError(err);
          } catch {
            /* reporting must not stop the pump */
          }
        }
      }
      if (this.perfNow() - startedAt >= budgetMs) break;
    }
    if (this.head >= this.items.length) {
      this.items = [];
      this.head = 0;
    } else if (this.head > 1_024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    this.slices += 1;
    if (ran) {
      this.maxSliceMs = Math.max(this.maxSliceMs, this.perfNow() - startedAt);
    }
  }
}

/**
 * A macrotask scheduler for the pump: a MessageChannel post (no 4 ms timer
 * clamp, and other tasks such as socket replies run in between), else
 * setTimeout 0.
 */
export function createMacrotaskScheduler(): (run: () => void) => void {
  if (typeof MessageChannel === 'function') {
    try {
      const channel = new MessageChannel();
      let pending: Array<() => void> = [];
      channel.port1.onmessage = () => {
        const runs = pending;
        pending = [];
        for (const run of runs) {
          try {
            run();
          } catch (err) {
            console.warn('[MobileChat] scheduled task failed', err);
          }
        }
      };
      // Node (tests) keeps the process alive for an open port; browsers have no unref.
      (channel.port1 as unknown as { unref?: () => void }).unref?.();
      return (run) => {
        pending.push(run);
        channel.port2.postMessage(null);
      };
    } catch {
      /* fall through to timers */
    }
  }
  return (run) => {
    setTimeout(run, 0);
  };
}
