import i18n from 'i18next';

/**
 * Refuses Q-App requests while the app lock is up (GO-04).
 *
 * Q-App frames keep running under the lock screen, and some requests need no
 * prompt: saved "always allow" grants, GET_* reads with a grant, auto-granted
 * signing. The approval dialogs are declined while locked (see
 * `hooks/useAppLock.ts`), but these would still run as the user. Every Q-App
 * request reaches GO as a `message` event with `requestedHandler: 'UI'` on
 * the window of the same-origin frame the Q-App sits in (react-frame-component
 * in `AppViewerContainer`), where `useQortalMessageListener` answers it on the
 * MessageChannel port the request carries.
 *
 * While engaged, the gate listens in the capture phase on GO's window and on
 * every same-origin frame window, stops each Q-App request before GO's
 * handler sees it, and answers it on its port with a "GO is locked" error, the
 * same shape GO uses for any failed request. Only the messages that report
 * where the app has navigated pass, so the tab's address and history stay
 * right; they never act as the user.
 */

/** Q-App messages that only report navigation; they never act as the user. */
export const QAPP_MESSAGES_ALLOWED_WHILE_LOCKED: ReadonlySet<string> = new Set([
  'LINK_TO_QDN_RESOURCE',
  'QDN_RESOURCE_DISPLAYED',
  'NAVIGATION_HISTORY',
  'NAVIGATION_SUCCESS',
]);

export type QappRequestLockGateOptions = {
  isLocked: () => boolean;
  doc?: Document;
  /** Error text the Q-App gets back. */
  lockedMessage?: () => string;
};

export type QappRequestLockGate = {
  /** Starts refusing requests (idempotent). */
  engage: () => void;
  /** Stops refusing requests and removes every listener it added. */
  release: () => void;
  isEngaged: () => boolean;
};

const defaultLockedMessage = () =>
  i18n.t('core:app_lock.qapp_request_locked', {
    postProcess: 'capitalizeFirstChar',
  });

const isQappRequest = (data: unknown): data is { action?: unknown } =>
  Boolean(data) &&
  typeof data === 'object' &&
  (data as { requestedHandler?: unknown }).requestedHandler === 'UI';

export function createQappRequestLockGate({
  isLocked,
  doc = typeof document !== 'undefined' ? document : undefined,
  lockedMessage = defaultLockedMessage,
}: QappRequestLockGateOptions): QappRequestLockGate {
  const gated = new Set<Window>();
  let observer: MutationObserver | null = null;
  let engaged = false;

  const onMessage = (event: MessageEvent) => {
    if (!isLocked()) return;
    const data = event.data;
    if (!isQappRequest(data)) return;
    // GO talking to itself is not a Q-App request.
    if (event.source && event.source === event.currentTarget) return;
    if (
      typeof data.action === 'string' &&
      QAPP_MESSAGES_ALLOWED_WHILE_LOCKED.has(data.action)
    ) {
      return;
    }
    event.stopImmediatePropagation();
    const port = event.ports?.[0];
    if (!port) return;
    let message = '';
    try {
      message = lockedMessage();
    } catch {
      /* fall back to the machine-readable code below */
    }
    message = message || 'APP_LOCKED';
    try {
      port.postMessage({ result: null, error: { error: message, message } });
    } catch {
      /* the Q-App went away */
    }
  };

  // Adding the same listener twice is a no-op, so a window already gated is
  // simply gated again (a frame that loaded a new document needs it back).
  const gate = (win: Window | null | undefined) => {
    if (!win) return;
    try {
      win.addEventListener('message', onMessage, true);
      gated.add(win);
    } catch {
      /* a cross-origin frame: not a Q-App host, and out of reach anyway */
    }
  };

  const gateFrames = () => {
    if (!doc) return;
    doc.querySelectorAll('iframe').forEach((frame) => {
      try {
        gate(frame.contentWindow);
      } catch {
        /* ignore */
      }
    });
  };

  const addsFrame = (records: MutationRecord[]) =>
    records.some((record) =>
      Array.from(record.addedNodes).some(
        (node) =>
          node.nodeName === 'IFRAME' ||
          Boolean((node as Element).querySelector?.('iframe'))
      )
    );

  // A frame (re)loading its document loses the listeners of the old one.
  const onFrameLoad = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.nodeName !== 'IFRAME') return;
    gate((target as HTMLIFrameElement).contentWindow);
  };

  return {
    engage: () => {
      if (!doc) return;
      gate(doc.defaultView);
      gateFrames();
      if (engaged) return;
      engaged = true;
      doc.addEventListener('load', onFrameLoad, true);
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver((records) => {
          if (addsFrame(records)) gateFrames();
        });
        observer.observe(doc.documentElement ?? doc, {
          childList: true,
          subtree: true,
        });
      }
    },
    release: () => {
      engaged = false;
      observer?.disconnect();
      observer = null;
      doc?.removeEventListener('load', onFrameLoad, true);
      gated.forEach((win) => {
        try {
          win.removeEventListener('message', onMessage, true);
        } catch {
          /* ignore */
        }
      });
      gated.clear();
    },
    isEngaged: () => engaged,
  };
}
