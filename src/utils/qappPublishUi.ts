/**
 * Takes a Q-App's own publish window off the screen while GO's publish window
 * (components/Transfers/QdnPublishWindow.tsx) shows the publish instead, and
 * hands it back when the publish ends.
 *
 * Q-Apps cover themselves with their own progress window while GO uploads
 * their files (qapp-core's "Publishing Status", Q-Share's list), and nobody can
 * use the app until the last part is up. The script below runs at document
 * start in Q-App frames (installed natively with the download reporter, see
 * qappFrameScripts.ts) and waits for GO's word:
 *
 * - "hide": when the top modal layer (an MUI Modal or an ARIA modal dialog)
 *   shows a progress bar, that is the app's publish window. It and the layers
 *   under it fade out and go inert, the page under them gets its scrolling
 *   and screen reader back, and GO hears "hidden". Otherwise GO hears "none"
 *   and the app stays as it is. A window that opens a moment after the
 *   publish started is still found.
 * - "release": the publish is over. A layer the app has not closed by itself
 *   a little later (to show a failure and Retry, say) is shown again.
 *
 * Only GO's own window can give the word: messages must come from the frame's
 * parent or top window, from GO's origin, with the marker key. The script
 * changes nothing else in the app.
 */

/** Marks GO ⇄ frame publish-window messages; nothing else uses this key. */
export const QAPP_PUBLISH_UI_MESSAGE_KEY = '__goQdnPublishUi';
/** After "release", the app gets this long to close its window by itself. */
export const QAPP_PUBLISH_UI_RELEASE_DELAY_MS = 1_500;
/** A publish window that opens this soon after "hide" is still hidden. */
export const QAPP_PUBLISH_UI_WATCH_MS = 1_500;

type QappPublishUiCommand = 'hide' | 'release';
type QappPublishUiEvent = 'hidden' | 'none' | 'revealed' | 'gone';

type QappPublishUiReport = {
  event: QappPublishUiEvent;
  jobId: string;
  layers: number;
};

/**
 * The helper itself. It is serialised into the frame, so it must stay
 * self-contained: no imports, no closures over module scope, plain ES2017
 * (bundler helpers do not survive toString()). `allowSameOrigin` is for the
 * dev preview, whose pretend Q-App frame shares the page's origin.
 */
