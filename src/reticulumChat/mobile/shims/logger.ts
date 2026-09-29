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
const remember = (level: string, args: unknown[]): void => {
  try {
    const text = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    recentLogs.push(`${new Date().toISOString()} ${level} ${text}`);
    if (recentLogs.length > RECENT_LOG_MAX) {
      recentLogs.splice(0, recentLogs.length - RECENT_LOG_MAX);
    }
  } catch {
    /* logging must never throw */
  }
};
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
