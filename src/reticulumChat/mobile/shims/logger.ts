/**
 * Logger shim for the mobile engine worker. The desktop logger writes to
 * userData/logs via Node `fs`/`module`/`util`; on mobile we simply forward to
 * the worker console (surfaced in the WebView remote console during bring-up).
 */
const PREFIX = '[MobileChat]';

export const log = (...args: unknown[]): void => console.log(PREFIX, ...args);
export const info = (...args: unknown[]): void => console.info(PREFIX, ...args);
export const warn = (...args: unknown[]): void => console.warn(PREFIX, ...args);
export const error = (...args: unknown[]): void =>
  console.error(PREFIX, ...args);
export const debug = (...args: unknown[]): void => {
  /* quiet by default on device */
  void args;
};

export default { log, info, warn, error, debug };
