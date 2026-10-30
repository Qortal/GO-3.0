/**
 * "Copy diagnostics" for the Reticulum badge: one plain-text report a phone
 * user can paste into a chat, covering the radio, the chat engine, the
 * WebView's capabilities and speed, Core API reachability, the last send
 * failures, the last unlock timings and the engine's own log tail. On GO it
 * adds the device's power state, the engine's sync health (gap scanner,
 * digest and resource queues, loop lag, worker->native timing), what the
 * phone served to peers, the Android bridge's lanes and recent app errors.
 * All of it is read only when the report is copied: no timers, no new
 * periodic work.
 *
 * Built for remote reports (GrapheneOS in particular, where WebView JIT can
 * be off per app): every value here is one the app cannot otherwise show and
 * that decides which fix applies.
 *
 * Users paste this publicly: it never holds a URL or an API key (a key is only
 * reported as set / not set), and Qortal addresses, group / peer /
 * conversation / file ids and the user's own node host are replaced with
 * per-report pseudonyms (diagnosticPseudonyms.ts). Loopback and the public
 * Qortal nodes keep their names. The formatter is pure apart from the random
 * pseudonym key; only the probes and `collectReticulumDiagnostics` touch the
 * environment.
 */
import { GO_VERSION } from '../../appVersion';
import { getBaseApiReact } from '../../utils/globalApi';
import {
  getRecentSendFailures,
  getRecentSendTimings,
  type SendAttemptRecord,
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
  engineLogLineKey,
  isEngineFaultLine,
} from '../../reticulumChat/mobile/engineLogFaults';
import type {
  EngineDbDiagnostics,
  EngineSyncHealthSnapshot,
  PythonCpuStacks,
} from '../../reticulumChat/mobile/engineHost';
import type { EngineIoStats } from '../../reticulumChat/mobile/engineIoStats';
import type { MobileFsStats } from '../../reticulumChat/mobile/shims/fs';
import type { MobileSqliteStats } from '../../reticulumChat/mobile/shims/better-sqlite3';
import {
  getPageLongTaskStats,
  type PageLongTaskStats,
} from '../../reticulumChat/mobile/pageLongTasks';
import {
  getReticulumAdminListFetchStats,
  type ReticulumAdminListFetchStats,
} from '../Group/reticulumAdminList';
import {
  getReticulumSummaryRefreshStats,
  type ReticulumSummaryRefreshStats,
} from '../Group/reticulumSummaryRefresh';
import type { LatencySummary } from '../../reticulumChat/mobile/latencyStats';
import type { LoopLagSnapshot } from '../../reticulumChat/mobile/loopLag';
import type { NativeRequestSnapshot } from '../../reticulumChat/mobile/nativeRequestStats';
import type { LogKeyCount } from '../../reticulumChat/mobile/shims/logger';
import type { ServingStats } from '../../reticulumChat/mobile/wireBridge';
import type {
  ReticulumChatAuthorGapOutcomes,
  ReticulumChatAuthorGapScannerDiagnostics,
  ReticulumChatChannelMetadataDiagnostics,
  ReticulumChatChannelMetadataGroupDiagnostics,
  ReticulumChatDigestQueueDiagnostics,
  ReticulumChatEngineQueueDiagnostics,
} from '../../../electron/src/reticulum-chat';
import type { ReticulumChatMissingRangeStateCounts } from '../../../electron/src/reticulum-chat-db';
import {
  Reticulum,
  type KotlinSocketDetail,
  type PythonBridgeDetail,
  type PythonBridgeLaneDetail,
  type PythonBridgeLinkCounts,
} from '../../plugins/Reticulum';
import { getRelayProfileSince } from '../../bridge/capacitorBridge';
import {
  collectAppErrorDiagnostics,
  formatAppErrorLines,
  type AppErrorDiagnostics,
} from '../../utils/appErrorRing';
import { createDiagnosticPseudonymizer } from './diagnosticPseudonyms';
import { isAndroidApp } from '../../utils/androidApp';
import { isCapacitor } from '../../utils/platform';
import { AudioRouting } from '../../plugins/AudioRouting';
import { getNativeCallDiagnostics } from '../../bridge/nativeCallSession';
import * as mobileAudioSurface from '../../bridge/mobileAudioSurface';
import { getWebRtcPrivacyStats } from '../../bridge/webrtcPrivacy';
import { getCallTransportPreference } from '../../bridge/callTransportPreference';
import {
  fetchBackgroundSyncState,
  type BackgroundSyncState,
} from '../Mobile/backgroundSync';
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

type WebViewProbe = {
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  webAssembly: boolean;
  opfs: boolean;
  crossOriginIsolated: boolean;
  /**
   * Tight integer loop. On its own a weak JIT hint: CPU speed and load move
   * it about as much as JIT does (node measured ~2.4x between JIT and
   * --jitless).
   */
  jsLoopMs: number;
  /**
   * Builtin-only work (Float64Array fill + sort, TextEncoder) run right after
   * the loop on the same thread. Builtins are precompiled, so jitless V8
   * barely slows them, and the loop / reference ratio cancels CPU speed:
   * node 22 gives about 1 with JIT and about 3 with --jitless. Not calibrated
   * on phones yet, so the report prints it and never decides on it.
   */
  builtinRefMs?: number | null;
};

type CoreApiProbe = {
  host: string;
  /** `http` / `https`; compared with the membership checks' base. */
  scheme?: string;
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  error?: string;
  /** The node's own sync state from the same /admin/status answer. */
  status?: CoreNodeStatus | null;
};

/** Fields of Core's /admin/status answer; each null when missing or odd. */
type CoreNodeStatus = {
  height: number | null;
  syncPercent: number | null;
  isSynchronizing: boolean | null;
  numberOfConnections: number | null;
};

type UnlockDiagnostics = {
  /** Oldest first, from `getUnlockTimingSnapshot`. */
  events: UnlockTimingEvent[];
  /** Null off native Android, on a plugin error or a timeout. */
  runtime: NativeBcryptRuntimeInfo | null;
};

/** Background sync facts for the report: no names, addresses or ids. */
export type BackgroundSyncDiagnostics = Pick<
  BackgroundSyncState,
  | 'mode'
  | 'ignoringBatteryOptimizations'
  | 'vendorFreezeCount'
  | 'vendorFreezeRecent'
> &
  Partial<
    Pick<
      BackgroundSyncState,
      | 'charging'
      | 'unmetered'
      | 'relayProfile'
      | 'keepAliveActive'
      | 'thermalStatus'
      | 'powerSave'
      | 'batteryTempC'
      | 'plugType'
      | 'batteryPct'
    >
  >;

/** The Android bridge's own counters (Reticulum.getStatus({ detail: true })). */
export type NativeBridgeDiagnostics = {
  /** Python bridge lanes and queues; null when Python is not started. */
  bridge: PythonBridgeDetail | null;
  /** When the app process started (ms since epoch). */
  processStartedAtMs: number | null;
  /** Kotlin's bridge socket; null when it is not running. */
  socket: KotlinSocketDetail | null;
  /** Python's call audio I/O counters (qortal_presence_host callAudioIo). */
  callAudioIo?: CallAudioIoDiagnostics | null;
  /** RNS crypto provider; packets by type, most bytes first (top 8). */
  cryptoBackend?: string | null;
  packetMix?: Array<{ key: string; count: number; bytes: number }>;
  /** The last WebView renderer death, kept across restarts. */
  rendererGone?: { at: number; crashed: boolean; count: number } | null;
  /** Kotlin's resource staging folder (cacheDir/reticulum-chat-resources) now. */
  stagedResources?: {
    files: number;
    bytes: number;
    oldestAgeMs: number;
  } | null;
};

/** Python's call audio I/O counters (transport_status detail `callAudioIo`). */
type CallAudioIoDiagnostics = {
  rxFrames?: number;
  rxControl?: number;
  rxDropped?: number;
  rxMediaShed?: number;
  rxBadBatch?: number;
  txFrames?: number;
  txControl?: number;
  txNotQueued?: number;
  txRejected?: number;
  selfCheckOk?: boolean;
  selfCheckProblems?: string[];
  lastError?: string;
};

/** GO's call plumbing, read once for the report (GO only). No ids. */
export type CallDiagnostics = {
  /** 'webrtc' (Direct) or 'reticulum' (Private calls). */
  transportPreference: string | null;
  /** QortalCall.getState(): ring, call, mic service, lock flags. */
  native: Record<string, unknown> | null;
  /** AudioRouting.getAudioRoutes(): route, focus, proximity. */
  route: Record<string, unknown> | null;
  /** The audio surface's own call counters, when this build has them. */
  surface: Record<string, unknown> | null;
  /** WebRTC privacy guard counters (candidates dropped / rewritten). */
  webrtcPrivacy: Record<string, unknown> | null;
  /** Community STUN servers GO can use right now (no probing to count). */
  stunServers?: number | null;
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
  /** Native Android only; null or missing elsewhere. */
  backgroundSync?: BackgroundSyncDiagnostics | null;
  /** First attempt to success of the last few sends (ms); missing in older callers. */
  sendTimings?: number[];
  /** Renderer faults this session plus the saved crash log; missing in older callers. */
  appErrors?: AppErrorDiagnostics | null;
  /** Native Android only: Python lanes and Kotlin socket counters. */
  nativeBridge?: NativeBridgeDiagnostics | null;
  /**
   * GO only: the call plumbing ("Calls" section). Left out (undefined) the
   * section is not printed (desktop, older callers); null = not readable.
   */
  calls?: CallDiagnostics | null;
  /** When the relay profile last changed on this page; null = not since page start. */
  relayProfileSince?: number | null;
  /** When this page started (ms since epoch). */
  pageStartedAt?: number;
  /** Key for the identifier pseudonyms; random per report unless a test fixes it. */
  pseudonymKey?: Uint8Array;
  // Page-side counters; left out (older callers) they print nothing.
  /** The chat page's admin-list fetches (Group.tsx). */
  adminList?: ReticulumAdminListFetchStats | null;
  /** The chat page's getSummaries refreshes (Group.tsx). */
  summaryRefresh?: ReticulumSummaryRefreshStats | null;
  /** Main-thread long tasks since the page started (GO). */
  pageLongTasks?: PageLongTaskStats | null;
};

type JitEvidence = {
  /**
   * GrapheneOS's own "WebView JIT" switch for GO, read natively
   * (NativeBcryptRuntimeInfo.webViewJitRestricted): true = off. Null or
   * missing off GrapheneOS, on GrapheneOS before 2026050400 and off Android.
   */
  webViewJitRestricted?: boolean | null;
  webAssembly: boolean;
  /** Same-thread JS loop / builtin reference ratio (`jitProbeRatio`). */
  probeRatio?: number | null;
};

type JitVerdict = {
  verdict: 'on' | 'off' | 'likely off' | 'unclear';
  basis: string;
};

function finiteMs(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Whether the WebView runs with JIT. Only GrapheneOS's flag decides it;
 * without the flag only a missing WebAssembly still points one way.
 *
 * sqlite-wasm init and engine boot are not evidence: Vanadium keeps
 * WebAssembly with JIT off (DrumBrake interpreter), and init stayed at
 * 100-136 ms in JIT-off sessions. The same-thread probe ratio is printed for
 * calibration and does not decide either.
 */
export function jitVerdict(evidence: JitEvidence): JitVerdict {
  if (evidence.webViewJitRestricted === true) {
    return { verdict: 'off', basis: 'GrapheneOS: WebView JIT is off for GO' };
  }
  if (evidence.webViewJitRestricted === false) {
    return {
      verdict: 'on',
      basis: 'GrapheneOS: WebView JIT is allowed for GO',
    };
  }
  if (!evidence.webAssembly) {
    return { verdict: 'likely off', basis: 'WebAssembly missing' };
  }
  const ratio = evidence.probeRatio;
  return {
    verdict: 'unclear',
    basis:
      typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
        ? `no GrapheneOS flag; same-thread JS loop / builtin ratio ${ratio.toFixed(2)}, not calibrated yet`
        : 'no GrapheneOS flag; same-thread probe ratio not measured',
  };
}

/** JS loop time over the builtin reference time; null if either is unusable. */
export function jitProbeRatio(
  jsLoopMs: number | null | undefined,
  builtinRefMs: number | null | undefined
): number | null {
  const loop = finiteMs(jsLoopMs);
  const reference = finiteMs(builtinRefMs);
  if (loop == null || reference == null || reference <= 0) return null;
  return loop / reference;
}

/** `app.vanadium.webview 141.0.7390.43`, from the native runtime info. */
export function formatWebViewProvider(
  runtime: NativeBcryptRuntimeInfo | null | undefined
): string {
  const name =
    typeof runtime?.webViewPackage === 'string' ? runtime.webViewPackage : '';
  if (!name) return 'unknown';
  const version =
    typeof runtime?.webViewVersion === 'string' ? runtime.webViewVersion : '';
  return version ? `${name} ${version}` : name;
}

/** Both probe numbers and their ratio, for calibration against the flag. */
function formatJitProbeLine(
  webView: Pick<WebViewProbe, 'jsLoopMs' | 'builtinRefMs'>,
  ratio: number | null
): string {
  const loop = `JS loop probe: ${fmtMs(webView.jsLoopMs)}`;
  if (ratio == null) return `${loop} (no builtin reference)`;
  return `${loop}, builtin reference: ${fmtMs(
    webView.builtinRefMs
  )}, ratio ${ratio.toFixed(2)} (same thread; node: ~1 with JIT, ~3 without; not calibrated on phones yet)`;
}

function jsLoopProbeMs(iterations = 3_000_000): number {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < iterations; i++) x = (x * 31 + i) | 0;
  // Keep the loop observable so an optimiser cannot drop it.
  if (x === 0x7fffffff) console.debug('[ReticulumDiagnostics] probe', x);
  return Math.round(performance.now() - t0);
}

/**
 * Builtin-only reference for `jsLoopProbeMs`: typed-array fill / reverse /
 * sort and TextEncoder, all precompiled code that JIT barely changes.
 */
function builtinReferenceProbeMs(): number {
  const t0 = performance.now();
  const values = new Float64Array(400_000);
  let seed = 12345;
  for (let i = 0; i < values.length; i += 4096) {
    seed = (seed * 1103515245 + 12345) | 0;
    values.fill(seed, i, i + 4096);
  }
  values.reverse();
  values.sort();
  const encoded = new TextEncoder().encode('x'.repeat(2_000_000));
  const ms = performance.now() - t0;
  // Keep the work observable so an optimiser cannot drop it.
  if (encoded.length === 0 || values[0] === 0.5) {
    console.debug('[ReticulumDiagnostics] reference', ms);
  }
  return Math.round(ms * 10) / 10;
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
    // Back to back on one thread, so both see the same core and clock.
    jsLoopMs: jsLoopProbeMs(),
    builtinRefMs: builtinReferenceProbeMs(),
  };
}

/**
 * Core's /admin/status body: `height`, `syncPercent`, `isSynchronizing` and
 * `numberOfConnections`. Null when the body is not an object or has none of
 * them; a missing or odd field is null on its own.
 */
