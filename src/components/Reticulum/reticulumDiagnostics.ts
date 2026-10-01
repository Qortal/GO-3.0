/**
 * "Copy diagnostics" for the Reticulum badge: one plain-text report a phone
 * user can paste into a chat, covering the radio, the chat engine, the
 * WebView's capabilities and speed, Core API reachability, the last send
 * failures, the last unlock timings and the engine's own log tail.
 *
 * Built for remote reports (GrapheneOS in particular, where WebView JIT can
 * be off per app): every value here is one the app cannot otherwise show and
 * that decides which fix applies.
 *
 * Users paste this publicly: it names hosts (host:port) but never a URL or an
 * API key; a key is only ever reported as set / not set. The formatter is
 * pure; only the probes and `collectReticulumDiagnostics` touch the
 * environment.
 */
import { GO_VERSION } from '../../appVersion';
import { getBaseApiReact } from '../../utils/globalApi';
import {
  getRecentSendFailures,
  type SendFailureRecord,
} from '../../messaging/sendFailureLog';
import {
  getMobileReticulumChatDiagnostics,
  type GroupValidatorStats,
  type MembershipProbeResult,
  type MobileReticulumChatDiagnostics,
  type ResourceSessionStats,
} from '../../reticulumChat/mobile';
import { redactDiagnosticText } from '../../reticulumChat/mobile/groupValidation';
import {
  getNativeBcryptRuntimeInfo,
  type NativeBcryptRuntimeInfo,
} from '../../utils/nativeBcrypt';
import {
  getUnlockTimingSnapshot,
  type UnlockTimingEvent,
} from '../../utils/unlockTimings';
import {
  chatEngineStateAgeSec,
  reticulumDisplayLabel,
  reticulumDisplayPhase,
  type ReticulumState,
} from './reticulumStatus';

export type WebViewProbe = {
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  webAssembly: boolean;
  opfs: boolean;
  crossOriginIsolated: boolean;
  /**
   * Tight integer loop. A weak JIT hint only: CPU speed and load move it about
   * as much as JIT does (node measured ~2.4x between JIT and --jitless).
   */
  jsLoopMs: number;
};

export type CoreApiProbe = {
  host: string;
  /** `http` / `https`; compared with the membership checks' base. */
  scheme?: string;
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  error?: string;
};

export type UnlockDiagnostics = {
  /** Oldest first, from `getUnlockTimingSnapshot`. */
  events: UnlockTimingEvent[];
  /** Null off native Android, on a plugin error or a timeout. */
  runtime: NativeBcryptRuntimeInfo | null;
};

export type ReticulumDiagnosticsInput = {
  now: number;
  version: string;
  state: ReticulumState;
  onlineCount: number;
  deviceOnline: boolean;
  webView: WebViewProbe;
  engine: MobileReticulumChatDiagnostics | null;
  coreApi: CoreApiProbe | null;
  sendFailures: SendFailureRecord[];
  unlock?: UnlockDiagnostics | null;
};

export type JitEvidence = {
  webAssembly: boolean;
  sqliteInitMs?: number | null;
  bootMs?: number | null;
};

export type JitVerdict = {
  verdict: 'likely on' | 'likely off' | 'unclear';
  basis: string;
};

/** sqlite-wasm init: stock WebViews take well under a second. */
const JIT_ON_SQLITE_INIT_MS = 1_500;
/** Same threshold as the slow-storage hint in shims/better-sqlite3.ts. */
const JIT_OFF_SQLITE_INIT_MS = 4_000;
const JIT_ON_BOOT_MS = 5_000;
const JIT_OFF_BOOT_MS = 20_000;