function qappPublishUi(
  topOrigin: string,
  mark: string,
  releaseDelayMs: number,
  watchMs: number,
  allowSameOrigin: boolean
): void {
  const w = window as any;
  const d = document;
  try {
    if (w.top === w) return;
    if (!allowSameOrigin && location.origin === topOrigin) return;
    if (w.__goQdnPublishUi) return;
    w.__goQdnPublishUi = true;
  } catch {
    return;
  }

  const HIDDEN = 'data-go-publish-hidden';
  const REVEAL = 'data-go-publish-reveal';
  const PROGRESS = '[role="progressbar"],progress';
  type Held = {
    layers: Element[];
    inert: boolean[];
    siblings: { el: Element; value: string }[];
    styles: { el: HTMLElement; prop: string; value: string }[];
    observer: MutationObserver | null;
    watchTimer: any;
  };
  const held: Record<string, Held> = {};

  const post = (event: string, jobId: string, layers: number) => {
    try {
      const msg: any = { event: event, jobId: jobId, layers: layers };
      msg[mark] = 1;
      w.top.postMessage(msg, topOrigin);
    } catch {
      /* reporting must never break the app */
    }
  };

  let styled = false;
  const addStyle = () => {
    if (styled) return;
    const host = d.head || d.documentElement;
    if (!host) return;
    styled = true;
    const style = d.createElement('style');
    style.setAttribute('data-go-publish-ui', '');
    style.textContent =
      '[' +
      HIDDEN +
      ']{opacity:0!important;pointer-events:none!important;' +
      'visibility:hidden!important;transition:opacity .18s ease,' +
      'visibility 0s linear .18s!important}' +
      '[' +
      REVEAL +
      ']{animation:go-publish-reveal .26s cubic-bezier(.2,.8,.2,1)}' +
      '@keyframes go-publish-reveal{from{opacity:0}to{opacity:1}}';
    host.appendChild(style);
  };

  const shown = (el: Element) => {
    try {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  };

  // The portal right under <body> that holds `el`, or null. The app's own
  // root (the first element in <body>) never counts: a dialog drawn inside
  // it is not a layer GO could hide without hiding the app.
  const bodyLayer = (el: Element) => {
    let node: Element | null = el;
    while (node && node.parentElement && node.parentElement !== d.body) {
      node = node.parentElement;
    }
    if (!node || node.parentElement !== d.body) return null;
    let first: Element | null = d.body.firstElementChild;
    while (
      first &&
      /^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(first.tagName)
    ) {
      first = first.nextElementSibling;
    }
    return node === first ? null : node;
  };

  // Open modal layers, bottom to top: MUI's (dialogs, modals, temporary
  // drawers; not menus or popovers) and ARIA modal dialogs.
  const layers = () => {
    const out: Element[] = [];
    const add = (el: Element | null) => {
      if (!el || el === d.body || el === d.documentElement) return;
      if (out.indexOf(el) >= 0 || el.hasAttribute(HIDDEN)) return;
      if (!shown(el)) return;
      out.push(el);
    };
    const mui = d.querySelectorAll('.MuiModal-root');
    for (let i = 0; i < mui.length; i++) {
      if (!mui[i].classList.contains('MuiPopover-root')) add(mui[i]);
    }
    const aria = d.querySelectorAll('[aria-modal="true"],[role="alertdialog"]');
    for (let i = 0; i < aria.length; i++) {
      const el = aria[i];
      if (el.closest('.MuiPopover-root')) continue;
      add(el.closest('.MuiModal-root') || bodyLayer(el));
    }
    const z = (el: Element) => {
      const value = parseInt(getComputedStyle(el).zIndex, 10);
      return isNaN(value) ? 0 : value;
    };
    out.sort((a, b) => {
      const dz = z(a) - z(b);
      if (dz) return dz;
      // eslint-disable-next-line no-bitwise
      return a.compareDocumentPosition(b) & 4 ? -1 : 1;
    });
    return out;
  };

  const hideAll = (jobId: string) => {
    const found = layers();
    const top = found[found.length - 1];
    if (!top || !top.querySelector(PROGRESS)) return false;
    addStyle();
    const record: Held = held[jobId] || {
      layers: [],
      inert: [],
      siblings: [],
      styles: [],
      observer: null,
      watchTimer: null,
    };
    held[jobId] = record;
    for (let i = 0; i < found.length; i++) {
      const el = found[i] as any;
      record.layers.push(el);
      record.inert.push(!!el.inert);
      el.setAttribute(HIDDEN, '');
      el.removeAttribute(REVEAL);
      try {
        el.inert = true;
      } catch {
        /* older engines: pointer-events still keep taps off it */
      }
      const active = d.activeElement as any;
      if (active && el.contains(active) && active.blur) active.blur();
    }
    // What a modal does to the page under it: the page cannot scroll or be
    // tapped, and screen readers skip it. Undone while the window is hidden.
    const children = d.body ? d.body.children : ([] as any);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (record.layers.indexOf(child) >= 0 || child.hasAttribute(HIDDEN)) {
        continue;
      }
      if (child.getAttribute('aria-hidden') === 'true') {
        record.siblings.push({ el: child, value: 'true' });
        child.removeAttribute('aria-hidden');
      }
    }
    const roots = [d.documentElement, d.body];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i] as HTMLElement;
      if (!root) continue;
      if (root.style.overflow === 'hidden') {
        record.styles.push({ el: root, prop: 'overflow', value: 'hidden' });
        root.style.overflow = '';
      }
      if (root.style.pointerEvents === 'none') {
        record.styles.push({ el: root, prop: 'pointerEvents', value: 'none' });
        root.style.pointerEvents = '';
      }
    }
    return true;
  };

  const stopWatching = (record: Held | undefined) => {
    if (!record) return;
    if (record.observer) record.observer.disconnect();
    if (record.watchTimer) clearTimeout(record.watchTimer);
    record.observer = null;
    record.watchTimer = null;
  };

  const hide = (jobId: string) => {
    if (hideAll(jobId)) {
      post('hidden', jobId, held[jobId].layers.length);
      return;
    }
    // The app may draw its window a moment after it asked to publish.
    if (typeof MutationObserver !== 'function' || !d.body) {
      post('none', jobId, 0);
      return;
    }
    const record: Held = {
      layers: [],
      inert: [],
      siblings: [],
      styles: [],
      observer: null,
      watchTimer: null,
    };
    held[jobId] = record;
    let queued = false;
    record.observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (held[jobId] !== record || record.layers.length) return;
        if (hideAll(jobId)) {
          stopWatching(record);
          post('hidden', jobId, record.layers.length);
        }
      }, 50);
    });
    record.observer.observe(d.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    record.watchTimer = setTimeout(() => {
      stopWatching(record);
      if (!record.layers.length) {
        delete held[jobId];
        post('none', jobId, 0);
      }
    }, watchMs);
  };

  const release = (jobId: string) => {
    const record = held[jobId];
    if (!record) return;
    stopWatching(record);
    setTimeout(() => {
      if (held[jobId] !== record) return;
      delete held[jobId];
      let revealed = 0;
      for (let i = 0; i < record.layers.length; i++) {
        const el = record.layers[i] as any;
        if (!el.isConnected || !el.hasAttribute(HIDDEN)) continue;
        revealed += 1;
        el.removeAttribute(HIDDEN);
        el.setAttribute(REVEAL, '');
        try {
          el.inert = record.inert[i];
        } catch {
          /* see above */
        }
      }
      if (revealed) {
        // The app's window is back, and with it what it does to the page.
        for (let i = 0; i < record.siblings.length; i++) {
          const item = record.siblings[i];
          if (item.el.isConnected)
            item.el.setAttribute('aria-hidden', item.value);
        }
        for (let i = 0; i < record.styles.length; i++) {
          const item = record.styles[i];
          (item.el.style as any)[item.prop] = item.value;
        }
      }
      // Otherwise the app closed its window by itself and put the page back.
      post(revealed ? 'revealed' : 'gone', jobId, revealed);
    }, releaseDelayMs);
  };

  w.addEventListener('message', (event: MessageEvent) => {
    const data: any = event.data;
    if (!data || typeof data !== 'object' || data[mark] !== 1) return;
    if (typeof data.cmd !== 'string' || typeof data.jobId !== 'string') return;
    if (event.origin !== topOrigin) return;
    if (event.source !== w.parent && event.source !== w.top) return;
    const jobId = data.jobId.slice(0, 80);
    if (data.cmd === 'hide') hide(jobId);
    else if (data.cmd === 'release') release(jobId);
  });
}

