/** `perf_hooks` stand-in: the web worker has a native `performance` global. */

export const performance = globalThis.performance;

export default { performance };