function finiteMs(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Whether the WebView runs with JIT, from the evidence that decides it:
 * WebAssembly presence, then the sqlite-wasm init time, then the engine boot
 * time. The JS loop probe is not used; it cannot tell the two apart reliably.
 */
export function jitVerdict(evidence: JitEvidence): JitVerdict {
  if (!evidence.webAssembly) {
    return { verdict: 'likely off', basis: 'WebAssembly missing' };
  }
  const sqlite = finiteMs(evidence.sqliteInitMs);
  if (sqlite != null && sqlite <= JIT_ON_SQLITE_INIT_MS) {
    return {
      verdict: 'likely on',
      basis: `WebAssembly present, sqlite-wasm init ${fmtMs(sqlite)}`,
    };
  }
  if (sqlite != null && sqlite >= JIT_OFF_SQLITE_INIT_MS) {
    return {
      verdict: 'likely off',
      basis: `sqlite-wasm init ${fmtMs(sqlite)}`,
    };
  }
  const boot = finiteMs(evidence.bootMs);
  if (boot != null && boot <= JIT_ON_BOOT_MS) {
    return {
      verdict: 'likely on',
      basis: `WebAssembly present, engine boot ${fmtMs(boot)}`,
    };
  }
  if (boot != null && boot >= JIT_OFF_BOOT_MS) {
    return { verdict: 'likely off', basis: `engine boot ${fmtMs(boot)}` };
  }
  return {
    verdict: 'unclear',
    basis:
      sqlite != null || boot != null
        ? `WebAssembly present; sqlite-wasm init ${fmtMs(sqlite)}, engine boot ${fmtMs(boot)}`
        : 'WebAssembly present; no engine timings yet',
  };
}

export function jsLoopProbeMs(iterations = 3_000_000): number {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < iterations; i++) x = (x * 31 + i) | 0;
  // Keep the loop observable so an optimiser cannot drop it.
  if (x === 0x7fffffff) console.debug('[ReticulumDiagnostics] probe', x);
  return Math.round(performance.now() - t0);
}

export function probeWebView(): WebViewProbe {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const storage = (nav as { storage?: { getDirectory?: unknown } }).storage;
  return {
    userAgent: nav.userAgent || '',
    hardwareConcurrency: Number.isFinite(nav.hardwareConcurrency)
      ? nav.hardwareConcurrency
      : null,
    deviceMemoryGb:
      typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    webAssembly: typeof WebAssembly !== 'undefined',
    opfs: typeof storage?.getDirectory === 'function',
    crossOriginIsolated: Boolean(
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ),
    jsLoopMs: jsLoopProbeMs(),
  };
}

