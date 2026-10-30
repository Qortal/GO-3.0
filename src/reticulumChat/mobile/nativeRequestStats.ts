/**
 * Worker -> native request accounting for Copy diagnostics: round trips per
 * command, timeouts, and replies that arrive after their request timed out
 * (counted instead of silently dropped). Pure; the engine host calls it at
 * the existing settle points. Labels are command action names or
 * `nativefs:<op>`, never ids.
 */
import {
  createLatencyStats,
  noteLatency,
  summarizeLatency,
  type LatencyStats,
  type LatencySummary,
} from './latencyStats';

type NativeRequestLabelStats = {
  label: string;
  /** Replies received (round trips). */
  n: number;
  p50: number;
  p95: number;
  max: number;
  timeouts: number;
  late: number;
};

export type NativeRequestSnapshot = {
  pending: number;
  /** Waiting requests by label, oldest first (top 6). */
  oldestPending: Array<{ label: string; count: number; oldestMs: number }>;
  rtt: LatencySummary | null;
  /** Last 10 minutes. */
  rttRecent: LatencySummary | null;
  /** Top 8, most timeouts first, then most replies. */
  byLabel: NativeRequestLabelStats[];
  timeouts: number;
  lateReplies: number;
  /** Latest a late reply came after its timeout, ms. */
  lateByMaxMs: number;
  unmatchedReplies: number;
  lostOnClose: number;
};

const LABEL_MAX = 32;
const TIMED_OUT_MAX = 512;
const OLDEST_PENDING_MAX = 6;
const BY_LABEL_MAX = 8;
const RECENT_WINDOW_MS = 600_000;

export function createNativeRequestStats() {
  const all = createLatencyStats();
  const labels = new Map<
    string,
    { hist: LatencyStats; timeouts: number; late: number }
  >();
  const timedOut = new Map<string, { label: string; at: number }>();
  let timeouts = 0;
  let late = 0;
  let lateByMax = 0;
  let unmatched = 0;
  let lost = 0;

  const entry = (raw: string) => {
    let l = String(raw || 'unknown').slice(0, 64);
    if (!labels.has(l) && labels.size >= LABEL_MAX) l = 'other';
    let e = labels.get(l);
    if (!e) {
      e = { hist: createLatencyStats(), timeouts: 0, late: 0 };
      labels.set(l, e);
    }
    return e;
  };

  return {
    /** A reply to a request that was still waiting. */
    replied(label: string, startedAt: number, now = Date.now()): void {
      const ms = now - startedAt;
      noteLatency(all, ms, now);
      noteLatency(entry(label).hist, ms, now);
    },
    timedOut(key: string, label: string, now = Date.now()): void {
      timeouts += 1;
      entry(label).timeouts += 1;
      timedOut.delete(key);
      timedOut.set(key, { label, at: now });
      while (timedOut.size > TIMED_OUT_MAX) {
        timedOut.delete(timedOut.keys().next().value as string);
      }
    },
    /** A reply nobody waits for: late when its request timed out, unmatched otherwise. */
    unknownReply(key: string, now = Date.now()): void {
      const t = timedOut.get(key);
      if (!t) {
        unmatched += 1;
        return;
      }
      timedOut.delete(key);
      late += 1;
      entry(t.label).late += 1;
      lateByMax = Math.max(lateByMax, now - t.at);
    },
    lostOnClose(n: number): void {
      if (Number.isFinite(n) && n > 0) lost += n;
    },
    snapshot(
      pending: Iterable<{ label: string; startedAt: number }>,
      now = Date.now()
    ): NativeRequestSnapshot {
      const groups = new Map<string, { count: number; oldestAt: number }>();
      let pendingCount = 0;
      for (const p of pending) {
        pendingCount += 1;
        const label = String(p.label || 'unknown').slice(0, 64);
        const g = groups.get(label);
        if (!g) groups.set(label, { count: 1, oldestAt: p.startedAt });
        else {
          g.count += 1;
          g.oldestAt = Math.min(g.oldestAt, p.startedAt);
        }
      }
      const oldestPending = [...groups]
        .map(([label, g]) => ({
          label,
          count: g.count,
          oldestMs: Math.max(0, now - g.oldestAt),
        }))
        .sort((a, b) => b.oldestMs - a.oldestMs)
        .slice(0, OLDEST_PENDING_MAX);
      const byLabel = [...labels]
        .map(([label, e]): NativeRequestLabelStats => {
          const s = summarizeLatency(e.hist, now);
          return {
            label,
            n: s?.n ?? 0,
            p50: s?.p50 ?? 0,
            p95: s?.p95 ?? 0,
            max: s?.max ?? 0,
            timeouts: e.timeouts,
            late: e.late,
          };
        })
        .sort((a, b) => b.timeouts - a.timeouts || b.n - a.n)
        .slice(0, BY_LABEL_MAX);
      return {
        pending: pendingCount,
        oldestPending,
        rtt: summarizeLatency(all, now),
        rttRecent: summarizeLatency(all, now, RECENT_WINDOW_MS),
        byLabel,
        timeouts,
        lateReplies: late,
        lateByMaxMs: Math.round(lateByMax),
        unmatchedReplies: unmatched,
        lostOnClose: lost,
      };
    },
  };
}