export function parseCoreAdminStatus(body: unknown): CoreNodeStatus | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const status: CoreNodeStatus = {
    height: num(record.height),
    syncPercent: num(record.syncPercent),
    isSynchronizing:
      typeof record.isSynchronizing === 'boolean'
        ? record.isSynchronizing
        : null,
    numberOfConnections: num(record.numberOfConnections),
  };
  return Object.values(status).some((value) => value != null) ? status : null;
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
    const ms = Date.now() - t0;
    // The same answer says whether the node itself is in sync (a node behind
    // the chain answers memberships from old state).
    const status = res.ok
      ? await res
          .json()
          .then(parseCoreAdminStatus)
          .catch(() => null)
      : null;
    return {
      host,
      scheme,
      ok: res.ok,
      httpStatus: res.status,
      ms,
      ...(status ? { status } : {}),
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

/** Ages that can run to minutes: `840 ms`, `12.3 s`, `22 min`. */
function fmtAge(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 120_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** A bucketed percentile: rounded up to its histogram bound. */
function fmtP(ms: number | null | undefined): string {
  return `~${fmtMs(ms)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A count from another thread or an older build: anything else is 0. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A finite number, or null. */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `2,317`: a count with thousands separators (anything else is 0). */
function fmtInt(value: unknown): string {
  return Math.round(count(value)).toLocaleString('en-US');
}

/** `12.3 MB` for sizes that run to hundreds of MB. */
function fmtBytes(bytes: unknown): string {
  const n = count(bytes);
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}

/** `3.9` per minute of `n` over `minutes`. */
function perMinute(n: unknown, minutes: number): string {
  return (count(n) / Math.max(1, minutes)).toFixed(1);
}

/** A label from another thread (lane, command, reason, counter): no spaces or odd characters. */
function safeLabel(value: unknown, max = 64): string {
  const text = String(value ?? '')
    .replace(/[^\w:.-]/g, '_')
    .slice(0, max);
  return text || '?';
}

/** `p50 ~X, p95 ~Y, max Z` of a latency summary. */
function fmtLatency(summary: LatencySummary | null | undefined): string {
  return `p50 ${fmtP(summary?.p50)}, p95 ${fmtP(summary?.p95)}, max ${fmtMs(
    summary?.max
  )}`;
}

function hasSamples(
  summary: LatencySummary | null | undefined
): summary is LatencySummary {
  return Boolean(
    summary && typeof summary === 'object' && count(summary.n) > 0
  );
}

/** `k=v k=v` of the non-zero entries, largest first; `none` when empty. */
function fmtCountMap(record: unknown, max = 8): string {
  if (!record || typeof record !== 'object') return 'none';
  const entries = Object.entries(record as Record<string, unknown>)
    .map(([key, value]): [string, number] => [safeLabel(key), count(value)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return 'none';
  const shown = entries.slice(0, max).map(([key, n]) => `${key}=${n}`);
  if (entries.length > max) shown.push(`+${entries.length - max} more`);
  return shown.join(' ');
}

/**
 * Lines from one formatter; a formatter bug costs its own lines, never the
 * whole report.
 */
function safeLines(section: string, build: () => string[]): string[] {
  try {
    return build();
  } catch {
    return [`${section}: format error`];
  }
}

// ── engine log selection ─────────────────────────────────────────────────────

// The fault predicate and line key live with the worker logger, which keeps
// fault lines only in its boot buffer; the predicate is re-exported for the
// report's callers.
export { isEngineFaultLine };

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

const ENGINE_LOG_TAIL_LINES = 60;
const ENGINE_LOG_MAX_FAULT_ENTRIES = 40;
const ENGINE_LOG_MAX_BOOT_ENTRIES = 40;
const ENGINE_LOG_MAX_KEY_COUNTS = 25;

type EngineLogExtras = {
  /** Fault lines the worker's full boot buffer did not keep. */
  bootOverflow?: number;
  /** Per-event fault lines past the first few per kind and group (counted only). */
  bootRepeatsFolded?: number;
  /** Lines per `level:token` since boot, most first. */
  keyCounts?: LogKeyCount[];
};

/** `22:57:41.000` of a millisecond timestamp. */
function clockTime(at: number): string {
  try {
    return logLineTime(new Date(at).toISOString());
  } catch {
    return '';
  }
}

/**
 * The "Engine log" section: first warnings since boot that the recent ring no
 * longer holds, then faults from the ring before its tail, then line counts
 * since boot, then the tail. Repeats are collapsed in each part, and a part
 * cut at its cap says how much it left out.
 */
export function selectEngineLogLines(
  ring: string[],
  bootFaults: string[] = [],
  extras: EngineLogExtras = {}
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
  const bootAll = collapseEngineLogLines(bootOnly, 3);
  const boot = bootAll.slice(0, ENGINE_LOG_MAX_BOOT_ENTRIES);
  if (bootAll.length > ENGINE_LOG_MAX_BOOT_ENTRIES) {
    boot.push(`… ${bootAll.length - ENGINE_LOG_MAX_BOOT_ENTRIES} more elided`);
  }
  const bootOverflow = count(extras?.bootOverflow);
  if (bootOverflow > 0) {
    boot.push(`Boot buffer full: ${bootOverflow} later warnings not kept`);
  }
  const bootRepeatsFolded = count(extras?.bootRepeatsFolded);
  if (bootRepeatsFolded > 0) {
    boot.push(
      `Boot buffer: ${bootRepeatsFolded} more repeats of per-group channel metadata and slow statement warnings not kept (3 kept per kind and group)`
    );
  }
  const faultsAll = collapseEngineLogLines(
    beforeTail.filter(isEngineFaultLine),
    3
  );
  const faults = faultsAll.slice(-ENGINE_LOG_MAX_FAULT_ENTRIES);
  if (faultsAll.length > ENGINE_LOG_MAX_FAULT_ENTRIES) {
    faults.unshift(
      `… ${faultsAll.length - ENGINE_LOG_MAX_FAULT_ENTRIES} earlier elided`
    );
  }
  const keyCounts = (Array.isArray(extras?.keyCounts) ? extras.keyCounts : [])
    .filter((c) => c && typeof c === 'object' && count(c.n) > 0)
    .slice(0, ENGINE_LOG_MAX_KEY_COUNTS);
  const out: string[] = [];
  if (boot.length) out.push('-- first warnings since boot --', ...boot);
  if (faults.length) out.push('-- recent faults --', ...faults);
  if (keyCounts.length) {
    out.push(
      '-- line counts since boot --',
      ...keyCounts.map((c) => {
        const firstAt = count(c.firstAt);
        const lastAt = count(c.lastAt);
        const span =
          firstAt > 0
            ? ` (first ${clockTime(firstAt)}, last ${clockTime(lastAt)})`
            : '';
        // Keys are `level:first words` (logThrottleKey); the final pass
        // still pseudonymises anything that looks like an id.
        const key =
          String(c.key ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 96) || '?';
        return `x${count(c.n)} ${key}${span}`;
      })
    );
  }
  if (tail.length) {
    if (out.length) out.push(`-- last ${tail.length} lines --`);
    out.push(...collapseEngineLogLines(tail, 1));
  }
  return out;
}

// ── membership, node and bridge lines ────────────────────────────────────────

function formatNodeApiKeyLine(configured: boolean | null): string {
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
  // Optional counters (validator-spec D1): an older worker leaves them out.
  const ownListAnswers = count(stats.ownListAnswers);
  if (stats.okCount === 0 && stats.unavailableCount === 0) {
    return ownListAnswers > 0
      ? `Membership validator: no checks yet; own address ${ownListAnswers} answered from the group list`
      : 'Membership validator: no checks yet';
  }
  const timedOut = count(stats.timedOutCount);
  const graced = count(stats.gracedCount);
  const parts = [
    `Membership validator: ${stats.okCount} ok, ${stats.unavailableCount} unavailable${
      timedOut > 0 ? ` (${timedOut} timed out)` : ''
    }${graced > 0 ? `, ${graced} graced (${count(stats.gracedKeptCount)} kept)` : ''}`,
  ];
  const ownCount = count(stats.ownCount);
  if (ownCount > 0 || ownListAnswers > 0) {
    const ownUnavailable = count(stats.ownUnavailableCount);
    const bootWaits = count(stats.ownBootWaits);
    const bootWaitTimeouts = count(stats.ownBootWaitTimeouts);
    const coreDenied = count(stats.ownCoreDenied);
    const own = [
      `own address ${ownCount} of ${count(stats.okCount) + count(stats.unavailableCount)} requests${
        ownUnavailable > 0 ? ` (${ownUnavailable} unavailable)` : ''
      }`,
    ];
    if (ownListAnswers > 0) {
      own.push(`${ownListAnswers} answered from the group list`);
    }
    if (bootWaits > 0 || bootWaitTimeouts > 0) {
      own.push(`boot waits ${bootWaits} ok, ${bootWaitTimeouts} timed out`);
    }
    if (coreDenied > 0) own.push(`Core said not a member ${coreDenied}x`);
    parts.push(own.join(', '));
  }
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

/**
 * Network time against the time an answer then waited for the worker, for
 * the last answers with a Resource Timing entry. Null when there is nothing
 * to say.
 */
export function formatValidatorTimingLine(
  stats: GroupValidatorStats | null | undefined
): string | null {
  if (!stats) return null;
  const finite = (values: unknown): number[] =>
    (Array.isArray(values) ? values : [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
  const net = finite(stats.recentNetworkMs);
  const wait = finite(stats.recentWorkerWaitMs);
  const parts: string[] = [];
  if (net.length) {
    parts.push(
      `network median ${fmtMs(median(net))}, max ${fmtMs(Math.max(...net))}`
    );
  }
  if (wait.length) {
    parts.push(
      `waiting on the engine median ${fmtMs(median(wait))}, max ${fmtMs(
        Math.max(...wait)
      )}`
    );
  }
  if (count(stats.maxTimerLateMs) > 0) {
    parts.push(`worst late timer ${fmtMs(count(stats.maxTimerLateMs))}`);
  }
  if (count(stats.maxInFlight) > 1) {
    parts.push(`up to ${count(stats.maxInFlight)} in flight`);
  }
  if (!parts.length) return null;
  return `Membership timing${
    net.length ? ` (last ${net.length} answers)` : ''
  }: ${parts.join('; ')}`;
}

const VALIDATOR_RECENT_FAILURE_LINES = 8;

/**
 * Batched requests and why they failed: failed requests by reason (requests,
 * not addresses), when failures began and the last request with an answer,
 * then the last 8 failures. Nothing for an older worker without the counters.
 */
export function formatValidatorFailureLines(
  stats: GroupValidatorStats | null | undefined,
  now: number
): string[] {
  if (!stats || typeof stats !== 'object') return [];
  const requests = numOrNull(stats.requestCount);
  const reasons = fmtCountMap(stats.failByReason, 10);
  const ring = (
    Array.isArray(stats.recentFailures) ? stats.recentFailures : []
  ).filter((f) => f && typeof f === 'object' && numOrNull(f.at) != null);
  if (requests == null && reasons === 'none' && !ring.length) return [];
  const first = numOrNull(stats.firstFailAt);
  const lastOk = numOrNull(stats.lastOkAt);
  const parts = [
    requests != null
      ? `${fmtInt(requests)} sent (largest batch ${count(stats.maxBatchSize)})`
      : null,
    reasons === 'none'
      ? 'no failed requests'
      : `failed requests by reason: ${reasons}`,
    first != null ? `failing since ${fmtEventTime(first, now)}` : null,
    reasons !== 'none' || lastOk != null
      ? `last answer ${lastOk != null ? fmtEventTime(lastOk, now) : 'never'}`
      : null,
  ].filter((part): part is string => part != null);
  const lines = [`Membership requests: ${parts.join('; ')}`];
  if (ring.length) {
    lines.push(
      `Membership last failures: ${ring
        .slice(-VALIDATOR_RECENT_FAILURE_LINES)
        .map(
          (f) =>
            `${fmtEventTime(f.at, now)} ${safeLabel(f.reason, 32)} (${count(
              f.addresses
            )})`
        )
        .join(', ')}`
    );
  }
  return lines;
}

/** `Node sync: height 2,123,456, 99.5% synced, synchronizing yes, 12 connections`. */
export function formatCoreNodeStatusLine(
  status: CoreNodeStatus | null | undefined
): string | null {
  if (!status || typeof status !== 'object') return null;
  const parts: string[] = [];
  const height = numOrNull(status.height);
  if (height != null) parts.push(`height ${fmtInt(height)}`);
  const percent = numOrNull(status.syncPercent);
  if (percent != null) parts.push(`${percent}% synced`);
  if (typeof status.isSynchronizing === 'boolean') {
    parts.push(`synchronizing ${status.isSynchronizing ? 'yes' : 'no'}`);
  }
  const connections = numOrNull(status.numberOfConnections);
  if (connections != null) parts.push(`${connections} connections`);
  return parts.length ? `Node sync: ${parts.join(', ')}` : null;
}

/** The chat page's admin-list fetches (Group.tsx), GO only. */
export function formatAdminListLine(
  stats: ReticulumAdminListFetchStats | null | undefined,
  now: number
): string | null {
  if (!stats || typeof stats !== 'object') return null;
  const failed = count(stats.failed);
  const timedOut = count(stats.timedOut);
  const lastOkAt = count(stats.lastOkAt);
  const lastErrorAt = count(stats.lastErrorAt);
  const parts = [
    `ok ${count(stats.ok)}, failed ${failed}${timedOut > 0 ? ` (${timedOut} timed out)` : ''}`,
  ];
  if (stats.lastError) {
    parts.push(
      `last error ${redactDiagnosticText(String(stats.lastError)).slice(
        0,
        120
      )}${lastErrorAt > 0 ? `, ${fmtAgo(lastErrorAt, now)}` : ''}`
    );
  }
  parts.push(`last ok ${lastOkAt > 0 ? fmtAgo(lastOkAt, now) : 'never'}`);
  parts.push(`trusted ${stats.authoritative ? 'yes' : 'no'}`);
  return `Admin list: ${parts.join('; ')}`;
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

/** `42 s`, `12 min`, `6 h 05 min`. */
function fmtFrozen(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

const BACKGROUND_SYNC_FREEZE_LINES = 5;

/**
 * The "Background sync" section: mode, exemption, how often the phone's own
 * battery manager froze GO, and the last few freezes (UTC time, how long,
 * charging / exempt then).
 */
export function formatBackgroundSyncLines(
  sync: BackgroundSyncDiagnostics | null | undefined,
  now: number
): string[] {
  if (!sync) return ['Not reported (not native Android, or an older app)'];
  const exempt =
    sync.ignoringBatteryOptimizations == null
      ? 'unknown'
      : sync.ignoringBatteryOptimizations
        ? 'yes'
        : 'no';
  const recent = Array.isArray(sync.vendorFreezeRecent)
    ? sync.vendorFreezeRecent
    : [];
  const lines = [
    `Mode: ${sync.mode}, battery optimisation exempt: ${exempt}`,
    `Vendor freezes recorded: ${
      Number.isFinite(sync.vendorFreezeCount) ? sync.vendorFreezeCount : 0
    }${recent.length ? `, last ${Math.min(recent.length, BACKGROUND_SYNC_FREEZE_LINES)}:` : ''}`,
  ];
  for (const freeze of recent.slice(-BACKGROUND_SYNC_FREEZE_LINES)) {
    lines.push(
      `${fmtEventTime(freeze.at, now)} frozen ${fmtFrozen(freeze.gapMs)}${
        freeze.charging ? ', charging' : ', on battery'
      }${freeze.ignoring ? ', exempt' : ''}`
    );
  }
  return lines;
}

// ── send attempts ────────────────────────────────────────────────────────────

/** ` [1: 45.0 s <error>; 2: 120 ms ok (already stored)]`, or '' without a log. */
export function formatSendAttempts(log?: SendAttemptRecord[] | null): string {
  if (!Array.isArray(log) || log.length === 0) return '';
  return ` [${log
    .map(
      (attempt, i) =>
        `${i + 1}: ${fmtMs(attempt?.ms)} ${
          attempt?.error === null
            ? attempt?.duplicate
              ? 'ok (already stored)'
              : 'ok'
            : String(attempt?.error ?? 'unknown error')
        }`
    )
    .join('; ')}]`;
}

/** First attempt to success of the last few sends; null when there are none. */
export function formatSendTimesLine(timings?: number[] | null): string | null {
  const values = (Array.isArray(timings) ? timings : []).filter(
    (n) => typeof n === 'number' && Number.isFinite(n)
  );
  if (!values.length) return null;
  return `Send times (last ${values.length}): median ${fmtMs(
    median(values)
  )}, max ${fmtMs(Math.max(...values))}`;
}

// ── sync health (debug:sync-health) ─────────────────────────────────────────

/**
 * The background author-gap scanner and the gap rows it works on. Group ids
 * only as `group=` pairs, which the report's final pass pseudonymises.
 */
export function formatAuthorGapScannerLines(
  stats: ReticulumChatAuthorGapScannerDiagnostics | null | undefined
): string[] {
  if (!stats || typeof stats !== 'object') return ['Gap scanner: not reported'];
  const next = numOrNull(stats.nextWakeInMs);
  const runs = count(stats.runsSinceBoot);
  const lines = [
    `Gap scanner: ${count(stats.runsLastMinute)} runs/min (${runs} since boot), last ${fmtMs(
      numOrNull(stats.lastDurationMs)
    )}, max ${fmtMs(count(stats.maxDurationMs))}, slow ${count(
      stats.slowRuns
    )}, failed ${count(stats.failedRuns)}; writes last ${count(
      stats.lastWrites
    )} total ${count(stats.totalWrites)}; sent last ${count(
      stats.lastSent
    )} total ${count(stats.totalSent)}; ${
      next == null ? 'not scheduled' : `next in ${fmtMs(next)}`
    }`,
  ];
  if (runs > 0) {
    lines.push(
      `Gap scanner last run: ${fmtAge(
        numOrNull(stats.lastRunAgoMs)
      )} ago, scanned ${count(stats.lastScanned)} rows, tried ${count(
        stats.lastTried
      )} of ${count(stats.lastEligibleGroups)} eligible groups`
    );
  }
  lines.push(...formatGapRowLines(stats.rows));
  lines.push(...formatAuthorGapOutcomeLines(stats.outcomes));
  return lines;
}

/**
 * What author-range repairs came to: per minute over the last 10 minutes and
 * since start. A denial is sorted by the age of the stored message after the
 * gap (old = past the 29-day serve floor, which Hubs no longer serve).
 * Nothing for an older engine.
 */
export function formatAuthorGapOutcomeLines(
  outcomes: ReticulumChatAuthorGapOutcomes | null | undefined
): string[] {
  if (!outcomes || typeof outcomes !== 'object') return [];
  const minutes = count(outcomes.minutes);
  const describe = (
    record: Record<string, number> | null | undefined,
    rate: boolean
  ): string => {
    const r = record && typeof record === 'object' ? record : {};
    const value = (n: number) => (rate ? perMinute(n, minutes) : fmtInt(n));
    const sumOf = (prefix: string) =>
      Object.entries(r)
        .filter(([key]) => key.startsWith(prefix))
        .reduce((sum, [, n]) => sum + count(n), 0);
    const old = count(r.unavailable_old);
    const recent = count(r.unavailable_recent);
    const undated = count(r.unavailable_undated);
    const failed = Object.fromEntries(
      Object.entries(r)
        .filter(([key]) => key.startsWith('failed:'))
        .map(([key, n]) => [key.slice('failed:'.length), n])
    );
    // Reasons as counts, so only on the since-start line.
    const failedReasons = rate ? 'none' : fmtCountMap(failed, 4);
    return `requested ${value(count(r.requested))}, unavailable ${value(
      sumOf('unavailable')
    )}${
      old + recent + undated > 0
        ? ` (old ${value(old)}, recent ${value(recent)}, undated ${value(undated)})`
        : ''
    }, link failed ${value(sumOf('failed:'))}${
      failedReasons !== 'none' ? ` (${failedReasons})` : ''
    }, imported ${value(count(r.imported))} pages (${value(
      count(r.imported_events)
    )} events)`;
  };
  const total =
    outcomes.total && typeof outcomes.total === 'object' ? outcomes.total : {};
  if (!Object.values(total).some((n) => count(n) > 0)) {
    return ['Gap repairs since start: none'];
  }
  const lines: string[] = [];
  if (minutes > 0) {
    lines.push(
      `Gap repairs per min (last ${minutes} min): ${describe(outcomes.recent, true)}`
    );
  }
  lines.push(`Gap repairs since start: ${describe(total, false)}`);
  return lines;
}

function formatGapRowLines(
  rows: ReticulumChatMissingRangeStateCounts | null | undefined
): string[] {
  if (!rows || typeof rows !== 'object') return ['Gap rows: not reported'];
  const lines = [
    `Gap rows: ${count(rows.total)} (due ${count(rows.due)}, backoff ${count(
      rows.backoff
    )}, quarantined ${count(rows.quarantined)}, parked ${count(
      rows.parked
    )}, not subscribed ${count(rows.notEligible)}); from=1 ${count(
      rows.fromSeqOne
    )}, no peer ${count(rows.noPeer)}, older than 29 d ${count(
      rows.olderThanServeAge
    )}${rows.source === 'memory' ? ' (memory mirror)' : ''}`,
  ];
  // Newer engines tag the rows further (old split due/parked, tails, holes).
  if (numOrNull(rows.noStoredNeighbour) != null) {
    lines.push(
      `Gap row kinds: older than 29 d due ${count(
        rows.olderThanServeAgeDue
      )} / parked ${count(rows.olderThanServeAgeParked)}, no stored neighbour ${count(
        rows.noStoredNeighbour
      )}, single-seq holes ${count(rows.singleSeqInterior)}`
    );
  }
  const top = (Array.isArray(rows.topGroups) ? rows.topGroups : [])
    .filter((g) => g && typeof g === 'object' && numOrNull(g.groupId) != null)
    .slice(0, 5);
  if (top.length) {
    lines.push(
      `Gap rows top groups: ${top
        .map(
          (g) =>
            `group=${Math.trunc(g.groupId)} rows=${count(g.rows)} due=${count(
              g.due
            )}${g.eligible ? '' : ' not subscribed'}`
        )
        .join(', ')}`
    );
  }
  return lines;
}

/** Digest repair and digest send queues (spec D13-5 strings). */
export function formatDigestQueueLines(
  stats: ReticulumChatDigestQueueDiagnostics | null | undefined
): string[] {
  if (!stats || typeof stats !== 'object' || !stats.repair || !stats.recent) {
    return ['Digest queues: not reported'];
  }
  const r = stats.repair;
  const s = stats.send;
  const recent = stats.recent;
  const minutes = Math.max(1, Number(recent.minutes) || 1);
  const perMin = (n: number) => (Number(n || 0) / minutes).toFixed(1);
  const window = `per min (last ${minutes} min)`;
  return [
    `Digest repair queue: ${count(r.queued)} queued${
      numOrNull(r.oldestQueuedMs) != null
        ? ` (oldest ${fmtAge(r.oldestQueuedMs)})`
        : ''
    }; ${window}: processed ${perMin(recent.repairProcessed)}, coalesced ${perMin(
      recent.repairCoalesced
    )}, dropped ${perMin(recent.repairDropped)}`,
    `Digest repair totals: processed ${count(r.processed)} (ahead ${count(
      r.byRelation?.ahead
    )}, equal ${count(r.byRelation?.equal)}, behind ${count(
      r.byRelation?.behind
    )}, no head ${count(r.byRelation?.none)}), coalesced ${count(
      r.coalesced
    )}, dropped ${count(r.dropped)}`,
    `Digest page repairs: equal-head skips ${count(r.equalHeadSkips)} (${perMin(
      recent.equalHeadSkips
    )}/min), spent ${count(r.budgetSpent)} (open chat ${count(
      r.budgetOpenChat
    )}), held ${count(r.budgetHeld) + count(r.budgetSlotBusy)} (slot busy ${count(
      r.budgetSlotBusy
    )}), resets ${count(r.budgetResets)}; groups waiting ${count(
      r.groupsWaiting
    )}, longest streak ${count(r.maxStreak)}`,
    s && typeof s === 'object'
      ? `Digest send queue: ${count(s.queued)} queued${
          numOrNull(s.oldestQueuedMs) != null
            ? ` (oldest ${fmtAge(s.oldestQueuedMs)})`
            : ''
        }; ${window}: processed ${perMin(recent.sendProcessed)}, coalesced ${perMin(
          recent.sendCoalesced
        )}, dropped ${perMin(recent.sendDropped)}`
      : 'Digest send queue: not reported',
  ];
}

/** Resource event queue, event pulls, history serving and group-control relaying. */
export function formatEngineQueueLines(
  queues: ReticulumChatEngineQueueDiagnostics | null | undefined
): string[] {
  if (!queues || typeof queues !== 'object') {
    return ['Engine queues: not reported'];
  }
  const lines: string[] = [];
  const q = queues.chatResource;
  if (q && typeof q === 'object') {
    const oldest = numOrNull(q.oldestQueuedMs);
    lines.push(
      `Resource event queue: ${count(q.queued)} waiting${
        oldest != null ? ` (oldest ${fmtAge(oldest)})` : ''
      }, ${q.active ? 'running' : 'idle'}; processed ${count(
        q.processed
      )}, coalesced ${count(q.coalesced)}, dropped ${count(
        q.dropped
      )}, protected overflow ${count(q.protectedOverflow)}`
    );
  } else {
    lines.push('Resource event queue: not reported');
  }
  lines.push(
    `Event pulls: ${count(queues.eventPulls?.pending)} pending, ${count(
      queues.eventPulls?.requested
    )} requested; history serve queue: ${count(
      queues.historyServeQueue
    )}; group control relaying: ${queues.relayGroupControl ? 'on' : 'off'}`
  );
  return lines;
}

const ENGINE_COUNTERS_MAX = 40;
const ENGINE_COUNTERS_PER_LINE = 8;

/** Non-zero engine counters, largest first, 8 pairs per line. */
export function formatEngineCounterLines(counters: unknown): string[] {
  const entries =
    counters && typeof counters === 'object'
      ? Object.entries(counters as Record<string, unknown>)
          .map(([key, value]): [string, number] => [
            safeLabel(key),
            count(value),
          ])
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, ENGINE_COUNTERS_MAX)
      : [];
  if (!entries.length) return ['Engine counters since start: none'];
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += ENGINE_COUNTERS_PER_LINE) {
    const pairs = entries
      .slice(i, i + ENGINE_COUNTERS_PER_LINE)
      .map(([key, n]) => `${key}=${n}`)
      .join(' ');
    lines.push(
      i === 0 ? `Engine counters since start: ${pairs}` : `  ${pairs}`
    );
  }
  return lines;
}

/**
 * The fs shim's OPFS handle pool and file index: refill that is slow and
 * opens that fail look the same from outside (EMFILE), this separates them.
 */
export function formatChatStorageLine(
  storage: MobileFsStats | null | undefined,
  now: number
): string | null {
  if (!storage || typeof storage !== 'object') return null;
  const area = storage.byArea ?? ({} as MobileFsStats['byArea']);
  const emfile = storage.emfile ?? ({} as MobileFsStats['emfile']);
  const topUp = storage.topUp ?? ({} as MobileFsStats['topUp']);
  const boot = storage.boot ?? ({} as MobileFsStats['boot']);
  const emfileCount = count(emfile.count);
  const emfileLast = numOrNull(emfile.lastAt);
  const parts = [
    `files ${fmtInt(storage.files)} (notify ${fmtInt(area.notify)}, temp ${fmtInt(
      area.temp
    )}, resources ${fmtInt(area.resources)}, other ${fmtInt(area.other)})`,
    `open handles ${fmtInt(storage.openHandles)}`,
    `spares ${count(storage.spares)}/${count(storage.spareTarget)}${
      count(storage.reclaimable) > 0
        ? ` (reclaimable ${fmtInt(storage.reclaimable)})`
        : ''
    }`,
    `EMFILE ${fmtInt(emfileCount)}${
      emfileCount > 0 && emfileLast
        ? ` (last ${fmtEventTime(emfileLast, now)})`
        : ''
    }`,
    `top-up ${
      topUp.inFlight ? `running ${fmtMs(count(topUp.inFlightMs))}` : 'idle'
    } / max ${fmtMs(count(topUp.maxMs))}${
      topUp.retryPending ? ', retry waiting' : ''
    }${
      count(topUp.watchdogRestarts) > 0
        ? `, watchdog restarts ${count(topUp.watchdogRestarts)}`
        : ''
    }`,
    `opened ${fmtInt(topUp.opened)}, failed ${fmtInt(topUp.failed)} (last error ${
      topUp.lastErrorName ? safeLabel(topUp.lastErrorName, 32) : '-'
    })`,
    `boot dropped ${fmtInt(boot.dropped)}, evicted ${fmtInt(
      boot.evicted
    )}, open failed ${fmtInt(boot.openFailed)}`,
  ];
  return `Chat storage: ${parts.join(', ')}`;
}

/**
 * The sqlite shim: whether each database really runs in WAL (a fallback to
 * the old journal stays silent otherwise), how full the SAH pool is, and how
 * often a cached statement saved a prepare. File names are left out.
 */
export function formatChatDatabaseLine(
  sqlite: MobileSqliteStats | null | undefined
): string | null {
  if (!sqlite || typeof sqlite !== 'object') return null;
  const databases = Array.isArray(sqlite.databases) ? sqlite.databases : [];
  const modes = databases.map((db) =>
    db && typeof db.journalMode === 'string'
      ? safeLabel(db.journalMode, 12)
      : '?'
  );
  let hits = 0;
  let misses = 0;
  for (const db of databases) {
    hits += count(db?.statementHits);
    misses += count(db?.statementMisses);
  }
  const parts = [
    `journal ${modes.length > 0 ? modes.join(', ') : 'none open'}`,
    sqlite.pool
      ? `pool ${fmtInt(sqlite.pool.files)}/${fmtInt(sqlite.pool.capacity)} slots`
      : 'pool n/a',
    `statement cache ${fmtInt(hits)} hits / ${fmtInt(misses)} misses`,
  ];
  return `Chat database: ${parts.join(', ')}`;
}

/** Stages of the engine's stale-auth gate (`providerAuthSkipped_<type>_<stage>`). */
const PROVIDER_AUTH_SKIP_STAGE_RE =
  /_(entry|membership|read_check|built|pre_register|dequeue|queued)$/;

/** `providerAuthSkipped_history_page_pre_register` -> `history_page:pre_register`. */
function providerAuthSkipLabel(key: string): string {
  const rest = key.slice('providerAuthSkipped_'.length);
  const stage = PROVIDER_AUTH_SKIP_STAGE_RE.exec(rest);
  return safeLabel(stage ? `${rest.slice(0, stage.index)}:${stage[1]}` : rest);
}

/**
 * Counters the report always shows on their own lines: membership deferrals
 * (not queued, evicted, unknown without asking Core),
 * local storage failures, and provider auths skipped because the request was
 * already gone. Nothing when all are 0 or the engine is older.
 */
export function formatFocusCounterLines(
  focus: Record<string, number> | null | undefined
): string[] {
  if (!focus || typeof focus !== 'object') return [];
  const c = (key: string) => count(focus[key]);
  const lines: string[] = [];
  const deferrals: Array<[string, string]> = [
    ['deferred', 'membershipDeferred'],
    // With keepMembershipDeferredPulls the per-peer cap no longer drops
    // these; what is left is a pull queue with every item in flight.
    ['not queued', 'membershipDeferredDropped'],
    ['evicted', 'membershipDeferredEvicted'],
    ['unknown from backoff', 'membershipNullFromBackoff'],
    ['gap tries refunded', 'authorGapMembershipRefund'],
  ];
  if (deferrals.some(([, key]) => c(key) > 0)) {
    lines.push(
      `Membership deferrals: ${deferrals
        .map(([label, key]) => `${label} ${fmtInt(c(key))}`)
        .join(', ')}`
    );
  }
  if (c('membershipPrefetchPages') > 0) {
    lines.push(
      `Membership prefetch: pages ${fmtInt(
        c('membershipPrefetchPages')
      )}, authors ${fmtInt(c('membershipPrefetchAuthors'))}`
    );
  }
  if (c('localImportFailure') > 0) {
    lines.push(
      `Local storage failures (not charged to peers): ${fmtInt(
        c('localImportFailure')
      )}`
    );
  }
  const skipped = Object.entries(focus)
    .filter(([key]) => key.startsWith('providerAuthSkipped_'))
    .map(([key, n]): [string, number] => [providerAuthSkipLabel(key), count(n)])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const skippedTotal = c('providerAuthSkipped');
  if (skippedTotal > 0 || skipped.length) {
    lines.push(
      `Provider auths skipped (request already gone): ${fmtInt(skippedTotal)}${
        skipped.length
          ? ` (${skipped
              .slice(0, 6)
              .map(([label, n]) => `${label}=${n}`)
              .join(
                ' '
              )}${skipped.length > 6 ? ` +${skipped.length - 6} more` : ''})`
          : ''
      }`
    );
  }
  const queuedDropped = c('providerAuthEndedQueuedDropped');
  const stale = c('dmNotifyStale');
  if (queuedDropped > 0 || stale > 0) {
    lines.push(
      `Provider auths ended while queued: ${fmtInt(queuedDropped)}; stale DM notifies: ${fmtInt(stale)}`
    );
  }
  // Serving policy (GO): history serves refused as busy, by type and why
  // (`providerServeShed_<type>_<late|load>`); serves allowed on a recent Core
  // "member" answer while Core was down; requests fresh only at arrival.
  const shedByType = Object.entries(focus)
    .filter(([key]) => key.startsWith('providerServeShed_'))
    .map(([key, n]): [string, number] => {
      const rest = key.slice('providerServeShed_'.length);
      const why = /_(late|load)$/.exec(rest);
      return [
        safeLabel(why ? `${rest.slice(0, why.index)}:${why[1]}` : rest),
        count(n),
      ];
    })
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shed = c('providerServeShed');
  const staleMember = c('requesterMembershipStaleAllowed');
  const atArrival = c('serveFreshOnlyAtArrival');
  if (shed > 0 || shedByType.length || staleMember > 0 || atArrival > 0) {
    lines.push(
      `Serving policy: shed as busy ${fmtInt(shed)}${
        shedByType.length
          ? ` (${shedByType
              .slice(0, 6)
              .map(([label, n]) => `${label}=${n}`)
              .join(' ')})`
          : ''
      }; served on a recent member answer ${fmtInt(
        staleMember
      )}; fresh only at arrival ${fmtInt(atArrival)}`
    );
  }
  return lines;
}

/** The "Sync health" section from a `debug:sync-health` answer. */
export function formatSyncHealthLines(
  health: EngineSyncHealthSnapshot | null | undefined
): string[] {
  if (!health || typeof health !== 'object') return ['Not reported'];
  const lines: string[] = [];
  lines.push(
    ...safeLines('Chat storage', () => {
      const storage = formatChatStorageLine(
        health.storage,
        numOrNull(health.at) ?? Date.now()
      );
      return storage ? [storage] : [];
    })
  );
  lines.push(
    ...safeLines('Chat database', () => {
      const database = formatChatDatabaseLine(health.sqlite);
      return database ? [database] : [];
    })
  );
  if (health.engineError) {
    lines.push(
      `Engine getter failed: ${redactDiagnosticText(
        String(health.engineError)
      ).slice(0, 200)}`
    );
  }
  const engine = health.engine;
  if (!engine || typeof engine !== 'object') {
    lines.push('Chat manager: not running');
    return lines;
  }
  lines.push(
    ...safeLines('Gap scanner', () =>
      formatAuthorGapScannerLines(engine.scanner)
    ),
    ...safeLines('Digest queues', () =>
      formatDigestQueueLines(engine.digestQueues)
    ),
    ...safeLines('Engine queues', () => formatEngineQueueLines(engine.queues)),
    ...safeLines('Engine counters', () =>
      formatEngineCounterLines(engine.counters)
    ),
    ...safeLines('Focus counters', () =>
      formatFocusCounterLines(engine.focusCounters)
    )
  );
  return lines;
}

// ── channel metadata (debug:sync-health engine.channels) ────────────────────

const CHANNEL_METADATA_GROUP_LINES = 8;

/** How much is wrong with one group's channel metadata; 0 = nothing. */
function channelMetadataProblemScore(
  group: ReticulumChatChannelMetadataGroupDiagnostics
): number {
  let score =
    count(group.unprojectedCreates) * 4 +
    count(group.skippedEvents) * 3 +
    count(group.deferredProjections) * 2 +
    count(group.deferredSnapshots) * 2 +
    count(group.staleSignerSnapshots) +
    count(group.unknownAdminAuthors);
  if (group.lastSnapshotFailure) score += 1;
  if (group.snapshotState === 'missing_snapshot') score += 2;
  if (group.snapshotState === 'snapshot_stale') score += 1;
  if (group.expectedScope == null) score += 1;
  if (group.expectedScope === 'full' && group.fullVersion == null) score += 2;
  if (group.signerAdmin === 'no') score += 1;
  return score;
}

const SNAPSHOT_STATE_LABELS: Record<string, string> = {
  missing_snapshot: 'missing',
  snapshot_current: 'current',
  snapshot_stale: 'stale',
};

function formatChannelMetadataGroup(
  group: ReticulumChatChannelMetadataGroupDiagnostics,
  now: number
): string {
  const version = (v: unknown) =>
    numOrNull(v) != null ? `v${Math.trunc(v as number)}` : '-';
  const parts = [
    `admin ${group.localAdmin ? 'yes' : 'no'}${group.authoritative ? '' : ' (list not trusted)'}`,
    `scope ${group.expectedScope ?? 'unknown'}`,
    `snapshot ${
      group.snapshotState
        ? (SNAPSHOT_STATE_LABELS[group.snapshotState] ??
          safeLabel(group.snapshotState, 24))
        : 'none'
    } (public ${version(group.publicVersion)}, full ${version(group.fullVersion)}${
      group.signer
        ? `, signer ${group.signer === 'own' ? 'own' : 'other'} admin ${
            group.signerAdmin ?? 'unknown'
          }`
        : ''
    })`,
    `custom channels ${count(group.customChannels)}`,
  ];
  if (count(group.unprojectedCreates) > 0) {
    parts.push(`unprojected creates ${count(group.unprojectedCreates)}`);
  }
  if (count(group.skippedEvents) > 0) {
    parts.push(
      `skipped ${count(group.skippedEvents)} (own ${count(
        group.skippedOwn
      )}, creates by others ${count(group.skippedCreatesByOthers)}, other ${count(
        group.skippedOther
      )})`
    );
  }
  if (count(group.deferredProjections) > 0) {
    parts.push(
      `deferred ${count(group.deferredProjections)} (max ${count(
        group.deferredProjectionMaxAttempts
      )} tries)`
    );
  }
  if (count(group.unknownAdminAuthors) > 0) {
    parts.push(
      `authors with unknown admin status ${count(group.unknownAdminAuthors)}`
    );
  }
  if (count(group.deferredSnapshots) > 0) {
    parts.push(
      `deferred snapshots ${count(group.deferredSnapshots)} (max ${count(
        group.deferredSnapshotMaxAttempts
      )} tries)`
    );
  }
  if (count(group.staleSignerSnapshots) > 0) {
    parts.push(
      `ex-admin snapshots ignored ${count(group.staleSignerSnapshots)}`
    );
  }
  const failure = group.lastSnapshotFailure;
  if (failure && typeof failure === 'object') {
    parts.push(
      `last snapshot failure ${safeLabel(failure.reason, 40)} ${fmtAgo(
        failure.at,
        now
      )}`
    );
  }
  return `group=${Math.trunc(count(group.groupId))}: ${parts.join(', ')}`;
}

/**
 * The "Channel metadata" section: subscribed groups whose channels may not
 * show, worst first, at most 8 lines; the rest summed up. Group ids are
 * `group=` pairs, which the report pseudonymises.
 */
export function formatChannelMetadataLines(
  channels: ReticulumChatChannelMetadataDiagnostics | null | undefined,
  now: number
): string[] {
  if (!channels || typeof channels !== 'object') return ['Not reported'];
  const groups = (Array.isArray(channels.groups) ? channels.groups : []).filter(
    (g) => g && typeof g === 'object' && numOrNull(g.groupId) != null
  );
  const scored = groups
    .map((group) => ({ group, score: channelMetadataProblemScore(group) }))
    .sort(
      (a, b) =>
        b.score - a.score || count(a.group.groupId) - count(b.group.groupId)
    );
  const problems = scored.filter((entry) => entry.score > 0);
  const subscribed = count(channels.subscribedGroups);
  const lines = [
    `Channel metadata: ${subscribed} subscribed groups${
      subscribed > groups.length ? ` (${groups.length} checked)` : ''
    }, ${problems.length} with problems`,
  ];
  for (const { group } of problems.slice(0, CHANNEL_METADATA_GROUP_LINES)) {
    lines.push(formatChannelMetadataGroup(group, now));
  }
  if (problems.length > CHANNEL_METADATA_GROUP_LINES) {
    lines.push(
      `(+${problems.length - CHANNEL_METADATA_GROUP_LINES} more groups with problems)`
    );
  }
  const fine = scored.filter((entry) => entry.score === 0);
  if (fine.length) {
    lines.push(
      `(${fine.length} groups without problems: ${
        fine.filter((entry) => count(entry.group.customChannels) > 0).length
      } with custom channels, admin in ${
        fine.filter((entry) => entry.group.localAdmin).length
      })`
    );
  }
  return lines;
}

// ── engine time and page activity ────────────────────────────────────────────

/**
 * Python events waiting for the engine on the bridge socket (replies skip
 * this queue): how many now and at most, how long they waited, and the
 * stale gossip (and older digests) never handed to the engine. Null for an
 * older worker or before any event.
 */
export function formatSocketQueueLine(
  queue: NonNullable<EngineIoStats['socketQueue']> | null | undefined,
  now: number
): string | null {
  if (!queue || typeof queue !== 'object' || count(queue.enqueued) <= 0) {
    return null;
  }
  const oldest = numOrNull(queue.oldestAgeMs);
  const maxAt = numOrNull(queue.maxDepthAt);
  const parts = [
    `waiting ${fmtInt(queue.depth)}${oldest != null ? ` (oldest ${fmtMs(oldest)})` : ''}`,
    `most ${fmtInt(queue.maxDepth)}${maxAt != null ? ` at ${fmtEventTime(maxAt, now)}` : ''}`,
  ];
  if (hasSamples(queue.wait)) {
    parts.push(
      `wait p95 ${fmtP(queue.wait.p95)} max ${fmtMs(queue.wait.max)}${
        hasSamples(queue.waitRecent)
          ? `, last 10 min p95 ${fmtP(queue.waitRecent.p95)}`
          : ''
      }`
    );
  }
  if (count(queue.maxSliceMs) > 0) {
    parts.push(`longest slice ${fmtMs(count(queue.maxSliceMs))}`);
  }
  const dropped = count(queue.staleGossipDropped);
  parts.push(
    dropped > 0
      ? `stale gossip dropped ${fmtInt(dropped)} (${fmtCountMap(
          queue.staleGossipByKind
        )}${
          count(queue.digestsCoalesced) > 0
            ? `; ${fmtInt(queue.digestsCoalesced)} older digests merged`
            : ''
        })`
      : 'stale gossip dropped 0'
  );
  return `Socket event queue: ${parts.join('; ')}`;
}

/**
 * Where the engine's time goes: page -> engine RPCs per method (top 5 by
 * total time), SQLite commits and OPFS flushes per minute, the database's
 * size and rows, and the bridge socket's backlog. Nothing for an older
 * worker.
 */
export function formatEngineIoLines(
  io: EngineIoStats | null | undefined,
  db: EngineDbDiagnostics | null | undefined,
  now: number
): string[] {
  const lines: string[] = [];
  if (io && typeof io === 'object') {
    const methods = (Array.isArray(io.rpc?.methods) ? io.rpc.methods : [])
      .filter((m) => m && typeof m === 'object')
      .slice(0, 5);
    lines.push(
      methods.length
        ? `Engine RPCs (${fmtInt(io.rpc.calls)} since start; top by time): ${methods
            .map(
              (m) =>
                `${safeLabel(m.method, 40)} n=${fmtInt(m.n)} total ${fmtMs(
                  count(m.totalMs)
                )} p95 ${fmtP(m.p95)} max ${fmtMs(count(m.max))}${
                  count(m.syncMaxMs) >= 50
                    ? ` blocking max ${fmtMs(count(m.syncMaxMs))}`
                    : ''
                }${count(m.errors) > 0 ? ` errors ${count(m.errors)}` : ''}`
            )
            .join('; ')}`
        : 'Engine RPCs: none yet'
    );
    const commits = io.commits;
    const flush = io.flush;
    const sqlite: string[] = [];
    if (commits && typeof commits === 'object') {
      sqlite.push(
        count(commits.minutes) > 0
          ? `commits ${perMinute(commits.recent, count(commits.minutes))}/min (last ${count(
              commits.minutes
            )} min, ${fmtInt(commits.total)} since start)`
          : 'commits none yet'
      );
    }
    if (flush && typeof flush === 'object') {
      if (!flush.installed) {
        sqlite.push('OPFS flushes not measured');
      } else if (count(flush.rate?.minutes) > 0) {
        sqlite.push(
          `OPFS flushes ${perMinute(flush.rate.recent, count(flush.rate.minutes))}/min${
            hasSamples(flush.recent)
              ? `, flush p50 ${fmtP(flush.recent.p50)} p95 ${fmtP(
                  flush.recent.p95
                )} max ${fmtMs(flush.recent.max)}`
              : ''
          }`
        );
      } else {
        sqlite.push('OPFS flushes none yet');
      }
    }
    if (sqlite.length) lines.push(`SQLite: ${sqlite.join('; ')}`);
    const frames = io.socketFrames;
    if (frames && typeof frames === 'object' && count(frames.rate?.total) > 0) {
      const at = numOrNull(frames.maxBackToBackAt);
      lines.push(
        `Socket frames: ${perMinute(
          frames.rate.recent,
          count(frames.rate.minutes)
        )}/min (last ${count(frames.rate.minutes)} min); most handled back to back ${count(
          frames.maxBackToBack
        )}${at != null ? ` at ${fmtEventTime(at, now)}` : ''} (last 10 min ${count(
          frames.recentMaxBackToBack
        )})`
      );
    }
    const queueLine = formatSocketQueueLine(io.socketQueue, now);
    if (queueLine) lines.push(queueLine);
  }
  if (db && typeof db === 'object') {
    const writes = db.indexWrites;
    const fts = writes?.ftsCheck;
    const countedAt = numOrNull(db.countedAt);
    lines.push(
      `Chat database: ${
        numOrNull(db.sizeBytes) != null ? fmtBytes(db.sizeBytes) : 'size n/a'
      }${numOrNull(db.freeBytes) ? ` (free ${fmtBytes(db.freeBytes)})` : ''}, events ${
        numOrNull(db.events) != null ? fmtInt(db.events) : 'n/a'
      }, search rows ${
        numOrNull(db.searchRows) != null ? fmtInt(db.searchRows) : 'n/a'
      }${countedAt != null ? ` (counted ${fmtEventTime(countedAt, now)})` : ''}${
        writes && typeof writes === 'object'
          ? `; search writes ${fmtInt(writes.searchWritten)} (unchanged ${fmtInt(
              writes.searchUnchanged
            )}), mention writes ${fmtInt(writes.mentionsWritten)} (unchanged ${fmtInt(
              writes.mentionsUnchanged
            )})${
              fts && typeof fts === 'object'
                ? `; search index check ${safeLabel(fts.state ?? 'unknown', 16)}${
                    fts.rebuilt ? ', rebuilt' : ''
                  }`
                : ''
            }`
          : ''
      }`
    );
  }
  return lines;
}

/**
 * The page's own work: main-thread long tasks (what users feel as lag) and
 * the chat list's getSummaries refreshes. Nothing for older callers.
 */
export function formatPageActivityLines(
  longTasks: PageLongTaskStats | null | undefined,
  refresh: ReticulumSummaryRefreshStats | null | undefined,
  now: number
): string[] {
  const lines: string[] = [];
  if (longTasks && typeof longTasks === 'object') {
    if (!longTasks.installed) {
      lines.push('Page long tasks: not measured in this WebView');
    } else {
      const recent = longTasks.recent ?? {
        minutes: 0,
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };
      const maxAt = numOrNull(longTasks.maxAt);
      lines.push(
        `Page long tasks: ${
          count(recent.minutes) > 0
            ? `${fmtInt(recent.count)} in the last ${count(recent.minutes)} min (${fmtMs(
                count(recent.totalMs)
              )} in all, longest ${fmtMs(count(recent.maxMs))}); `
            : ''
        }since page start ${fmtInt(longTasks.count)} (${fmtMs(
          count(longTasks.totalMs)
        )}, over 1 s ${count(longTasks.over1s)}, longest ${fmtMs(
          count(longTasks.maxMs)
        )}${maxAt != null ? ` at ${fmtEventTime(maxAt, now)}` : ''})`
      );
    }
  }
  if (refresh && typeof refresh === 'object' && count(refresh.runs) > 0) {
    const runs = count(refresh.runs);
    const lastAt = count(refresh.lastAt);
    lines.push(
      `Summary refreshes: ${fmtInt(runs)} (${fmtInt(
        refresh.unchanged
      )} unchanged, ${fmtInt(refresh.coalesced)} joined a queued one); time last ${fmtMs(
        count(refresh.lastMs)
      )}, average ${fmtMs(count(refresh.totalMs) / runs)}, max ${fmtMs(
        count(refresh.maxMs)
      )}${lastAt > 0 ? `; last ${fmtAgo(lastAt, now)}` : ''}`
    );
  }
  return lines;
}

// ── engine loop and worker->native (debug:sync-health) ──────────────────────

/**
 * Engine loop lag (how late the worker's own timers fired), the longest
 * task, this request's wait in the worker, and bridge event delivery times.
 */
export function formatEngineLoopLines(
  health: EngineSyncHealthSnapshot | null | undefined,
  now: number
): string[] {
  if (!health || typeof health !== 'object') {
    return ['Engine loop: not reported'];
  }
  const lines: string[] = [];
  const loop: LoopLagSnapshot | null | undefined = health.loop;
  if (!loop || typeof loop !== 'object') {
    lines.push('Engine loop: not reported');
  } else {
    if (!loop.installed) {
      lines.push('Engine loop: not measured (probe not installed)');
    } else if (!hasSamples(loop.lagRecent) && !hasSamples(loop.lag)) {
      lines.push('Engine loop: no timer samples yet');
    } else {
      const recent = loop.lagRecent;
      const all = loop.lag;
      const parts = [
        hasSamples(recent)
          ? `lag p50 ${fmtP(recent.p50)}, p95 ${fmtP(recent.p95)}, max ${fmtMs(
              recent.max
            )} at ${fmtEventTime(recent.maxAt, now)} (last 10 min, ${count(
              recent.n
            )} timers)`
          : 'no timers in the last 10 min',
      ];
      if (hasSamples(all)) {
        parts.push(
          `since start p95 ${fmtP(all.p95)}, max ${fmtMs(all.max)}${
            hasSamples(recent) ? '' : ` at ${fmtEventTime(all.maxAt, now)}`
          }`
        );
      }
      if (count(loop.suspendedCount) > 0) {
        parts.push(
          `frozen ${count(loop.suspendedCount)}x (a timer 60 s or more late, longest ${fmtMs(
            count(loop.suspendedMaxMs)
          )})`
        );
      }
      lines.push(`Engine loop: ${parts.join('; ')}`);
    }
    const perMinute = Array.isArray(loop.lagPerMinute) ? loop.lagPerMinute : [];
    if (perMinute.some((ms) => numOrNull(ms) != null)) {
      lines.push(
        `Engine loop per minute (max lag, oldest first): ${perMinute
          .map((ms) => (numOrNull(ms) != null ? fmtMs(ms) : '-'))
          .join(', ')}`
      );
    }
    const longest = count(loop.longestTaskMs);
    lines.push(
      longest > 0
        ? `Longest task: ${fmtMs(longest)}${
            loop.longestTaskKind
              ? ` (${safeLabel(loop.longestTaskKind, 16)})`
              : ''
          }${
            numOrNull(loop.longestTaskAt) != null
              ? ` at ${fmtEventTime(loop.longestTaskAt, now)}`
              : ''
          }; tasks over 1 s: ${count(loop.tasksOver1s)}, over 50 ms: ${count(
            loop.tasksOver50Ms
          )}`
        : 'Longest task: none over 50 ms'
    );
  }
  const queued = numOrNull(health.rpcQueueMs);
  if (queued != null) {
    lines.push(
      `Diagnostics request waited ${fmtMs(queued)} in the engine queue`
    );
  }
  const events = health.bridgeEvents;
  const parts: string[] = [];
  if (events && typeof events === 'object') {
    if (hasSamples(events.pythonQueue)) {
      parts.push(
        `Python queue p95 ${fmtP(events.pythonQueue.p95)}, max ${fmtMs(
          events.pythonQueue.max
        )}`
      );
    }
    const toWorker = hasSamples(events.toWorkerRecent)
      ? { s: events.toWorkerRecent, window: 'last 10 min' }
      : hasSamples(events.toWorker)
        ? { s: events.toWorker, window: 'since start' }
        : null;
    if (toWorker) {
      parts.push(
        `Python to engine p95 ${fmtP(toWorker.s.p95)}, max ${fmtMs(
          toWorker.s.max
        )} (${toWorker.window}, ${count(toWorker.s.n)} events)`
      );
    }
  }
  lines.push(
    `Bridge events: ${parts.length ? parts.join('; ') : 'no samples'}`
  );
  return lines;
}

/** Worker->native requests: pending now, round trips, timeouts and late replies. */
export function formatNativeRequestLines(
  native: NativeRequestSnapshot | null | undefined
): string[] {
  if (!native || typeof native !== 'object') {
    return ['Worker->native: not reported'];
  }
  const oldest = (
    Array.isArray(native.oldestPending) ? native.oldestPending : []
  )
    .filter((p) => p && typeof p === 'object')
    .map(
      (p) =>
        `${safeLabel(p.label)}${count(p.count) > 1 ? ` x${count(p.count)}` : ''} ${fmtMs(
          count(p.oldestMs)
        )}`
    );
  const rtt = hasSamples(native.rttRecent)
    ? `${fmtLatency(native.rttRecent)} (last 10 min, ${count(native.rttRecent.n)})`
    : hasSamples(native.rtt)
      ? `${fmtLatency(native.rtt)} (since start, ${count(native.rtt.n)})`
      : 'no replies yet';
  const late = count(native.lateReplies);
  const byLabel = (Array.isArray(native.byLabel) ? native.byLabel : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const n = count(e.n);
      return `${safeLabel(e.label)} n=${n}${
        n > 0 ? ` p95 ${fmtP(e.p95)} max ${fmtMs(e.max)}` : ''
      }${count(e.timeouts) > 0 ? ` timeouts=${count(e.timeouts)}` : ''}${
        count(e.late) > 0 ? ` late=${count(e.late)}` : ''
      }`;
    });
  return [
    `Worker->native: ${count(native.pending)} pending${
      oldest.length ? ` (oldest ${oldest.join(', ')})` : ''
    }; round trip ${rtt}`,
    `Worker->native since start: timeouts ${count(
      native.timeouts
    )}, late replies ${late}${
      late > 0
        ? ` (up to ${fmtMs(count(native.lateByMaxMs))} after the timeout)`
        : ''
    }, unmatched ${count(native.unmatchedReplies)}, lost on socket close ${count(
      native.lostOnClose
    )}`,
    `Worker->native by command: ${byLabel.length ? byLabel.join('; ') : 'none'}`,
  ];
}

// ── serving (debug:sync-health) ──────────────────────────────────────────────

const SERVING_TYPE_LINES = 8;

/** What this phone served to peers: answers per resource type and step timing. */
export function formatServingLines(
  serving: ServingStats | null | undefined
): string[] {
  if (!serving || typeof serving !== 'object') return ['Serving: not reported'];
  const lines: string[] = [];
  const types = Object.entries(
    serving.byType && typeof serving.byType === 'object' ? serving.byType : {}
  )
    .filter(([, s]) => s && typeof s === 'object')
    .sort(
      (a, b) =>
        count(b[1].received) - count(a[1].received) || a[0].localeCompare(b[0])
    );
  if (!types.length) lines.push('Requests served: none yet');
  for (const [type, s] of types.slice(0, SERVING_TYPE_LINES)) {
    const late = count(s.late);
    lines.push(
      `${safeLabel(type).replace(/^reticulum_chat_/, '')}: received ${count(
        s.received
      )}, authorized ${count(s.authorized)}, rejected ${count(
        s.rejected
      )}, failed ${count(s.failed)}${late > 0 ? ` (late ${late})` : ''}, ended by Python ${count(
        s.ended
      )}`
    );
    // Newer workers say why they rejected, and how many rejects came after
    // Python had already given up (the peer saw Python's timeout instead).
    const reasons = fmtCountMap(s.rejectedReasons, 6);
    const lateRejected = count(s.lateRejected);
    if (reasons !== 'none' || lateRejected > 0) {
      lines.push(
        `  rejected by reason: ${reasons}${
          lateRejected > 0 ? `; ${lateRejected} after Python gave up` : ''
        }`
      );
    }
    // Python's auth event to the engine, per type: a p95 near Python's 15 s
    // answer window means this type's requests mostly arrive too late.
    if (hasSamples(s.authArrivalMs)) {
      lines.push(
        `  auth arrival p50 ${fmtP(s.authArrivalMs.p50)}, p95 ${fmtP(
          s.authArrivalMs.p95
        )}, max ${fmtMs(s.authArrivalMs.max)}`
      );
    }
  }
  if (types.length > SERVING_TYPE_LINES) {
    lines.push(`(+${types.length - SERVING_TYPE_LINES} more types)`);
  }
  lines.push(`Ended by Python: ${fmtCountMap(serving.endedReasons)}`);
  lines.push(`Authorize failures: ${fmtCountMap(serving.failedReasons)}`);
  const timing: string[] = [];
  if (hasSamples(serving.totalMs)) {
    timing.push(`arrival to answer ${fmtLatency(serving.totalMs)}`);
  }
  if (hasSamples(serving.pythonMs)) {
    timing.push(
      `Python admission p95 ${fmtP(serving.pythonMs.p95)}, max ${fmtMs(
        serving.pythonMs.max
      )}`
    );
  }
  if (hasSamples(serving.toWorkerMs)) {
    timing.push(
      `Python to engine p95 ${fmtP(serving.toWorkerMs.p95)}, max ${fmtMs(
        serving.toWorkerMs.max
      )}`
    );
  }
  if (hasSamples(serving.engineMs)) {
    timing.push(
      `in the engine p95 ${fmtP(serving.engineMs.p95)}, max ${fmtMs(
        serving.engineMs.max
      )}`
    );
  }
  lines.push(`Timing: ${timing.length ? timing.join('; ') : 'no samples'}`);
  const waiting = count(serving.waiting);
  const oldestWaiting = numOrNull(serving.oldestWaitingMs);
  lines.push(
    `Waiting for an answer now: ${waiting}${
      waiting > 0 && oldestWaiting != null
        ? ` (oldest ${fmtMs(oldestWaiting)})`
        : ''
    }`
  );
  return lines;
}

// ── Python bridge and Kotlin socket (Reticulum.getStatus({ detail: true })) ─

const NATIVE_BRIDGE_PROBE_TIMEOUT_MS = 3_000;
const PYTHON_LANE_LINES = 6;
const PYTHON_LANE_QUIET_DWELL_MS = 50;
/** Packet mix entries the report keeps (most bytes first). */
const PACKET_MIX_ENTRIES = 8;

/** `rx:0/3/1` (direction, packet type, destination type, context): digits only. */
function packetMixKey(raw: unknown): string {
  return (
    String(raw ?? '')
      .replace(/[^\w:/]/g, '_')
      .slice(0, 32) || '?'
  );
}

function sanitizeLane(raw: unknown): PythonBridgeLaneDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const lane = raw as Record<string, unknown>;
  const out: PythonBridgeLaneDetail = { lane: safeLabel(lane.lane, 48) };
  for (const key of [
    'queueDepth',
    'queueDepthHighWater',
    'queueMax',
    'dwellMsMax',
    'busyMsMax',
    'droppedTasks',
    'slowTaskCount',
    'completedTasks',
    'runningMs',
  ] as const) {
    const n = numOrNull(lane[key]);
    if (n != null) out[key] = n;
  }
  if (typeof lane.currentTask === 'string' && lane.currentTask) {
    out.currentTask = safeLabel(lane.currentTask, 48);
  }
  if (typeof lane.busyMaxTask === 'string' && lane.busyMaxTask) {
    out.busyMaxTask = safeLabel(lane.busyMaxTask, 48);
  }
  return out;
}

/** A label -> count map from another process: safe keys, at most `max` entries. */
function sanitizeCountRecord(
  raw: unknown,
  max = 16
): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(
    raw as Record<string, unknown>
  ).slice(0, max)) {
    const n = numOrNull(value);
    if (n != null) out[safeLabel(key, 48)] = n;
  }
  return out;
}

function sanitizeLinkCounts(raw: unknown): PythonBridgeLinkCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const links = raw as Record<string, unknown>;
  const out: PythonBridgeLinkCounts = {};
  for (const key of [
    'overlay',
    'audio',
    'inboundHandshakes',
    'fileLinks',
    'rnsActive',
    'rnsPending',
  ] as const) {
    const n = numOrNull(links[key]);
    if (n != null) out[key] = n;
  }
  const sessions = sanitizeCountRecord(links.resourceSessions);
  if (sessions) out.resourceSessions = sessions;
  return Object.keys(out).length ? out : null;
}

function sanitizeBridgeDetail(raw: unknown): PythonBridgeDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const detail = raw as Record<string, unknown>;
  const out: PythonBridgeDetail = {};
  if (typeof detail.error === 'string' && detail.error) {
    out.error = redactDiagnosticText(detail.error).slice(0, 160);
  }
  for (const key of [
    'transportStartedAtMs',
    'cmdQueue',
    'eventQueue',
    'priorityEventQueue',
    'respQueue',
    'executorIdleMs',
    'gilLagMsMax',
    'providerPendingAuth',
    'jsonOutDrops',
    'threadCount',
    'outQueue',
    'outQueueHighWater',
    'outQueueDrops',
    'openFds',
    'processCpuMs',
    'processCpuDeltaMs',
    'processCpuWindowMs',
    'rejectedResourceWatchdogs',
  ] as const) {
    const n = numOrNull(detail[key]);
    if (n != null) out[key] = n;
  }
  const links = sanitizeLinkCounts(detail.links);
  if (links) out.links = links;
  const refusedByKind = sanitizeCountRecord(
    detail.providerRefusedByBusyKind,
    32
  );
  if (refusedByKind) out.providerRefusedByBusyKind = refusedByKind;
  const cmdQueueMax = numOrNull(detail.cmdQueueMax);
  if (cmdQueueMax != null) out.cmdQueueMax = cmdQueueMax;
  if (Array.isArray(detail.lanes)) {
    out.lanes = detail.lanes
      .map(sanitizeLane)
      .filter((lane): lane is PythonBridgeLaneDetail => lane != null);
  }
  if (detail.providerRefused && typeof detail.providerRefused === 'object') {
    const refused: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      detail.providerRefused as Record<string, unknown>
    ).slice(0, 16)) {
      const n = numOrNull(value);
      if (n != null) refused[safeLabel(key, 32)] = n;
    }
    out.providerRefused = refused;
  }
  return out;
}

function sanitizeSocketDetail(raw: unknown): KotlinSocketDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const socket = raw as Record<string, unknown>;
  return {
    clients: count(socket.clients),
    dropped: count(socket.dropped),
    queued: count(socket.queued),
    queuedMax: count(socket.queuedMax),
    queueCapacity: count(socket.queueCapacity),
    handoverFrames: count(socket.handoverFrames),
  };
}

/**
 * The Android bridge's lanes, queues and socket, read once for the report.
 * The plugin call can wait behind a Python stall (the GIL), so it is bounded.
 * Null off Android, on an older app, on a plugin error or a timeout.
 */
export async function probeNativeBridge(
  timeoutMs = NATIVE_BRIDGE_PROBE_TIMEOUT_MS
): Promise<NativeBridgeDiagnostics | null> {
  if (!isAndroidApp()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const status = (await Promise.race([
      Promise.resolve()
        .then(() => Reticulum.getStatus({ detail: true }))
        .catch(() => null),
      timeout,
    ])) as Record<string, unknown> | null;
    if (!status || typeof status !== 'object') return null;
    const nativeDetail =
      status.native && typeof status.native === 'object'
        ? (status.native as Record<string, unknown>)
        : null;
    const result: NativeBridgeDiagnostics = {
      bridge: sanitizeBridgeDetail(status.bridge),
      processStartedAtMs: numOrNull(nativeDetail?.processStartedAtMs),
      socket: sanitizeSocketDetail(nativeDetail?.socket),
    };
    const callAudioIo = sanitizeCallAudioIo(
      status.bridge && typeof status.bridge === 'object'
        ? (status.bridge as Record<string, unknown>).callAudioIo
        : null
    );
    if (callAudioIo) result.callAudioIo = callAudioIo;
    if (typeof status.cryptoBackend === 'string' && status.cryptoBackend) {
      result.cryptoBackend = safeLabel(status.cryptoBackend, 32);
    }
    if (Array.isArray(status.packetMix)) {
      result.packetMix = status.packetMix
        .filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === 'object')
        )
        .map((entry) => ({
          key: packetMixKey(entry.key),
          count: count(entry.count),
          bytes: count(entry.bytes),
        }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, PACKET_MIX_ENTRIES);
    }
    const gone =
      nativeDetail?.rendererGone &&
      typeof nativeDetail.rendererGone === 'object'
        ? (nativeDetail.rendererGone as Record<string, unknown>)
        : null;
    if (gone && numOrNull(gone.at) != null) {
      result.rendererGone = {
        at: gone.at as number,
        crashed: gone.crashed === true,
        count: count(gone.count),
      };
    }
    const staged =
      nativeDetail?.stagedResources &&
      typeof nativeDetail.stagedResources === 'object'
        ? (nativeDetail.stagedResources as Record<string, unknown>)
        : null;
    if (staged) {
      result.stagedResources = {
        files: count(staged.files),
        bytes: count(staged.bytes),
        oldestAgeMs: count(staged.oldestAgeMs),
      };
    }
    // An older app answers without either part: say "not reported".
    if (!result.bridge && result.processStartedAtMs == null && !result.socket) {
      return null;
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A page that started this soon after a renderer death replaced that page. */
const RENDERER_GONE_PAGE_WINDOW_MS = 5 * 60_000;

/**
 * The last WebView renderer death (MainActivity.onRenderProcessGone). When
 * this page started right after it, that is why the page restarted.
 */
export function formatRendererGoneLine(
  gone: NativeBridgeDiagnostics['rendererGone'],
  pageStartedAt: number | null | undefined,
  now: number
): string | null {
  if (!gone || typeof gone !== 'object' || numOrNull(gone.at) == null) {
    return null;
  }
  const page = numOrNull(pageStartedAt);
  const since = `${count(gone.count)} since install`;
  if (
    page != null &&
    gone.at <= page &&
    page - gone.at <= RENDERER_GONE_PAGE_WINDOW_MS
  ) {
    return `Previous page ended: renderer gone (crashed ${
      gone.crashed ? 'yes' : 'no'
    }) at ${fmtEventTime(gone.at, now)}; ${since}`;
  }
  return `Last renderer death: ${fmtEventTime(gone.at, now)} (${fmtAgo(
    gone.at,
    now
  )}), crashed ${gone.crashed ? 'yes' : 'no'}; ${since}`;
}

/**
 * Python's process and links: threads, open fds, CPU, the frame queue to
 * Kotlin, spinning watchdogs of rejected resources, and open links by kind.
 * Nothing for an older app.
 */
export function formatPythonProcessLines(
  bridge: PythonBridgeDetail | null | undefined
): string[] {
  if (!bridge || typeof bridge !== 'object') return [];
  const lines: string[] = [];
  const parts: string[] = [];
  if (numOrNull(bridge.threadCount) != null) {
    parts.push(`threads ${count(bridge.threadCount)}`);
  }
  if (numOrNull(bridge.openFds) != null) {
    parts.push(`open fds ${count(bridge.openFds)}`);
  }
  if (numOrNull(bridge.processCpuMs) != null) {
    const window = count(bridge.processCpuWindowMs);
    parts.push(
      `CPU ${fmtMs(count(bridge.processCpuMs))} since start${
        numOrNull(bridge.processCpuDeltaMs) != null && window > 0
          ? `, ${Math.round(
              (count(bridge.processCpuDeltaMs) / window) * 100
            )}% of one core over the last ${fmtAge(window)}`
          : ''
      }`
    );
  }
  if (numOrNull(bridge.outQueue) != null) {
    parts.push(
      `frames to Kotlin ${count(bridge.outQueue)} (most ${count(
        bridge.outQueueHighWater
      )}, dropped ${count(bridge.outQueueDrops)})`
    );
  }
  if (numOrNull(bridge.rejectedResourceWatchdogs) != null) {
    parts.push(
      `rejected resource watchdogs ${count(bridge.rejectedResourceWatchdogs)}`
    );
  }
  if (parts.length) lines.push(`Python process: ${parts.join(', ')}`);
  const links = bridge.links;
  if (links && typeof links === 'object') {
    const sessions = fmtCountMap(links.resourceSessions, 8);
    lines.push(
      `Python links: overlay ${count(links.overlay)}, audio ${count(
        links.audio
      )}, inbound handshakes ${count(links.inboundHandshakes)}, resource sessions ${
        sessions === 'none' ? '0' : sessions
      }, file links ${count(links.fileLinks)}; RNS active ${count(
        links.rnsActive
      )}, pending ${count(links.rnsPending)}`
    );
  }
  return lines;
}

/** Python CPU samples printed (the RNS packet thread first). */
const PYTHON_CPU_SAMPLE_LINES = 4;
const PYTHON_PACKET_THREAD = 'Thread (__job)';

/**
 * Where Python spent its CPU in the last CPU-hungry window: ticks per thread
 * family, then the top frames of a few stack samples, the RNS packet thread
 * (`Thread (__job)`) first. Nothing when Python sent no samples.
 */
export function formatPythonCpuStackLines(
  stacks: PythonCpuStacks | null | undefined,
  now: number
): string[] {
  if (!stacks || typeof stacks !== 'object') return [];
  const samples = (Array.isArray(stacks.samples) ? stacks.samples : []).filter(
    (s) => s && typeof s === 'object' && Array.isArray(s.frames)
  );
  if (!samples.length) return [];
  const families = (
    Array.isArray(stacks.cpuTicksByGroup) ? stacks.cpuTicksByGroup : []
  )
    .filter((g) => g && typeof g === 'object')
    .map((g) => `${String(g.name).slice(0, 48)} ${count(g.ticks)}`)
    .join(', ');
  const ordered = [
    ...samples.filter((s) => s.group === PYTHON_PACKET_THREAD),
    ...samples.filter((s) => s.group !== PYTHON_PACKET_THREAD),
  ];
  const lines = [
    `Python CPU samples (${
      numOrNull(stacks.at) != null ? fmtEventTime(stacks.at, now) : 'n/a'
    }; ticks of 10 ms: total ${count(stacks.totalCpuTicks)}${
      families ? `, ${families}` : ''
    }):`,
  ];
  for (const sample of ordered.slice(0, PYTHON_CPU_SAMPLE_LINES)) {
    lines.push(
      `  ${String(sample.group).slice(0, 48)}: ${sample.frames
        .slice(0, 4)
        .map((frame) => String(frame).slice(0, 80))
        .join(' < ')}`
    );
  }
  if (ordered.length > PYTHON_CPU_SAMPLE_LINES) {
    lines.push(`  (+${ordered.length - PYTHON_CPU_SAMPLE_LINES} more samples)`);
  }
  return lines;
}

/** The "Python bridge" section: lanes, queues and the Kotlin socket. */
export function formatPythonBridgeLines(
  native: NativeBridgeDiagnostics | null | undefined,
  now: number,
  pageStartedAt?: number | null
): string[] {
  if (!native || typeof native !== 'object') {
    return ['Not reported (bridge not started, or an older app)'];
  }
  const lines: string[] = [];
  const bridge = native.bridge;
  const started = (at: number | null | undefined) =>
    numOrNull(at) != null
      ? `${fmtEventTime(at as number, now)} (${fmtAgo(at, now)})`
      : 'unknown';
  lines.push(
    `Transport started ${started(bridge?.transportStartedAtMs)}; app process started ${started(
      native.processStartedAtMs
    )}`
  );
  const rendererGone = formatRendererGoneLine(
    native.rendererGone,
    pageStartedAt,
    now
  );
  if (rendererGone) lines.push(rendererGone);
  const staged = native.stagedResources;
  if (staged && typeof staged === 'object') {
    const files = count(staged.files);
    lines.push(
      `Resource staging folder: ${fmtInt(files)} files, ${fmtBytes(
        staged.bytes
      )}${files > 0 ? `, oldest ${fmtAge(count(staged.oldestAgeMs))}` : ''}`
    );
  }
  if (!bridge) {
    lines.push('Python bridge: not reported (bridge not started)');
  } else {
    if (bridge.error) {
      lines.push(`Python bridge detail failed: ${bridge.error}`);
    }
    const n = (value: number | null | undefined) =>
      numOrNull(value) != null ? String(value) : 'n/a';
    lines.push(
      `Queues now: commands ${n(bridge.cmdQueue)} of ${n(
        bridge.cmdQueueMax
      )}, events ${n(bridge.eventQueue)}, priority events ${n(
        bridge.priorityEventQueue
      )}, replies ${n(bridge.respQueue)}; executor idle ${fmtMs(
        bridge.executorIdleMs
      )}; provider auths waiting ${n(
        bridge.providerPendingAuth
      )}; GIL lag (recent) ${fmtMs(bridge.gilLagMsMax)}; event drops ${n(
        bridge.jsonOutDrops
      )}`
    );
    lines.push(...formatPythonProcessLines(bridge));
    const lanes = Array.isArray(bridge.lanes) ? bridge.lanes : [];
    const busy = lanes
      .filter(
        (lane) =>
          count(lane.dwellMsMax) >= PYTHON_LANE_QUIET_DWELL_MS ||
          count(lane.queueDepth) > 0 ||
          count(lane.droppedTasks) > 0
      )
      .sort((a, b) => count(b.dwellMsMax) - count(a.dwellMsMax));
    if (!lanes.length) {
      lines.push('Lanes: not reported');
    } else if (!busy.length) {
      lines.push(
        `Lanes: all quiet (max dwell under ${PYTHON_LANE_QUIET_DWELL_MS} ms)`
      );
    } else {
      lines.push('Lanes (max since bridge start, worst dwell first):');
      for (const lane of busy.slice(0, PYTHON_LANE_LINES)) {
        lines.push(
          `  ${lane.lane} now ${count(lane.queueDepth)}, high ${count(
            lane.queueDepthHighWater
          )} of ${n(lane.queueMax)}, dwell max ${fmtMs(
            count(lane.dwellMsMax)
          )}, busy max ${fmtMs(count(lane.busyMsMax))}, slow ${count(
            lane.slowTaskCount
          )}, dropped ${count(lane.droppedTasks)}${
            lane.currentTask
              ? `, running ${lane.currentTask} ${fmtMs(lane.runningMs)}`
              : ''
          }${lane.busyMaxTask ? `, slowest ${lane.busyMaxTask}` : ''}`
        );
      }
      const quiet = lanes.length - busy.length;
      const moreBusy = busy.length - Math.min(busy.length, PYTHON_LANE_LINES);
      if (moreBusy > 0) lines.push(`  (+${moreBusy} more busy lanes)`);
      if (quiet > 0) lines.push(`  (+${quiet} quiet lanes)`);
    }
    const refused = fmtCountMap(bridge.providerRefused, 12);
    if (refused !== 'none') lines.push(`Provider refused: ${refused}`);
    const refusedByKind = fmtCountMap(bridge.providerRefusedByBusyKind, 12);
    if (refusedByKind !== 'none') {
      lines.push(
        `Provider refused by busy kind (since ${
          numOrNull(bridge.transportStartedAtMs) != null
            ? fmtEventTime(bridge.transportStartedAtMs as number, now)
            : 'bridge start'
        }): ${refusedByKind}`
      );
    }
  }
  if (native.cryptoBackend) {
    lines.push(`Crypto backend: ${safeLabel(native.cryptoBackend, 32)}`);
  }
  const mix = (Array.isArray(native.packetMix) ? native.packetMix : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, PACKET_MIX_ENTRIES);
  if (mix.length) {
    lines.push(
      `Packet mix (most bytes first; dir:type/destination/context): ${mix
        .map(
          (entry) =>
            `${packetMixKey(entry.key)} ${fmtInt(entry.count)}x ${fmtBytes(
              entry.bytes
            )}`
        )
        .join(', ')}`
    );
  }
  const socket = native.socket;
  lines.push(
    socket
      ? `Kotlin socket: ${count(socket.clients)} client(s), queued ${count(
          socket.queued
        )} (largest ${count(socket.queuedMax)} of ${count(
          socket.queueCapacity
        )}), dropped ${count(socket.dropped)}, kept for handover ${count(
          socket.handoverFrames
        )}`
      : 'Kotlin socket: not reported'
  );
  return lines;
}

// ── Calls (GO): Python audio I/O, Android call session, route, surface ───────

const CALL_AUDIO_IO_COUNTERS = [
  'rxFrames',
  'rxControl',
  'rxDropped',
  'rxMediaShed',
  'rxBadBatch',
  'txFrames',
  'txControl',
  'txNotQueued',
  'txRejected',
] as const;

function sanitizeCallAudioIo(raw: unknown): CallAudioIoDiagnostics | null {
  if (!raw || typeof raw !== 'object') return null;
  const io = raw as Record<string, unknown>;
  const out: CallAudioIoDiagnostics = {};
  for (const key of CALL_AUDIO_IO_COUNTERS) {
    const n = numOrNull(io[key]);
    if (n != null) out[key] = n;
  }
  if (typeof io.selfCheckOk === 'boolean') out.selfCheckOk = io.selfCheckOk;
  if (Array.isArray(io.selfCheckProblems)) {
    out.selfCheckProblems = io.selfCheckProblems
      .filter((p): p is string => typeof p === 'string' && !!p)
      .slice(0, 6)
      .map((p) => redactDiagnosticText(p).slice(0, 120));
  }
  if (typeof io.lastError === 'string' && io.lastError) {
    out.lastError = redactDiagnosticText(io.lastError).slice(0, 160);
  }
  return Object.keys(out).length ? out : null;
}

/** Keys that could carry an id, an address or a key: never printed. */
const CALL_PRIVATE_KEY_RE =
  /(id|ids|address|addresses|peer|room|chat|owner|hash|key|keys|name|names|url|sdp|candidate)$/i;
/**
 * A property-like key. A map keyed by addresses or short ids (an object
 * with any other key, e.g. the group runtime's WebRTC edges) is summed up
 * instead of walked, so its keys never reach the report.
 */
const CALL_SAFE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
/** A long run of base58 / hex in a text value: an address, key or id. */
const CALL_TOKEN_RE = /[A-Za-z0-9]{20,}/g;
const CALL_RECORD_MAX_DEPTH = 3;
const CALL_RECORD_MAX_ENTRIES = 40;

function fmtCallValue(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? String(Math.round(value * 100) / 100)
      : null;
  }
  if (typeof value === 'string') {
    return value
      ? safeLabel(redactDiagnosticText(value).replace(CALL_TOKEN_RE, 'id'), 40)
      : null;
  }
  if (value === null) return 'none';
  return null;
}

/** `open:2/connecting:1` for a map of states, else its size `[n]`. */
function summariseCallMap(map: Record<string, unknown>): string {
  const values = Object.values(map);
  if (!values.length || !values.every((v) => typeof v === 'string')) {
    return `[${values.length}]`;
  }
  const tally = new Map<string, number>();
  for (const v of values as string[]) {
    const label = safeLabel(v, 16);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label}:${n}`)
    .join('/');
}

type FormatCallRecordOptions = {
  /** Dotted keys left out (with everything under them). */
  skip?: readonly string[];
  /**
   * Numbers with 4 significant digits instead of 2 decimals (WebRTC levels
   * and energies are small fractions: 0.0004 must not print as 0).
   */
  precise?: boolean;
};

/** A finite number with 4 significant digits (integers as they are). */
function fmtPreciseNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(4)));
}