export async function probeCoreApi(timeoutMs = 6_000): Promise<CoreApiProbe> {
  let base = '';
  try {
    base = getBaseApiReact().replace(/\/$/, '');
  } catch {
    base = '';
  }
  let host = '';
  let scheme = '';
  try {
    const parsed = new URL(base);
    host = parsed.host;
    scheme = parsed.protocol.replace(/:$/, '');
  } catch {
    host = base;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/admin/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      host,
      scheme,
      ok: res.ok,
      httpStatus: res.status,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      host,
      scheme,
      ok: false,
      httpStatus: null,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The plugin's build and Java speed facts. The probe waits behind a running
 * KDF batch on the same pool, so it is bounded.
 */
export async function probeUnlockRuntime(
  timeoutMs = 3_000
): Promise<NativeBcryptRuntimeInfo | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([
      getNativeBcryptRuntimeInfo().catch(() => null),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fmtMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function fmtMb(bytes: number | undefined): string {
  const v = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtAgo(at: number | null | undefined, now: number): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return 'n/a';
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 120) return `${sec} s ago`;
  if (sec < 7_200) return `${Math.round(sec / 60)} min ago`;
  return `${Math.round(sec / 3_600)} h ago`;
}

// ── engine log selection ─────────────────────────────────────────────────────

/**
 * Engine log lines worth keeping when the ring has scrolled past them. Covers
 * membership, bridge overload/pauses, peer violations, refusals and give-ups.
 */
const ENGINE_FAULT_RE =
  /error|fail|slow_|timed out|membership|validat|corrupt|unavailable|overloaded|paused|violation|refusing|not a group member|giving up|deferred=[1-9]/i;
/** Zero counters (`membership_deferred=0` on every page import) are not faults. */
const ZERO_DEFERRED_RE = /\b\w*deferred=0\b/gi;
const NONZERO_DEFERRED_RE = /deferred=[1-9]/i;
/** Level token after the optional timestamp, as written by the worker logger. */
const LOG_LEVEL_RE =
  /^(?:\d{4}-\d\d-\d\dT\S+\s+)?(log|info|debug|warn|error)\s/i;
/**
 * Timing warnings (`digest_send_slow`, `author_tree_worker_fallback`) fill the
 * first seconds after every boot on a healthy phone and say nothing about why
 * chat fails; boot time and sqlite init already cover slowness.
 */
const PERF_NOISE_RE = /_slow\b|_worker_fallback\b/i;

/**
 * Only warn/error lines are faults. Log-level lines such as
 * `author_gap_link_unavailable reason=no_history_events` are routine answers
 * from peers; the exception is a non-zero membership deferral count.
 */
export function isEngineFaultLine(line: string): boolean {
  const text = String(line).replace(ZERO_DEFERRED_RE, '');
  if (NONZERO_DEFERRED_RE.test(text)) return true;
  const level = LOG_LEVEL_RE.exec(text)?.[1]?.toLowerCase();
  if (level && level !== 'warn' && level !== 'error') return false;
  if (PERF_NOISE_RE.test(text)) return false;
  return ENGINE_FAULT_RE.test(text);
}

/** `key=value` pairs whose value names a group, peer, author, transfer or id. */
const ENGINE_LOG_ID_PAIR_RE =
  /\b(group(?:_?id)?|peer|active_?peer|author|address|requester|root|transfer|id|event_?id|link_?id|request_?id|dest(?:ination)?(?:_?hash)?|hash)=[^\s,;:&)\]]+/gi;

/**
 * What makes two log lines "the same" for collapsing: the text without its
 * timestamp, with identifiers blanked out (timestamps, addresses, UUIDs, hex
 * hashes, group/peer/id values). Counters, durations and status codes stay,
 * so `inserted=0` never merges into `inserted=20` and HTTP 404 never hides a
 * later HTTP 500. Hex needs one letter to count as a hash, not a counter.
 */
export function engineLogLineKey(line: string): string {
  return String(line)
    .replace(/^\d{4}-\d\d-\d\dT\S+\s+/, '')
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?/g, 'T')
    .replace(/\b1[5-9]\d{11}\b/g, 'T')
    .replace(ENGINE_LOG_ID_PAIR_RE, '$1=*')
    .replace(/\bQ[1-9A-HJ-NP-Za-km-z]{25,34}\b/g, 'Q*')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '#'
    )
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '#');
}

function logLineTime(line: string): string {
  return /^\d{4}-\d\d-\d\dT(\d\d:\d\d:\d\d(?:\.\d+)?)/.exec(line)?.[1] ?? '';
}

/**
 * Collapse repeats into their first line plus `[xN until <time>]`. Lines only
 * merge when they differ in identifiers alone (see `engineLogLineKey`), so the
 * first line stands for all of them. A line merges into a matching entry among
 * the last `window` entries: window 1 collapses strictly consecutive repeats
 * and a small window also folds interleaved pairs (a validation failure and
 * the refusal it causes).
 */
export function collapseEngineLogLines(lines: string[], window = 1): string[] {
  const entries: Array<{
    line: string;
    key: string;
    count: number;
    last: string;
    groups: Set<string>;
  }> = [];
  for (const raw of lines) {
    const line = String(raw);
    const key = engineLogLineKey(line);
    const group = /\bgroup=(\d+)/.exec(line)?.[1];
    let hit: (typeof entries)[number] | undefined;
    for (
      let i = entries.length - 1;
      i >= Math.max(0, entries.length - Math.max(1, window));
      i--
    ) {
      if (entries[i].key === key) {
        hit = entries[i];
        break;
      }
    }
    if (hit) {
      hit.count += 1;
      hit.last = line;
      if (group) hit.groups.add(group);
      continue;
    }
    entries.push({
      line,
      key,
      count: 1,
      last: line,
      groups: new Set(group ? [group] : []),
    });
  }
  return entries.map(({ line, count, last, groups }) => {
    if (count === 1) return line;
    const until = logLineTime(last);
    const groupList =
      groups.size > 1 ? `; groups ${[...groups].slice(0, 8).join(',')}` : '';
    return `${line} [x${count}${until ? ` until ${until}` : ''}${groupList}]`;
  });
}

export const ENGINE_LOG_TAIL_LINES = 60;
const ENGINE_LOG_MAX_FAULT_ENTRIES = 40;
const ENGINE_LOG_MAX_BOOT_ENTRIES = 40;

