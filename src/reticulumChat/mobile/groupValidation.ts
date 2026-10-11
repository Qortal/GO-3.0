/**
 * Qortal group-membership validation for the mobile chat worker: the Core
 * request, its outcome, and the counters "Copy diagnostics" prints about it.
 *
 * Pure (fetch is injectable), so the main thread can share the types and the
 * request can be tested without a worker.
 *
 * `POST /groups/members/{id}/validate` is public on Core and needs no API key.
 * Sending one is not just unnecessary: the worker's fetch is a real
 * cross-origin WebView request (page origin http://localhost, Core on
 * localhost:<port> or a remote host), and Core's CORS preflight does not allow
 * the X-API-KEY header. A keyed request failed with "Failed to fetch" before it
 * was sent, every membership check came back unavailable, and group chat went
 * dark for anyone whose node has an API key (v0.0.6 to v0.0.12). So the request
 * carries Content-Type only, and never the key, in a header or in the URL.
 */

/** Per-request budget; matches the engine's expectations for a slow node. */
export const GROUP_VALIDATION_TIMEOUT_MS = 12_000;
/** An abort timer this late found the worker stalled, not Core slow. */
export const GROUP_VALIDATION_LATE_TIMER_MS = 1_000;
/** One extra wait for a reply that may already sit behind that stall. */
export const GROUP_VALIDATION_GRACE_MS = 1_500;
/** How many recent answers keep their network / worker-wait times. */
export const GROUP_VALIDATION_RECENT_TIMINGS = 32;

export type GroupValidationRow = { isMember: boolean; isAdmin: boolean };

/** Node settings the worker needs. The API key itself never crosses over. */
export type WorkerNodeConfig = {
  apiBase: string;
  /** Whether the saved node has an API key; `null` until the main thread knows. */
  apiKeyConfigured: boolean | null;
};

/**
 * Build the worker's node config from a `boot`/`config` message. Only known
 * fields are copied, so an `apiKey` pushed by an older main thread (or kept
 * from a previous push by a spread merge) cannot survive into the worker.
 */
export function toWorkerNodeConfig(
  raw: unknown,
  previous?: WorkerNodeConfig
): WorkerNodeConfig {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const apiBase =
    typeof record.apiBase === 'string' && record.apiBase.trim()
      ? record.apiBase.trim()
      : (previous?.apiBase ?? '');
  const pushed = record.apiKeyConfigured;
  const apiKeyConfigured =
    typeof pushed === 'boolean'
      ? pushed
      : pushed === null
        ? null
        : (previous?.apiKeyConfigured ?? null);
  return { apiBase, apiKeyConfigured };
}

/** `host:port` of a Core base URL; never the path, query or credentials. */
export function apiHostOf(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return '';
  }
}

