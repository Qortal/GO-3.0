/**
 * Which engine log lines are faults, and what makes two lines "the same".
 *
 * Shared by the worker logger (its boot buffer keeps fault lines only) and the
 * Copy diagnostics report (reticulumDiagnostics.ts re-exports both). No
 * imports, so the engine worker can use it without pulling in app modules.
 */

/**
 * Engine log lines worth keeping when the ring has scrolled past them. Covers
 * membership, bridge overload/pauses, peer violations, refusals and give-ups,
 * and Python's stall watchdog. The watchdog tokens are explicit: a bare
 * `stall` would also match `install`.
 */
const ENGINE_FAULT_RE =
  /error|fail|slow_|timed out|membership|validat|corrupt|unavailable|overloaded|paused|violation|refusing|not a group member|giving up|deferred=[1-9]|bridge_stall|executor_stalled|executor_recovered|thread_population/i;
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