/**
 * The "Engine log" section: first warnings since boot that the recent ring no
 * longer holds, then faults from the ring before its tail, then the tail.
 * Repeats are collapsed in each part.
 */
export function selectEngineLogLines(
  ring: string[],
  bootFaults: string[] = []
): string[] {
  const lines = ring.map((l) => String(l));
  const tail = lines.slice(-ENGINE_LOG_TAIL_LINES);
  const beforeTail = lines.slice(0, -ENGINE_LOG_TAIL_LINES);
  // ISO timestamps sort as strings: keep boot lines older than the ring.
  const ringStart = /^\S+/.exec(lines[0] ?? '')?.[0] ?? '';
  const bootOnly = bootFaults
    .map((l) => String(l))
    .filter((l) => !ringStart || (/^\S+/.exec(l)?.[0] ?? '') < ringStart)
    .filter(isEngineFaultLine);
  const boot = collapseEngineLogLines(bootOnly, 3).slice(
    0,
    ENGINE_LOG_MAX_BOOT_ENTRIES
  );
  const faults = collapseEngineLogLines(
    beforeTail.filter(isEngineFaultLine),
    3
  ).slice(-ENGINE_LOG_MAX_FAULT_ENTRIES);
  const out: string[] = [];
  if (boot.length) out.push('-- first warnings since boot --', ...boot);
  if (faults.length) out.push('-- recent faults --', ...faults);
  if (tail.length) {
    if (out.length) out.push(`-- last ${tail.length} lines --`);
    out.push(...collapseEngineLogLines(tail, 1));
  }
  return out;
}

// ── membership, node and bridge lines ────────────────────────────────────────

export function formatNodeApiKeyLine(configured: boolean | null): string {
  return `Node API key: ${
    configured === true ? 'set' : configured === false ? 'not set' : 'unknown'
  }`;
}

export function formatMembershipProbeLine(
  probe: MembershipProbeResult | null,
  engineReady: boolean
): string {
  if (!probe) {
    return `Membership check: not run (${
      engineReady ? 'no result' : 'engine not ready'
    })`;
  }
  // No request was sent (nothing to check yet): not a validator failure.
  if (probe.skipped) {
    return `Membership check: not run (${redactDiagnosticText(
      probe.error || 'nothing to check'
    )})`;
  }
  const via = `via ${probe.host || 'unknown host'}`;
  const group = probe.groupId != null ? `, group ${probe.groupId}` : '';
  if (probe.ok) {
    const answer =
      probe.isMember === true
        ? 'member'
        : probe.isMember === false
          ? 'NOT a member'
          : 'no answer';
    return `Membership check: ok (${answer}) in ${fmtMs(probe.ms)} ${via}${group}`;
  }
  const reason = redactDiagnosticText(
    probe.error ||
      (probe.status != null ? `HTTP ${probe.status}` : 'unknown error')
  );
  return `Membership check: FAILED ${reason} in ${fmtMs(probe.ms)} ${via}${group}`;
}

export function formatValidatorLine(
  stats: GroupValidatorStats | null,
  now: number
): string {
  if (!stats) return 'Membership validator: not reported';
  if (stats.okCount === 0 && stats.unavailableCount === 0) {
    return 'Membership validator: no checks yet';
  }
  const parts = [
    `Membership validator: ${stats.okCount} ok, ${stats.unavailableCount} unavailable`,
  ];
  parts.push(
    `last ${
      stats.lastStatus != null ? `HTTP ${stats.lastStatus}` : 'no response'
    } in ${fmtMs(stats.lastMs)}, ${fmtAgo(stats.lastAt, now)}${
      stats.host ? ` via ${stats.host}` : ''
    }`
  );
  if (stats.lastError) {
    parts.push(
      `last error ${redactDiagnosticText(stats.lastError)}, ${fmtAgo(
        stats.lastErrorAt,
        now
      )}`
    );
  }
  return parts.join('; ');
}

function countEntries(record: unknown): Array<[string, number]> {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record as Record<string, unknown>)
    .map(([key, value]): [string, number] => [
      String(key)
        .replace(/^reticulum_chat_/, '')
        .replace(/\s+/g, '_')
        .slice(0, 64),
      Number(value),
    ])
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b[1] - a[1]);
}

