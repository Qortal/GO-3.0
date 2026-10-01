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
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Run the production request once. Never throws. */
export async function runGroupValidationRequest(
  apiBase: string,
  groupId: number,
  address: string,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    now?: () => number;
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
  const { url, init } = buildGroupValidationRequest(apiBase, groupId, address);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
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
      };
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      return {
        row: null,
        status,
        error: 'unexpected response body',
        ms: now() - started,
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
    };
  } catch (err) {
    return {
      row: null,
      status,
      error: timedOut
        ? `AbortError: no answer in ${timeoutMs} ms`
        : describeError(err),
      ms: now() - started,
    };
  } finally {
    clearTimeout(timer);
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
  };
}

export function recordGroupValidation(
  stats: GroupValidatorStats,
  outcome: GroupValidationOutcome,
  host: string,
  at = Date.now()
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