/** `http` / `https` of a Core base URL, `''` when it does not parse. */
export function apiSchemeOf(apiBase: string): string {
  try {
    return new URL(apiBase).protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}

/**
 * The validation request. Only scheme, host and path of `apiBase` are kept, so
 * nothing in its query string (or userinfo) is ever forwarded.
 */
export function buildGroupValidationRequest(
  apiBase: string,
  groupId: number,
  address: string
): { url: string; init: RequestInit } {
  let base = String(apiBase || '').trim();
  try {
    const parsed = new URL(base);
    base = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    base = base.replace(/[?#].*$/, '');
  }
  base = base.replace(/\/+$/, '');
  return {
    url: `${base}/groups/members/${groupId}/validate`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([address]),
    },
  };
}

/** Error text safe to paste publicly: no URLs, no key parameters. */
export function redactDiagnosticText(text: string): string {
  return String(text ?? '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '<url>')
    .replace(
      /(api[-_]?key["']?\s*[:=]\s*["']?)[^\s&"',;)\]}]+/gi,
      '$1<redacted>'
    );
}

function describeError(err: unknown): string {
  if (err instanceof Error || (err && typeof err === 'object')) {
    const name = String((err as { name?: unknown }).name || 'Error');
    const message = String((err as { message?: unknown }).message || '');
    return redactDiagnosticText(message ? `${name}: ${message}` : name);
  }
  return redactDiagnosticText(String(err));
}

export type GroupValidationOutcome = {
  /** Parsed row; `null` means "unavailable" to the engine. */
  row: GroupValidationRow | null;
  /** HTTP status, `null` when no response arrived. */
  status: number | null;
  /** `Name: message` of the failure, `null` on success. */
  error: string | null;
  ms: number;
  /**
   * Browser-side request time (Resource Timing responseEnd - startTime:
   * socket wait + Core), unaffected by worker stalls; null/absent when not
   * measured.
   */
  networkMs?: number | null;
  /** The abort timer ran late (worker stall) and was re-armed once. */
  graced?: boolean;
  /** How late that timer ran, ms (graced only). */
  timerLateMs?: number;
  /** Ended by the abort timer. */
  timedOut?: boolean;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type ResourceTimingEntryLike = { startTime: number; responseEnd?: number };
/** The part of `performance` the network-time read uses (injectable for tests). */
export type ResourceTimingSource = {
  now(): number;
  getEntriesByName(
    name: string,
    type?: string
  ): ArrayLike<ResourceTimingEntryLike>;
  getEntriesByType?(type: string): ArrayLike<unknown>;
  clearResourceTimings?(): void;
};

function defaultResourceTiming(): ResourceTimingSource | null {
  const perf = (globalThis as { performance?: Partial<ResourceTimingSource> })
    .performance;
  return perf &&
    typeof perf.now === 'function' &&
    typeof perf.getEntriesByName === 'function'
    ? (perf as ResourceTimingSource)
    : null;
}

const claimedTimingEntries = new WeakSet<object>();
/** Chromium buffers 250 resource entries, then drops new ones; nothing else in the worker reads them. */
const RESOURCE_TIMING_CLEAR_AT = 200;

/**
 * The request's own Resource Timing entry: the earliest unclaimed one for
 * this URL that started at or after the request did. Null when the browser
 * keeps none (jsdom, Node, an old WebView) or none matches.
 */
function readNetworkMs(
  perf: ResourceTimingSource | null,
  url: string,
  perfStart: number
): number | null {
  if (!perf) return null;
  try {
    let name = url;
    try {
      name = new URL(url).href;
    } catch {
      /* keep url */
    }
    let best: ResourceTimingEntryLike | null = null;
    for (const entry of Array.from(perf.getEntriesByName(name, 'resource'))) {
      if (claimedTimingEntries.has(entry as object)) continue;
      const end = Number(entry.responseEnd);
      if (
        !(entry.startTime >= perfStart - 1) ||
        !(end > 0) ||
        end < entry.startTime
      ) {
        continue;
      }
      if (!best || entry.startTime < best.startTime) best = entry;
    }
    if (best) claimedTimingEntries.add(best as object);
    // Also when nothing matched: a full buffer records no new entries, so
    // nothing would ever match (and clear it) again.
    trimResourceTimings(perf);
    if (!best) return null;
    return Math.max(0, Math.round(Number(best.responseEnd) - best.startTime));
  } catch {
    return null;
  }
}

/** Keeps room in the buffer: Chromium drops new entries once it is full. */
function trimResourceTimings(perf: ResourceTimingSource | null): void {
  if (!perf) return;
  try {
    if (
      (perf.getEntriesByType?.('resource')?.length ?? 0) >
      RESOURCE_TIMING_CLEAR_AT
    ) {
      perf.clearResourceTimings?.();
    }
  } catch {
    /* timing is best effort */
  }
}

/** Run the production request once. Never throws. */
export async function runGroupValidationRequest(
  apiBase: string,
  groupId: number,
  address: string,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    now?: () => number;
    /** Network-time source; `undefined` = the global `performance`, `null` = off. */
    resourceTiming?: ResourceTimingSource | null;
  } = {}
): Promise<GroupValidationOutcome> {
  const now = options.now ?? Date.now;
  const started = now();
  if (!String(apiBase || '').trim()) {
    return { row: null, status: null, error: 'no Core API base', ms: 0 };
  }
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? GROUP_VALIDATION_TIMEOUT_MS;
  const perf =
    options.resourceTiming === undefined
      ? defaultResourceTiming()
      : options.resourceTiming;
  const { url, init } = buildGroupValidationRequest(apiBase, groupId, address);
  const controller = new AbortController();
  let timedOut = false;
  let graced = false;
  let timerLateMs = 0;
  const deadline = started + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onTimer = () => {
    const late = now() - deadline;
    if (!graced && late > GROUP_VALIDATION_LATE_TIMER_MS) {
      // The worker was busy past the deadline, so a reply may already be
      // queued behind this timer task (Chromium runs the late timer first).
      graced = true;
      timerLateMs = Math.round(late);
      timer = setTimeout(onTimer, GROUP_VALIDATION_GRACE_MS);
      return;
    }
    timedOut = true;
    controller.abort();
  };
  timer = setTimeout(onTimer, timeoutMs);
  let perfStart = 0;
  try {
    perfStart = perf ? perf.now() : 0;
  } catch {
    perfStart = 0;
  }
  const flags = () => ({
    ...(graced ? { graced: true, timerLateMs } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  });
  let status: number | null = null;
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    status = res.status;
    if (!res.ok) {
      return {
        row: null,
        status,
        error: `HTTP ${status}`,
        ms: now() - started,
        networkMs: readNetworkMs(perf, url, perfStart),
        ...flags(),
      };
    }
    const rows = await res.json();
    const networkMs = readNetworkMs(perf, url, perfStart);
    if (!Array.isArray(rows)) {
      return {
        row: null,
        status,
        error: 'unexpected response body',
        ms: now() - started,
        networkMs,
        ...flags(),
      };
    }
    const row = rows.find(
      (item: any) => String(item?.address || '').trim() === address
    );
    return {
      row: { isAdmin: row?.isAdmin === true, isMember: row?.isMember === true },
      status,
      error: null,
      ms: now() - started,
      networkMs,
      ...flags(),
    };
  } catch (err) {
    // A body that does not parse (a captive portal's HTML) or a network
    // error leaves its entry unread; keep the buffer from filling up.
    trimResourceTimings(perf);
    return {
      row: null,
      status,
      error: timedOut
        ? graced
          ? `AbortError: no answer in ${timeoutMs} ms (worker stalled ${timerLateMs} ms; grace ${GROUP_VALIDATION_GRACE_MS} ms)`
          : `AbortError: no answer in ${timeoutMs} ms`
        : describeError(err),
      ms: now() - started,
      ...flags(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** What the engine's membership checks have seen since the worker booted. */
export type GroupValidatorStats = {
  okCount: number;
  unavailableCount: number;
  lastStatus: number | null;
  lastMs: number | null;
  lastAt: number | null;
  /** Last failure; kept after later successes so intermittent faults show. */
  lastError: string | null;
  lastErrorAt: number | null;
  /** `host:port` of the last request. */
  host: string;
  // Optional, so reports from an older worker (and old fixtures) still fit.
  timedOutCount?: number;
  gracedCount?: number;
  /** Graced requests that still got their answer. */
  gracedKeptCount?: number;
  maxTimerLateMs?: number;
  /** Most validator fetches in flight at once (Chromium allows 6 per HTTP/1.1 host, shared with the page). */
  maxInFlight?: number;
  /** Requests for the local signer's own address. */
  ownCount?: number;
  ownUnavailableCount?: number;
  /** Engine counters merged in at snapshot time (1.4). */
  ownListAnswers?: number;
  ownBootWaits?: number;
  ownBootWaitTimeouts?: number;
  ownCoreDenied?: number;
  /**
   * Last GROUP_VALIDATION_RECENT_TIMINGS answers with a Resource Timing
   * entry: network time, and the time the answer then waited for the worker.
   */
  recentNetworkMs?: number[];
  recentWorkerWaitMs?: number[];
};

export function createGroupValidatorStats(): GroupValidatorStats {
  return {
    okCount: 0,
    unavailableCount: 0,
    lastStatus: null,
    lastMs: null,
    lastAt: null,
    lastError: null,
    lastErrorAt: null,
    host: '',
    timedOutCount: 0,
    gracedCount: 0,
    gracedKeptCount: 0,
    maxTimerLateMs: 0,
    maxInFlight: 0,
    ownCount: 0,
    ownUnavailableCount: 0,
    ownListAnswers: 0,
    ownBootWaits: 0,
    ownBootWaitTimeouts: 0,
    ownCoreDenied: 0,
    recentNetworkMs: [],
    recentWorkerWaitMs: [],
  };
}

export function recordGroupValidation(
  stats: GroupValidatorStats,
  outcome: GroupValidationOutcome,
  host: string,
  at = Date.now(),
  options: { own?: boolean } = {}
): void {
  if (outcome.row) stats.okCount += 1;
  else stats.unavailableCount += 1;
  stats.lastStatus = outcome.status;
  stats.lastMs = outcome.ms;
  stats.lastAt = at;
  stats.host = host;
  if (outcome.error) {
    stats.lastError = outcome.error;
    stats.lastErrorAt = at;
  }
  if (outcome.timedOut) stats.timedOutCount = (stats.timedOutCount ?? 0) + 1;
  if (outcome.graced) {
    stats.gracedCount = (stats.gracedCount ?? 0) + 1;
    if (outcome.row) stats.gracedKeptCount = (stats.gracedKeptCount ?? 0) + 1;
    stats.maxTimerLateMs = Math.max(
      stats.maxTimerLateMs ?? 0,
      Math.round(outcome.timerLateMs ?? 0)
    );
  }
  if (options.own) {
    stats.ownCount = (stats.ownCount ?? 0) + 1;
    if (!outcome.row) {
      stats.ownUnavailableCount = (stats.ownUnavailableCount ?? 0) + 1;
    }
  }
  if (
    typeof outcome.networkMs === 'number' &&
    Number.isFinite(outcome.networkMs)
  ) {
    const net = (stats.recentNetworkMs ??= []);
    const wait = (stats.recentWorkerWaitMs ??= []);
    net.push(outcome.networkMs);
    wait.push(Math.max(0, Math.round(outcome.ms - outcome.networkMs)));
    if (net.length > GROUP_VALIDATION_RECENT_TIMINGS) {
      net.splice(0, net.length - GROUP_VALIDATION_RECENT_TIMINGS);
    }
    if (wait.length > GROUP_VALIDATION_RECENT_TIMINGS) {
      wait.splice(0, wait.length - GROUP_VALIDATION_RECENT_TIMINGS);
    }
  }
}

/** Result of the `debug:membership-probe` worker RPC. */
export type MembershipProbeResult = {
  host: string;
  groupId: number | null;
  status: number | null;
  /** The request produced a membership answer (whatever it was). */
  ok: boolean;
  isMember: boolean | null;
  error: string | null;
  ms: number;
  /** No request was sent (no local group to check yet); `error` says why. */
  skipped?: boolean;
};

export function membershipProbeResult(
  outcome: GroupValidationOutcome,
  host: string,
  groupId: number | null
): MembershipProbeResult {
  return {
    host,
    groupId,
    status: outcome.status,
    ok: outcome.row !== null,
    isMember: outcome.row ? outcome.row.isMember : null,
    error: outcome.error,
    ms: outcome.ms,
  };
}