const RESOURCE_RESULT_ENTRIES = 8;

export function formatResourceSessionsLine(
  stats: ResourceSessionStats | null | undefined
): string {
  if (!stats || typeof stats !== 'object') {
    return 'Resource sessions: not reported';
  }
  const inFlight = countEntries(stats.inFlight);
  const oldestMs = finiteMs(stats.oldestInFlightMs);
  const oldest =
    oldestMs != null
      ? ` (oldest ${
          stats.oldestInFlightType
            ? `${String(stats.oldestInFlightType).replace(/^reticulum_chat_/, '')} `
            : ''
        }${fmtMs(oldestMs)})`
      : '';
  const results = countEntries(stats.results);
  const shown = results
    .slice(0, RESOURCE_RESULT_ENTRIES)
    .map(([key, n]) => `${key}=${n}`);
  if (results.length > RESOURCE_RESULT_ENTRIES) {
    shown.push(`+${results.length - RESOURCE_RESULT_ENTRIES} more`);
  }
  return `Resource sessions: in flight ${
    inFlight.length ? inFlight.map(([k, n]) => `${k}=${n}`).join(' ') : 'none'
  }${oldest}; results ${shown.length ? shown.join(' ') : 'none'}`;
}

/** Interpreted Java takes ~80 ms for the probe; compiled a few ms. */
const JAVA_INTERPRETED_PROBE_MS = 50;

/** `HH:MM:SS` in UTC, with the date when it is not the report's day. */
function fmtEventTime(at: number, now: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'n/a';
  const iso = date.toISOString();
  const time = iso.slice(11, 19);
  return iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
    ? time
    : `${iso.slice(0, 10)} ${time}`;
}

/** The "Unlock" section: build type, Java speed, KDF pool, recorded steps. */
export function formatUnlockLines(
  unlock: UnlockDiagnostics | null | undefined,
  now: number
): string[] {
  const runtime = unlock?.runtime ?? null;
  const lines: string[] = [];
  lines.push(
    `App build: ${
      runtime == null
        ? 'unknown'
        : runtime.debuggable
          ? 'DEBUG (debuggable): on GrapheneOS all Java runs interpreted'
          : 'release (not debuggable)'
    }`
  );
  const probeMs = finiteMs(runtime?.probeMs);
  lines.push(
    probeMs == null
      ? 'Java speed probe: not run'
      : `Java speed probe: bcrypt cost 6 in ${Math.round(probeMs)} ms (compiled is a few ms; ${JAVA_INTERPRETED_PROBE_MS} ms or more means Java runs interpreted)`
  );
  lines.push(
    runtime && Number.isFinite(runtime.poolSize)
      ? `KDF pool: ${runtime.poolSize} threads of ${
          Number.isFinite(runtime.cores) ? runtime.cores : '?'
        } cores`
      : 'KDF pool: unknown'
  );
  const events = unlock?.events ?? [];
  if (events.length === 0) {
    lines.push('No unlock recorded yet');
  }
  for (const event of events) {
    const ms = event.ms >= 0 ? `${Math.round(event.ms)} ms` : 'n/a';
    lines.push(
      `${fmtEventTime(event.at, now)} ${event.step} ${ms}${
        event.detail ? ` — ${event.detail}` : ''
      }`
    );
  }
  return lines;
}