/**
 * `key=value` pairs of a record, nested objects flattened to dotted keys
 * (up to three levels: `tx.sentPackets`, `rtc.state`). Ids, addresses,
 * keys and names are left out: by key name (any level), maps keyed by them
 * are summed up, and long tokens in text values are masked.
 */
export function formatCallRecord(
  record: unknown,
  options: FormatCallRecordOptions = {}
): string {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return 'none';
  }
  const skip = new Set(options.skip ?? []);
  const parts: string[] = [];
  const push = (part: string) => {
    if (parts.length < CALL_RECORD_MAX_ENTRIES) parts.push(part);
  };
  const walk = (
    node: Record<string, unknown>,
    prefix: string,
    depth: number
  ) => {
    for (const [key, value] of Object.entries(node)) {
      if (parts.length >= CALL_RECORD_MAX_ENTRIES) return;
      if (!CALL_SAFE_KEY_RE.test(key) || CALL_PRIVATE_KEY_RE.test(key)) {
        continue;
      }
      const path = prefix ? `${prefix}.${key}` : key;
      if (skip.has(path)) continue;
      if (Array.isArray(value)) {
        push(`${path}=[${value.length}]`);
      } else if (value && typeof value === 'object') {
        const inner = value as Record<string, unknown>;
        const keys = Object.keys(inner);
        if (!keys.length || keys.some((k) => !CALL_SAFE_KEY_RE.test(k))) {
          push(`${path}=${summariseCallMap(inner)}`);
        } else if (depth < CALL_RECORD_MAX_DEPTH) {
          walk(inner, path, depth + 1);
        }
      } else {
        const text =
          options.precise && typeof value === 'number' && Number.isFinite(value)
            ? fmtPreciseNumber(value)
            : fmtCallValue(value);
        if (text != null) push(`${path}=${text}`);
      }
    }
  };
  walk(record as Record<string, unknown>, '', 1);
  return parts.length ? parts.join(', ') : 'none';
}

