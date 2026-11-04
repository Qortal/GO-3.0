/**
 * Opens a Q-App as soon as the node can serve it, when the node's own loading
 * page would keep waiting.
 *
 * Until an app is built, Core answers /render/<SERVICE>/<name> with its
 * "Loading - Qortal Network" page (HTTP 503). That page reloads itself only
 * when /arbitrary/resource/status says READY, and on the public node the
 * status is not to be trusted: ext-node.qortal.link (Core 6.1.9, Nov 2026)
 * answered MISSING_DATA 0/2 for Keygen and Q-Assets, and flipped between
 * MISSING_DATA and READY from one second to the next, while /render itself
 * served the app every time. People sat on the loading page until they
 * tapped refresh, which asks /render again and gets the app.
 *
 * The script below runs at document start in Q-App frames (installed
 * natively with the others, see qappFrameScripts.ts). On Core's loading page,
 * and nowhere else, it asks the node for the page itself (HEAD, never from a
 * cache) every few seconds and reloads the frame once the node serves it.
 * Each ask is the same request a refresh makes, so it also gets the node
 * fetching and building the app. The loading page keeps running as before.
 *
 * It also stills the page's moving background after a moment. That canvas is
 * redrawn on every frame and kept the phone's GPU fully busy (vivo, Nov 2026:
 * GPU 100%, GO at 32 fps, each screen draw 29 ms; with it still: GPU 1%, GO
 * at 60 fps, 8 ms). GO's frames waited on it wherever the page was on screen,
 * under the Tabs panel too, so dragging Tabs over such an app stuttered.
 * Capping it at 15 fps still left the GPU at 66%. The spinner, status and
 * progress are page elements and keep moving.
 */

/** Core's loading page reloads by itself when it can; GO asks after this. */
export const QAPP_LOADING_FIRST_CHECK_MS = 4_000;
export const QAPP_LOADING_CHECK_MS = 5_000;
/** After this long the node is asked less often... */
export const QAPP_LOADING_SLOW_AFTER_MS = 2 * 60_000;
export const QAPP_LOADING_SLOW_CHECK_MS = 15_000;
/** ...and after this long not at all; refresh still works. */
export const QAPP_LOADING_GIVE_UP_MS = 15 * 60_000;
export const QAPP_LOADING_TIMEOUT_MS = 15_000;
/**
 * The public node answers from two copies that do not hold the same apps
 * (one said 0/2 files while the other counted 6/8 up to READY, request by
 * request), so a reload can land on the loading page again. Per address the
 * page is reloaded at most this many times in the window; past that GO keeps
 * asking and reloads once the window allows.
 */
export const QAPP_LOADING_MAX_RELOADS = 3;
export const QAPP_LOADING_RELOAD_WINDOW_MS = 3 * 60_000;
/** sessionStorage key (the node's origin) for the reload count. */
export const QAPP_LOADING_RELOADS_KEY = '__goQdnLoadingReloads';
/**
 * The loading page started reloading itself this recently: GO leaves it to
 * that, instead of starting the load over (seen on the phone: a second load
 * right behind Core's own). Past this, the page is treated as still waiting.
 */
export const QAPP_LOADING_LEAVING_GRACE_MS = 5_000;
/** The loading page's background moves this long, then stays still. */
export const QAPP_LOADING_BACKGROUND_STILL_MS = 1_500;

type QappLoadingPageWatchOptions = {
  firstCheckMs: number;
  checkMs: number;
  slowAfterMs: number;
  slowCheckMs: number;
  giveUpMs: number;
  timeoutMs: number;
  maxReloads: number;
  reloadWindowMs: number;
  reloadsKey: string;
  leavingGraceMs: number;
  backgroundStillMs: number;
};

/**
 * The watcher itself. It is serialised into the frame, so it must stay
 * self-contained: no imports, no closures over module scope, plain ES2017
 * (bundler helpers do not survive toString()).
 */
