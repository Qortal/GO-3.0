/**
 * Logger shim for the mobile engine worker. The desktop logger writes to
 * userData/logs via Node `fs`/`module`/`util`; on mobile we simply forward to
 * the worker console (surfaced in the WebView remote console during bring-up).
 */
const PREFIX = '[MobileChat]';

/**
 * Recent engine log lines, readable from the page through the
 * `debug:logs` RPC. The WebView remote console only delivers a worker's
 * output to one DevTools client at a time, which makes it useless for
 * diagnosing sync issues while any other tool is attached.
 */
const RECENT_LOG_MAX = 600;
const recentLogs: string[] = [];
/**
 * The first warnings/errors since the worker booted. A busy engine cycles the
 * recent ring in well under a minute, which loses whatever went wrong at
 * startup by the time a user copies diagnostics. Bounded in lines and length.
 */
const BOOT_FAULT_MAX = 150;
const BOOT_FAULT_LINE_MAX_CHARS = 1_000;
const bootFaultLogs: string[] = [];
const remember = (level: string, args: unknown[]): void => {
  try {
    const text = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    const line = `${new Date().toISOString()} ${level} ${text}`;
    recentLogs.push(line);
    if (recentLogs.length > RECENT_LOG_MAX) {
      recentLogs.splice(0, recentLogs.length - RECENT_LOG_MAX);
    }
    if (
      (level === 'warn' || level === 'error') &&
      bootFaultLogs.length < BOOT_FAULT_MAX
    ) {
      bootFaultLogs.push(line.slice(0, BOOT_FAULT_LINE_MAX_CHARS));
    }
  } catch {
    /* logging must never throw */
  }
};
export const getBootFaultLogs = (): string[] => [...bootFaultLogs];
export const getRecentLogs = (filter?: string): string[] => {
  if (!filter) return [...recentLogs];
  let re: RegExp | null = null;
  try {
    re = new RegExp(filter, 'i');
  } catch {
    re = null;
  }
  return re ? recentLogs.filter((l) => re!.test(l)) : [...recentLogs];
};

/**
 * Throttle key for one worker console call: the level plus the first
 * meaningful token after any `[MobileChat]` / `[ReticulumChat]` prefixes, so
 * `dm_pending_redeliver` and `bridge_socket_connected` get separate budgets.
 * A snake_case token stands alone; prose keeps up to three leading words,
 * stopping before anything that looks like a value (ids, `k=v`, numbers).
 */
export const logThrottleKey = (level: string, args: unknown[]): string => {
  for (const arg of args) {
    if (typeof arg !== 'string') break;
    const rest = arg.replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();
    if (!rest) continue;
    const words = rest.split(/\s+/);
    const picked = [words[0]];
    if (!words[0].includes('_')) {
      for (const word of words.slice(1, 3)) {
        if (/[=:{}[\]()\d]/.test(word)) break;
        picked.push(word);
      }
    }
    const token = picked
      .join(' ')
      .replace(/[:,.]+$/, '')
      .slice(0, 64);
    return `${level}:${token}`;
  }
  return `${level}:${String(args[0] ?? '').slice(0, 120)}`;
};

export type LogThrottleDecision = { emit: boolean; summary: string | null };

/**
 * DM page serve outcomes (`dm_page_link_authorized`, `_delivered`,
 * `_delivery_failed`, `_skipped`, ...) are one line per live DM pull and are
 * what proves a GO DM reached its recipient, so they never share a budget
 * with noisy lines. They also do not use up the global budget.
 */
const UNTHROTTLED_TOKEN_PREFIXES = ['dm_page_link_'];
const isUnthrottledLogKey = (key: string): boolean => {
  const token = key.slice(key.indexOf(':') + 1);
  return UNTHROTTLED_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
};

/**
 * Fixed-window console throttle: at most `perKey` lines per key and
 * `global` lines overall per window (the summary line counts towards the
 * latter). Suppressed lines are reported once, lazily, by the first call
 * after the window ends; there is no timer.
 */
export const createLogThrottle = (
  opts: {
    windowMs?: number;
    perKey?: number;
    global?: number;
    maxKeys?: number;
  } = {}
) => {
  const windowMs = opts.windowMs ?? 10_000;
  const perKey = opts.perKey ?? 5;
  const global = opts.global ?? 15;
  const maxKeys = opts.maxKeys ?? 256;
  const seen = new Map<string, { emitted: number; suppressed: number }>();
  let windowStart = -Infinity;
  let emitted = 0;
  let prunedSuppressed = 0;

  const summarize = (now: number): string | null => {
    let total = prunedSuppressed;
    const top: Array<[string, number]> = [];
    for (const [key, entry] of seen) {
      if (entry.suppressed === 0) continue;
      total += entry.suppressed;
      top.push([key, entry.suppressed]);
    }
    if (total === 0) return null;
    top.sort((a, b) => b[1] - a[1]);
    const shown = top
      .slice(0, 5)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    const more = top.length > 5 ? ` +${top.length - 5} more` : '';
    const secs = Math.round((now - windowStart) / 1000);
    return `[MobileChat] (${total} lines suppressed in ${secs}s: ${shown}${more})`;
  };

  return (
    level: string,
    args: unknown[],
    now: number = Date.now()
  ): LogThrottleDecision => {
    let summary: string | null = null;
    if (now - windowStart >= windowMs) {
      summary = Number.isFinite(windowStart) ? summarize(now) : null;
      seen.clear();
      prunedSuppressed = 0;
      windowStart = now;
      emitted = summary ? 1 : 0;
    }
    const key = logThrottleKey(level, args);
    if (isUnthrottledLogKey(key)) return { emit: true, summary };
    let entry = seen.get(key);
    if (!entry) {
      if (seen.size >= maxKeys) {
        // Drop the oldest key but keep its suppressed lines in the total.
        const [oldKey, oldEntry] = seen.entries().next().value!;
        prunedSuppressed += oldEntry.suppressed;
        seen.delete(oldKey);
      }
      entry = { emitted: 0, suppressed: 0 };
      seen.set(key, entry);
    }
    if (entry.emitted < perKey && emitted < global) {
      entry.emitted += 1;
      emitted += 1;
      return { emit: true, summary };
    }
    entry.suppressed += 1;
    return { emit: false, summary };
  };
};

export const log = (...args: unknown[]): void => {
  remember('log', args);
  console.log(PREFIX, ...args);
};
export const info = (...args: unknown[]): void => {
  remember('info', args);
  console.info(PREFIX, ...args);
};
export const warn = (...args: unknown[]): void => {
  remember('warn', args);
  console.warn(PREFIX, ...args);
};
export const error = (...args: unknown[]): void => {
  remember('error', args);
  console.error(PREFIX, ...args);
};
export const debug = (...args: unknown[]): void => {
  /* quiet by default on device */
  void args;
};

export default { log, info, warn, error, debug };