/**
 * The audio surface's snapshot (mobileAudioSurface
 * getMobileCallAudioDiagnostics): route and mic on one line, the 1:1 call,
 * its Reticulum leg counters and the group runtime on their own lines. The
 * privacy counters and the setting have their own lines already, and
 * `route.native` is what the "Audio route" line reads live from Android
 * (kept only when that read failed).
 */
function formatSurfaceLines(
  surface: Record<string, unknown>,
  routeReported: boolean
): string[] {
  const skip = ['at', 'privacy', 'transportPreference', 'direct', 'group'];
  if (routeReported) skip.push('route.native');
  const lines = [`Audio surface: ${formatCallRecord(surface, { skip })}`];
  if ('direct' in surface) {
    const direct = plainRecord(surface.direct);
    lines.push(
      `Audio surface 1:1: ${
        direct
          ? formatCallRecord(direct, { skip: ['reticulum', 'rtcStats'] })
          : 'none'
      }`
    );
    // RTP counters of the WebRTC leg (getStats, numbers only).
    const rtcStats = direct ? plainRecord(direct.rtcStats) : null;
    if (rtcStats) {
      lines.push(
        `Audio surface 1:1 WebRTC stats: ${formatCallRecord(rtcStats, {
          precise: true,
        })}`
      );
    }
    const reticulum = direct ? plainRecord(direct.reticulum) : null;
    if (reticulum) {
      lines.push(`Audio surface 1:1 Reticulum: ${formatCallRecord(reticulum)}`);
    }
  }
  if ('group' in surface) {
    const group = plainRecord(surface.group);
    lines.push(
      `Audio surface group: ${group ? formatCallRecord(group) : 'none'}`
    );
  }
  return lines;
}