export function buildReticulumDiagnosticsReport(
  input: ReticulumDiagnosticsInput
): string {
  const { state, webView, engine, coreApi } = input;
  const displayPhase = state.bridgeError
    ? 'error'
    : reticulumDisplayPhase(state.phase, input.onlineCount, input.deviceOnline);
  const lines: string[] = [];
  lines.push('Qortal GO diagnostics');
  lines.push(`GO version: ${input.version}`);
  lines.push(`Time: ${new Date(input.now).toISOString()}`);
  lines.push('');
  lines.push('--- WebView ---');
  lines.push(`User agent: ${webView.userAgent || 'unknown'}`);
  lines.push(
    `CPU cores: ${webView.hardwareConcurrency ?? 'n/a'}, device memory: ${
      webView.deviceMemoryGb != null ? `${webView.deviceMemoryGb} GB` : 'n/a'
    }`
  );
  lines.push(
    `WebAssembly: ${webView.webAssembly ? 'yes' : 'NO'}, OPFS storage: ${
      webView.opfs ? 'yes' : 'NO'
    }, cross-origin isolated: ${webView.crossOriginIsolated ? 'yes' : 'no'}`
  );
  const jit = jitVerdict({
    webAssembly: webView.webAssembly,
    sqliteInitMs: engine?.sqliteInitMs,
    bootMs: engine?.bootMs ?? state.chatEngineBootMs,
  });
  lines.push(`JIT: ${jit.verdict} (${jit.basis})`);
  lines.push(
    `JS loop probe: ${webView.jsLoopMs} ms (weak hint only; CPU speed and load move it as much as JIT does)`
  );
  lines.push('');
  lines.push('--- Unlock ---');
  lines.push(...formatUnlockLines(input.unlock, input.now));
  lines.push('');
  lines.push('--- Reticulum radio ---');
  lines.push(
    `Badge: ${reticulumDisplayLabel(displayPhase)} (transport ${state.phase}, device ${
      input.deviceOnline ? 'online' : 'offline'
    })`
  );
  lines.push(`Accounts online: ${input.onlineCount}`);
  if (state.status) {
    lines.push(
      `Network: ${state.status.networkName}, IFAC: ${state.status.ifacSize} B, hubs: ${state.status.interfaces}, known paths: ${state.status.announces}`
    );
    lines.push(
      `Received: ${fmtMb(state.status.rxBytes)}, sent: ${fmtMb(state.status.txBytes)}`
    );
  } else {
    lines.push('Transport status: not available');
  }
  if (state.error) lines.push(`Transport error: ${state.error}`);
  lines.push('');
  lines.push('--- Chat engine ---');
  const engineState = state.chatEngineState || 'idle';
  lines.push(
    `State: ${engineState} for ${chatEngineStateAgeSec(state, input.now)} s`
  );
  lines.push(
    `Last boot: ${fmtMs(engine?.bootMs ?? state.chatEngineBootMs)}, sqlite-wasm init: ${fmtMs(
      engine?.sqliteInitMs
    )} (stock WebView well under 1 s; several seconds usually mean no JIT)`
  );
  const engineReady = engine?.readiness.state === 'ready';
  if (engine) {
    lines.push(
      `Worker alive: ${engine.workerAlive ? 'yes' : 'no'}, direct bridge socket: ${
        engine.workerHasDirectBridge ? 'yes' : 'no'
      }, RPCs in flight: ${engine.pendingRpcCount}`
    );
    if (engineReady) {
      lines.push(formatResourceSessionsLine(engine.resourceSessions));
    }
    if (engine.readiness.error) {
      lines.push(`Engine error: ${engine.readiness.error}`);
    }
  }
  if (state.bridgeWarning) lines.push(`Warning: ${state.bridgeWarning}`);
  if (state.bridgeError) lines.push(`Bridge error: ${state.bridgeError}`);
  lines.push('');
  lines.push('--- Core API ---');
  if (coreApi) {
    lines.push(
      `Node: ${coreApi.host || 'unknown'}, /admin/status: ${
        coreApi.ok
          ? `ok (${coreApi.httpStatus})`
          : coreApi.httpStatus != null
            ? `HTTP ${coreApi.httpStatus}`
            : `unreachable (${redactDiagnosticText(coreApi.error || 'error')})`
      } in ${fmtMs(coreApi.ms)}`
    );
  } else {
    lines.push('Not probed');
  }
  if (engine) {
    lines.push(formatNodeApiKeyLine(engine.apiKeyConfigured ?? null));
    // /admin/status goes to the main thread's Core base; membership checks
    // go to the saved node the worker was given. Show both when they differ,
    // in host or in scheme (https to a plain-HTTP tunnel fails every check).
    const hostDiffers =
      !coreApi || (engine.apiHost || '') !== (coreApi.host || '');
    const schemeDiffers = Boolean(
      coreApi?.scheme && engine.apiScheme && coreApi.scheme !== engine.apiScheme
    );
    if (hostDiffers || schemeDiffers) {
      const notes: string[] = [];
      if (coreApi && hostDiffers) notes.push('differs from the node above');
      if (schemeDiffers) {
        notes.push(`${engine.apiScheme}, node above uses ${coreApi?.scheme}`);
      }
      lines.push(
        `Membership API host: ${engine.apiHost || 'none'}${
          notes.length ? ` (${notes.join('; ')})` : ''
        }`
      );
    }
    lines.push(
      formatMembershipProbeLine(engine.membershipProbe ?? null, engineReady)
    );
    if (engineReady) {
      lines.push(formatValidatorLine(engine.validator ?? null, input.now));
    }
  }
  lines.push('');
  lines.push('--- Recent send failures ---');
  if (input.sendFailures.length === 0) {
    lines.push('none this session');
  } else {
    for (const failure of input.sendFailures.slice(-10)) {
      lines.push(
        `${new Date(failure.at).toISOString()} target=${failure.target} attempts=${failure.attempts}: ${failure.error}`
      );
    }
  }
  lines.push('');
  lines.push('--- Engine log (faults, then tail) ---');
  const engineLogLines = engine
    ? selectEngineLogLines(engine.engineLogs ?? [], engine.engineBootFaults)
    : [];
  if (engineLogLines.length) {
    lines.push(...engineLogLines);
  } else {
    lines.push(
      engineState === 'ready'
        ? 'no log lines'
        : 'engine not ready; log not available'
    );
  }
  // Last line of defence for a report pasted publicly: no URL (they can
  // carry keys or tokens) and no API key value, whatever the source line.
  return lines.map((line) => redactDiagnosticText(line)).join('\n');
}