export function buildQappPublishUiScript(
  topOrigin: string,
  options: { allowSameOrigin?: boolean } = {}
): string {
  return `(${qappPublishUi.toString()})(${JSON.stringify(topOrigin)}, ${JSON.stringify(
    QAPP_PUBLISH_UI_MESSAGE_KEY
  )}, ${QAPP_PUBLISH_UI_RELEASE_DELAY_MS}, ${QAPP_PUBLISH_UI_WATCH_MS}, ${
    options.allowSameOrigin === true
  });`;
}

/** GO → frame: the message for a command. */
export function qappPublishUiCommand(
  command: QappPublishUiCommand,
  jobId: string
): Record<string, unknown> {
  return { [QAPP_PUBLISH_UI_MESSAGE_KEY]: 1, cmd: command, jobId };
}

/** Validates a report from a frame; null when it is not one. */
export function parseQappPublishUiReport(
  data: unknown
): QappPublishUiReport | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw[QAPP_PUBLISH_UI_MESSAGE_KEY] !== 1) return null;
  const events: QappPublishUiEvent[] = ['hidden', 'none', 'revealed', 'gone'];
  const event = raw.event as QappPublishUiEvent;
  if (!events.includes(event)) return null;
  if (typeof raw.jobId !== 'string' || !raw.jobId) return null;
  const layers =
    typeof raw.layers === 'number' && Number.isFinite(raw.layers)
      ? Math.max(0, Math.floor(raw.layers))
      : 0;
  return { event, jobId: raw.jobId.slice(0, 80), layers };
}