/** A short label, or `fallback` when there is no value. */
function optLabel(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value ? safeLabel(value, max) : fallback;
}

function yesNoUnknown(value: unknown): string {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown';
}

/** The "Calls" section (GO). */
export function formatCallLines(
  calls: CallDiagnostics | null | undefined,
  callAudioIo: CallAudioIoDiagnostics | null | undefined
): string[] {
  const lines: string[] = [];
  const preference = calls?.transportPreference;
  lines.push(
    `Setting: ${
      preference === 'reticulum'
        ? 'Private calls (Reticulum only)'
        : preference === 'webrtc'
          ? 'Direct (WebRTC first, Reticulum fallback)'
          : 'unknown'
    }`
  );
  if (typeof calls?.stunServers === 'number') {
    lines.push(
      `STUN servers known: ${calls.stunServers}${
        calls.stunServers === 0 ? ' (calls stay on Reticulum for now)' : ''
      }`
    );
  }

  const native = calls?.native;
  if (!native || typeof native !== 'object') {
    lines.push('Android call session: not reported');
  } else {
    const ring =
      native.ringing === true
        ? `ringing (source ${optLabel(native.ringSource, 16, '?')}, posted ${yesNoUnknown(
            native.ringPosted
          )}, confirmed ${yesNoUnknown(native.ringConfirmed)}, silenced ${yesNoUnknown(
            native.ringSilenced
          )})`
        : 'not ringing';
    const active =
      native.callActive === true
        ? `call active (${optLabel(native.callKind, 8, '?')}, ${optLabel(
            native.callPhase,
            16,
            '?'
          )})`
        : 'no call';
    const typeFlags = numOrNull(native.foregroundTypeFlags);
    lines.push(
      `Android call session: ${ring}; ${active}; mic service ${yesNoUnknown(
        native.micForeground
      )}${typeFlags != null ? ` (types 0x${typeFlags.toString(16)})` : ''}; ring addresses ${count(
        native.ringAddresses
      )}; over lock ${yesNoUnknown(native.showWhenLocked)}; keyguard ${yesNoUnknown(
        native.keyguardLocked
      )}; screen on ${yesNoUnknown(native.interactive)}; Wi-Fi lock ${yesNoUnknown(
        native.wifiLock
      )}`
    );
  }

  const route = calls?.route;
  if (!route || typeof route !== 'object') {
    lines.push('Audio route: not reported');
  } else {
    const routes = Array.isArray(route.routes)
      ? route.routes
          .filter((r): r is string => typeof r === 'string')
          .map((r) => safeLabel(r, 12))
          .join(', ')
      : '';
    lines.push(
      `Audio route: ${optLabel(route.route, 12, 'none')} of [${routes || 'none'}]; in call ${yesNoUnknown(
        route.active
      )} (owners ${count(route.owners)}, kind ${optLabel(route.kind, 8, 'none')}); hand pick ${optLabel(
        route.explicitChoice,
        12,
        'none'
      )}; focus ${optLabel(route.focus, 16, 'none')}; proximity ${yesNoUnknown(
        route.proximity
      )}; mode ${numOrNull(route.mode) ?? 'n/a'}`
    );
  }

  if (!callAudioIo) {
    lines.push(
      'Python call audio: not reported (older app or bridge not started)'
    );
  } else {
    const n = (value: number | undefined) =>
      value != null ? String(value) : 'n/a';
    lines.push(
      `Python call audio: rx ${n(callAudioIo.rxFrames)} frames (control ${n(
        callAudioIo.rxControl
      )}), dropped ${n(callAudioIo.rxDropped)} (shed ${n(
        callAudioIo.rxMediaShed
      )}), bad batches ${n(callAudioIo.rxBadBatch)}; tx ${n(
        callAudioIo.txFrames
      )} frames (control ${n(callAudioIo.txControl)}), not queued ${n(
        callAudioIo.txNotQueued
      )}, rejected ${n(callAudioIo.txRejected)}; self-check ${
        callAudioIo.selfCheckOk === true
          ? 'ok'
          : callAudioIo.selfCheckOk === false
            ? `FAILED${
                callAudioIo.selfCheckProblems?.length
                  ? ` (${callAudioIo.selfCheckProblems.join('; ')})`
                  : ''
              }`
            : 'not run'
      }`
    );
    if (callAudioIo.lastError) {
      lines.push(`Python call audio last error: ${callAudioIo.lastError}`);
    }
  }

  if (calls?.surface) {
    lines.push(
      ...formatSurfaceLines(
        calls.surface,
        Boolean(calls.route && typeof calls.route === 'object')
      )
    );
  } else {
    lines.push(
      'Audio surface: not reported (no call audio counters in this build)'
    );
  }
  lines.push(
    calls?.webrtcPrivacy
      ? `WebRTC privacy guard: ${formatCallRecord(calls.webrtcPrivacy)}`
      : 'WebRTC privacy guard: not reported'
  );
  return lines;
}