// ── Markdown file export ─────────────────────────────────────────────────────

/** `qortal-go-diagnostics-2026-09-30-1115.md`, in UTC like the report's Time. */
export function diagnosticsFileName(now: number): string {
  const iso = new Date(now).toISOString();
  return `qortal-go-diagnostics-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.md`;
}

const REPORT_SECTION_RE = /^--- (.+) ---$/;
const REPORT_SUBSECTION_RE = /^-- (.+) --$/;

/** A fence longer than any backtick run inside the block, so none can close it. */
function codeFenceFor(lines: string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longest = Math.max(longest, run.length);
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The same report as a Markdown file: the title and section markers become
 * headings, everything else goes into `text` code blocks. Code blocks keep
 * every line verbatim in any viewer; as plain Markdown, `<url>` placeholders,
 * underscores and asterisks in log lines would be eaten as HTML or emphasis.
 */
export function diagnosticsReportToMarkdown(report: string): string {
  const lines = String(report).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let block: string[] = [];
  const flush = () => {
    while (block.length && !block[0].trim()) block.shift();
    while (block.length && !block[block.length - 1].trim()) block.pop();
    if (block.length) {
      const fence = codeFenceFor(block);
      out.push(`${fence}text`, ...block, fence, '');
    }
    block = [];
  };
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (index === 0 && trimmed) {
      out.push(`# ${trimmed}`, '');
      return;
    }
    const heading =
      REPORT_SECTION_RE.exec(trimmed)?.[1] ??
      REPORT_SUBSECTION_RE.exec(trimmed)?.[1];
    if (heading) {
      flush();
      out.push(`${REPORT_SECTION_RE.test(trimmed) ? '##' : '###'} ${heading}`);
      out.push('');
      return;
    }
    block.push(line);
  });
  flush();
  return `${out.join('\n').trimEnd()}\n`;
}

export async function collectReticulumDiagnostics(
  state: ReticulumState,
  onlineCount: number,
  deviceOnline: boolean
): Promise<string> {
  const webView = probeWebView();
  const [engine, coreApi, unlockRuntime] = await Promise.all([
    getMobileReticulumChatDiagnostics().catch(() => null),
    probeCoreApi().catch(() => null),
    probeUnlockRuntime().catch(() => null),
  ]);
  return buildReticulumDiagnosticsReport({
    now: Date.now(),
    version: GO_VERSION,
    state,
    onlineCount,
    deviceOnline,
    webView,
    engine,
    coreApi,
    sendFailures: getRecentSendFailures(),
    unlock: {
      events: getUnlockTimingSnapshot().events,
      runtime: unlockRuntime,
    },
  });
}