function qappLoadingPageWatch(
  topOrigin: string,
  options: QappLoadingPageWatchOptions
): void {
  const w = window as any;
  const d = document;
  try {
    if (w.top === w || location.origin === topOrigin) return;
    if (w.__goQdnLoadingWatch) return;
    w.__goQdnLoadingWatch = true;
  } catch {
    return;
  }
  // Core sends its loading page only for a name it has not built yet.
  if (!/^\/render\/[A-Z0-9_]+\/[^/]+/.test(location.pathname)) return;

  // Core's page: its title and the panel its script fills in.
  const isLoadingPage = () =>
    d.title === 'Loading - Qortal Network' &&
    !!d.getElementById('panel-outer') &&
    !!d.getElementById('status') &&
    !!d.getElementById('progress');

  const mayReload = () => {
    try {
      const now = Date.now();
      const raw = w.sessionStorage.getItem(options.reloadsKey);
      const all = raw ? JSON.parse(raw) : {};
      const kept: Record<string, number[]> = {};
      Object.keys(all).forEach((path) => {
        const times = (Array.isArray(all[path]) ? all[path] : []).filter(
          (t: unknown) =>
            typeof t === 'number' && now - t < options.reloadWindowMs
        );
        if (times.length) kept[path] = times;
      });
      const mine = kept[location.pathname] || [];
      if (mine.length >= options.maxReloads) return false;
      kept[location.pathname] = mine.concat(now);
      w.sessionStorage.setItem(options.reloadsKey, JSON.stringify(kept));
    } catch {
      /* no storage: the time limit below still applies */
    }
    return true;
  };

  // The background is a canvas that requests a new frame each time it draws
  // one: once still, its next request is the last.
  const stillBackgroundSoon = () => {
    const nativeRaf = w.requestAnimationFrame;
    if (typeof nativeRaf !== 'function') return;
    let still = false;
    w.requestAnimationFrame = function () {
      if (still) return 0;
      // eslint-disable-next-line prefer-rest-params
      return nativeRaf.apply(w, arguments);
    };
    setTimeout(() => {
      still = true;
    }, options.backgroundStillMs);
  };

  const start = () => {
    if (!isLoadingPage()) return;
    stillBackgroundSoon();
    const startedAt = Date.now();
    let timer: any = null;
    let busy = false;
    let done = false;
    let leavingAt = Number.NEGATIVE_INFINITY;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(check, ms);
    };
    const nextDelay = () =>
      Date.now() - startedAt < options.slowAfterMs
        ? options.checkMs
        : options.slowCheckMs;

    function check() {
      timer = null;
      if (done || busy) return;
      if (Date.now() - startedAt > options.giveUpMs) {
        done = true;
        return;
      }
      // GO is off screen: asked again when it is back.
      if (d.hidden) return;
      busy = true;
      let controller: any = null;
      try {
        controller = new w.AbortController();
      } catch {
        controller = null;
      }
      const abortTimer = controller
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : null;
      Promise.resolve()
        .then(() =>
          w.fetch(location.href, {
            method: 'HEAD',
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller ? controller.signal : undefined,
          })
        )
        .then(
          (res: any) => {
            if (done || !res || res.status !== 200) return;
            // Core's page is reloading itself already.
            if (Date.now() - leavingAt < options.leavingGraceMs) return;
            // Reloaded often just now: ask again, reload when allowed.
            if (!mayReload()) return;
            done = true;
            location.reload();
          },
          () => {
            /* no answer this time */
          }
        )
        .then(() => {
          clearTimeout(abortTimer);
          busy = false;
          if (!done) schedule(nextDelay());
        });
    }

    d.addEventListener('visibilitychange', () => {
      if (!d.hidden && !done && !busy && !timer) schedule(0);
    });
    w.addEventListener('beforeunload', () => {
      leavingAt = Date.now();
    });
    schedule(options.firstCheckMs);
  };

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

export function buildQappLoadingPageWatchScript(topOrigin: string): string {
  const options: QappLoadingPageWatchOptions = {
    firstCheckMs: QAPP_LOADING_FIRST_CHECK_MS,
    checkMs: QAPP_LOADING_CHECK_MS,
    slowAfterMs: QAPP_LOADING_SLOW_AFTER_MS,
    slowCheckMs: QAPP_LOADING_SLOW_CHECK_MS,
    giveUpMs: QAPP_LOADING_GIVE_UP_MS,
    timeoutMs: QAPP_LOADING_TIMEOUT_MS,
    maxReloads: QAPP_LOADING_MAX_RELOADS,
    reloadWindowMs: QAPP_LOADING_RELOAD_WINDOW_MS,
    reloadsKey: QAPP_LOADING_RELOADS_KEY,
    leavingGraceMs: QAPP_LOADING_LEAVING_GRACE_MS,
    backgroundStillMs: QAPP_LOADING_BACKGROUND_STILL_MS,
  };
  return `(${qappLoadingPageWatch.toString()})(${JSON.stringify(topOrigin)}, ${JSON.stringify(options)});`;
}