const CALL_PROBE_TIMEOUT_MS = 2_000;

function settleWithin<T>(
  run: () => Promise<T> | T,
  timeoutMs: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([
    Promise.resolve()
      .then(run)
      .catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

const plainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * GO's call plumbing for the "Calls" section; undefined off GO (no section).
 * Each part is bounded and optional: a stalled plugin costs its line only.
 */
export async function probeCallDiagnostics(
  timeoutMs = CALL_PROBE_TIMEOUT_MS
): Promise<CallDiagnostics | undefined> {
  if (!isCapacitor()) return undefined;
  const surfaceReader = (
    mobileAudioSurface as unknown as {
      getMobileCallAudioDiagnostics?: () => unknown;
    }
  ).getMobileCallAudioDiagnostics;
  const [native, route, surface] = await Promise.all([
    settleWithin(() => getNativeCallDiagnostics(), timeoutMs),
    settleWithin(() => AudioRouting.getAudioRoutes(), timeoutMs),
    typeof surfaceReader === 'function'
      ? settleWithin(() => surfaceReader() as Promise<unknown>, timeoutMs)
      : Promise.resolve(null),
  ]);
  let transportPreference: string | null = null;
  try {
    transportPreference = getCallTransportPreference();
  } catch {
    transportPreference = null;
  }
  let webrtcPrivacy: Record<string, unknown> | null = null;
  try {
    webrtcPrivacy = plainRecord(getWebRtcPrivacyStats());
  } catch {
    webrtcPrivacy = null;
  }
  let stunServers: number | null = null;
  try {
    const known = (
      window as unknown as {
        hub?: { getBootstrapIceServers?: () => unknown };
      }
    ).hub?.getBootstrapIceServers?.();
    stunServers = Array.isArray(known) ? known.length : null;
  } catch {
    stunServers = null;
  }
  return {
    transportPreference,
    native: plainRecord(native),
    route: plainRecord(route),
    surface: plainRecord(surface),
    webrtcPrivacy,
    stunServers,
  };
}

// ── device facts ─────────────────────────────────────────────────────────────

const THERMAL_NAMES = [
  'none',
  'light',
  'moderate',
  'severe',
  'critical',
  'emergency',
  'shutdown',
];

/**
 * The "Device" section: the power state now (not the background-sync
 * setting), the network and relay profile, and the keep-alive service.
 */
export function formatDeviceLines(
  sync: BackgroundSyncDiagnostics | null | undefined,
  relay: {
    since: number | null;
    pageStartedAt: number | null | undefined;
    engineRelaying: boolean | null;
  },
  now: number
): string[] {
  if (!sync) return ['Not reported (not native Android, or an older app)'];
  const power = [
    sync.charging == null
      ? 'charging unknown'
      : sync.charging
        ? `charging${
            sync.plugType && sync.plugType !== 'none'
              ? ` via ${safeLabel(sync.plugType, 16)}`
              : ''
          }`
        : 'on battery',
  ];
  const batteryPct = numOrNull(sync.batteryPct);
  if (batteryPct != null) power.push(`battery ${batteryPct}%`);
  const batteryTempC = numOrNull(sync.batteryTempC);
  if (batteryTempC != null) power.push(`${batteryTempC.toFixed(1)} °C`);
  power.push(
    `power save ${sync.powerSave == null ? 'unknown' : sync.powerSave ? 'on' : 'off'}`
  );
  const thermal = numOrNull(sync.thermalStatus);
  power.push(
    `thermal ${thermal == null ? 'unknown' : (THERMAL_NAMES[thermal] ?? String(thermal))}`
  );
  const since =
    relay?.since != null
      ? `since ${fmtAgo(relay.since, now)}`
      : `since page start, ${fmtAgo(relay?.pageStartedAt, now)}`;
  return [
    `Power: ${power.join(', ')}`,
    `Network: unmetered ${
      sync.unmetered == null ? 'unknown' : sync.unmetered ? 'yes' : 'no'
    }; relay profile ${sync.relayProfile ? safeLabel(sync.relayProfile, 16) : 'unknown'} ${since}${
      relay?.engineRelaying == null
        ? ''
        : ` (engine relays group control: ${relay.engineRelaying ? 'yes' : 'no'})`
    }`,
    `Keep-alive: ${
      sync.keepAliveActive == null
        ? 'unknown'
        : sync.keepAliveActive
          ? 'active'
          : 'off'
    }`,
  ];
}

export function buildReticulumDiagnosticsReport(
  input: ReticulumDiagnosticsInput
): string {
  const { state, webView, engine, coreApi } = input;
  const pseudonyms = createDiagnosticPseudonymizer(input.pseudonymKey);
  const displayPhase = state.bridgeError
    ? 'error'
    : reticulumDisplayPhase(state.phase, input.onlineCount, input.deviceOnline);
  const engineReady = engine?.readiness.state === 'ready';
  // debug:sync-health (only asked for when the engine is ready).
  const syncHealth: EngineSyncHealthSnapshot | null =
    engineReady && engine?.syncHealth && typeof engine.syncHealth === 'object'
      ? engine.syncHealth
      : null;
  const syncHealthMissing = !engineReady
    ? 'Not reported (engine not ready)'
    : `Not reported (${
        engine?.syncHealthError
          ? redactDiagnosticText(String(engine.syncHealthError)).slice(0, 200)
          : 'no sync-health answer from this engine'
      })`;
  const lines: string[] = [];
  lines.push('Qortal GO diagnostics');
  lines.push(`GO version: ${input.version}`);
  lines.push(`Time: ${new Date(input.now).toISOString()}`);
  lines.push(
    'Ids: addresses, names, group/peer/file ids, IP addresses and your own node host are per-report pseudonyms (<addr-…>, <id-…>, <ip-…>, <node-…>)'
  );
  lines.push('');
  lines.push('--- WebView ---');
  lines.push(`User agent: ${webView.userAgent || 'unknown'}`);
  const nativeRuntime = input.unlock?.runtime ?? null;
  lines.push(`WebView: ${formatWebViewProvider(nativeRuntime)}`);
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
  const probeRatio = jitProbeRatio(webView.jsLoopMs, webView.builtinRefMs);
  const jit = jitVerdict({
    webViewJitRestricted: nativeRuntime?.webViewJitRestricted,
    webAssembly: webView.webAssembly,
    probeRatio,
  });
  lines.push(`JIT: ${jit.verdict} (${jit.basis})`);
  lines.push(formatJitProbeLine(webView, probeRatio));
  lines.push('');
  lines.push('--- Device ---');
  lines.push(
    ...safeLines('Device', () =>
      formatDeviceLines(
        input.backgroundSync,
        {
          since: numOrNull(input.relayProfileSince),
          pageStartedAt: numOrNull(input.pageStartedAt),
          engineRelaying:
            typeof syncHealth?.engine?.queues?.relayGroupControl === 'boolean'
              ? syncHealth.engine.queues.relayGroupControl
              : null,
        },
        input.now
      )
    )
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
    )}`
  );
  if (engine) {
    const oldestRpc =
      engine.oldestRpc && typeof engine.oldestRpc === 'object'
        ? engine.oldestRpc
        : null;
    lines.push(
      `Worker alive: ${engine.workerAlive ? 'yes' : 'no'}, direct bridge socket: ${
        engine.workerHasDirectBridge ? 'yes' : 'no'
      }, RPCs in flight: ${engine.pendingRpcCount}${
        oldestRpc
          ? ` (oldest ${safeLabel(oldestRpc.method)} ${fmtMs(
              count(oldestRpc.ageMs)
            )})`
          : ''
      }`
    );
    if (syncHealth) {
      lines.push(
        ...safeLines('Engine loop', () =>
          formatEngineLoopLines(syncHealth, input.now)
        ),
        ...safeLines('Worker->native', () =>
          formatNativeRequestLines(syncHealth.native)
        )
      );
    }
    if (engineReady) {
      lines.push(formatResourceSessionsLine(engine.resourceSessions));
    }
    const bridgeTraffic = Array.isArray(engine.bridgeTraffic)
      ? engine.bridgeTraffic.slice(-3)
      : [];
    for (const traffic of bridgeTraffic) {
      lines.push(
        `Bridge traffic: ${String(traffic).replace(/^\[MobileChat\]\s*/, '')}`
      );
    }
    if (syncHealth) {
      lines.push(
        ...safeLines('Engine time', () =>
          formatEngineIoLines(
            syncHealth.io,
            syncHealth.engine?.db ?? null,
            input.now
          )
        )
      );
    }
    if (engine.readiness.error) {
      lines.push(`Engine error: ${engine.readiness.error}`);
    }
  }
  lines.push(
    ...safeLines('Page activity', () =>
      formatPageActivityLines(
        input.pageLongTasks,
        input.summaryRefresh,
        input.now
      )
    )
  );
  if (state.bridgeWarning) lines.push(`Warning: ${state.bridgeWarning}`);
  if (state.bridgeError) lines.push(`Bridge error: ${state.bridgeError}`);
  lines.push('');
  lines.push('--- Sync health ---');
  lines.push(
    ...(syncHealth
      ? safeLines('Sync health', () => formatSyncHealthLines(syncHealth))
      : [syncHealthMissing])
  );
  lines.push('');
  // Newer engines only: an older one's report keeps its section list.
  if (syncHealth?.engine && syncHealth.engine.channels !== undefined) {
    lines.push('--- Channel metadata ---');
    lines.push(
      ...safeLines('Channel metadata', () =>
        formatChannelMetadataLines(syncHealth.engine?.channels, input.now)
      )
    );
    lines.push('');
  }
  lines.push('--- Serving ---');
  lines.push(
    ...(syncHealth
      ? safeLines('Serving', () => formatServingLines(syncHealth.serving))
      : [syncHealthMissing])
  );
  lines.push('');
  lines.push('--- Python bridge ---');
  lines.push(
    ...safeLines('Python bridge', () =>
      formatPythonBridgeLines(
        input.nativeBridge,
        input.now,
        numOrNull(input.pageStartedAt)
      )
    ),
    ...safeLines('Python CPU samples', () =>
      formatPythonCpuStackLines(syncHealth?.pythonCpuStacks, input.now)
    )
  );
  lines.push('');
  if (input.calls !== undefined) {
    lines.push('--- Calls ---');
    lines.push(
      ...safeLines('Calls', () =>
        formatCallLines(input.calls, input.nativeBridge?.callAudioIo)
      )
    );
    lines.push('');
  }
  lines.push('--- Background sync ---');
  lines.push(...formatBackgroundSyncLines(input.backgroundSync, input.now));
  lines.push('');
  lines.push('--- Core API ---');
  if (coreApi) {
    lines.push(
      `Node: ${pseudonyms.host(coreApi.host) || 'unknown'}, /admin/status: ${
        coreApi.ok
          ? `ok (${coreApi.httpStatus})`
          : coreApi.httpStatus != null
            ? `HTTP ${coreApi.httpStatus}`
            : `unreachable (${redactDiagnosticText(coreApi.error || 'error')})`
      } in ${fmtMs(coreApi.ms)}`
    );
    const nodeSync = formatCoreNodeStatusLine(coreApi.status);
    if (nodeSync) lines.push(nodeSync);
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
        `Membership API host: ${pseudonyms.host(engine.apiHost) || 'none'}${
          notes.length ? ` (${notes.join('; ')})` : ''
        }`
      );
    }
    const probe = engine.membershipProbe ?? null;
    lines.push(
      formatMembershipProbeLine(
        probe ? { ...probe, host: pseudonyms.host(probe.host) } : null,
        engineReady
      )
    );
    if (engineReady) {
      const validator = engine.validator ?? null;
      lines.push(
        formatValidatorLine(
          validator?.host
            ? { ...validator, host: pseudonyms.host(validator.host) }
            : validator,
          input.now
        )
      );
      lines.push(
        ...safeLines('Membership timing', () => {
          const timing = formatValidatorTimingLine(validator);
          return timing ? [timing] : [];
        }),
        ...safeLines('Membership failures', () =>
          formatValidatorFailureLines(validator, input.now)
        )
      );
    }
  }
  lines.push(
    ...safeLines('Admin list', () => {
      const adminList = formatAdminListLine(input.adminList, input.now);
      return adminList ? [adminList] : [];
    })
  );
  lines.push('');
  lines.push('--- Recent send failures ---');
  lines.push(
    ...safeLines('Send times', () => {
      const sendTimes = formatSendTimesLine(input.sendTimings);
      return sendTimes ? [sendTimes] : [];
    })
  );
  if (input.sendFailures.length === 0) {
    lines.push('none this session');
  } else {
    for (const failure of input.sendFailures.slice(-10)) {
      const at = new Date(failure.at).toISOString();
      let trail = '';
      try {
        trail = formatSendAttempts(failure.attemptLog);
      } catch {
        trail = ' [attempts: format error]';
      }
      lines.push(
        failure.outcome === 'recovered'
          ? `${at} target=${failure.target} attempts=${failure.attempts} recovered${trail}`
          : `${at} target=${failure.target} attempts=${failure.attempts}: ${failure.error}${trail}`
      );
    }
  }
  lines.push('');
  lines.push('--- Recent app errors ---');
  lines.push(...formatAppErrorLines(input.appErrors));
  lines.push('');
  lines.push('--- Engine log (faults, then tail) ---');
  const engineLogLines = engine
    ? selectEngineLogLines(engine.engineLogs ?? [], engine.engineBootFaults, {
        bootOverflow: syncHealth?.log?.bootFaultOverflow,
        keyCounts: syncHealth?.log?.keyCounts,
        bootRepeatsFolded: syncHealth?.log?.bootFaultRepeatsFolded,
      })
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
  // carry keys or tokens), no API key value and no raw identifier, whatever
  // the source line.
  return lines
    .map((line) => pseudonyms.line(redactDiagnosticText(line)))
    .join('\n');
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
  const [engine, coreApi, unlockRuntime, backgroundSync, nativeBridge, calls] =
    await Promise.all([
      getMobileReticulumChatDiagnostics().catch(() => null),
      probeCoreApi().catch(() => null),
      probeUnlockRuntime().catch(() => null),
      fetchBackgroundSyncState().catch(() => null),
      probeNativeBridge().catch(() => null),
      probeCallDiagnostics().catch(() => null),
    ]);
  // Each extra is best effort: a failure costs its lines, never the report.
  const attempt = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
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
    sendTimings: attempt(() => getRecentSendTimings(), []),
    appErrors: attempt(() => collectAppErrorDiagnostics(), null),
    unlock: {
      events: getUnlockTimingSnapshot().events,
      runtime: unlockRuntime,
    },
    backgroundSync,
    nativeBridge,
    calls,
    relayProfileSince: attempt(() => getRelayProfileSince(), null),
    pageStartedAt: attempt(
      () => Math.round(performance.timeOrigin || Date.now()),
      undefined
    ),
    adminList: attempt(() => getReticulumAdminListFetchStats(), null),
    summaryRefresh: attempt(() => getReticulumSummaryRefreshStats(), null),
    pageLongTasks: attempt(() => getPageLongTaskStats(), null),
  });
}
