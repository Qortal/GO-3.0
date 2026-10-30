/**
 * Makes a Q-App's own big QDN downloads visible in GO.
 *
 * Q-Share fetches the whole file (`/arbitrary/FILE/...`) inside its frame and
 * only then asks GO to save it. On mobile data that is minutes with nothing on
 * screen. The script below runs at document start in Q-App frames (installed
 * natively, since those frames are cross-origin; see qappFrameScripts.ts) and
 * reports the progress of large QDN GETs to GO's window. GO turns the reports
 * into the same progress card and tray notification its own saves use.
 *
 * Only responses of at least {@link QAPP_FETCH_MIN_BYTES} are touched. Their
 * body is passed through a pull-based counter: nothing is read ahead of the
 * app, so an app that never reads the body downloads nothing extra.
 */

export const QAPP_FETCH_MIN_BYTES = 4 * 1024 * 1024;
/** Marks the reporter's postMessages; nothing else in GO uses this key. */
const QAPP_FETCH_MESSAGE_KEY = '__goQdnFetch';

type QappFetchPhase =
  | 'start'
  | 'progress'
  | 'done'
  | 'error'
  | 'cancel'
  /** A QDN load got no answer from the node (nginx 502-504 or no reply). */
  | 'node-trouble';

export type QappFetchMessage = {
  phase: QappFetchPhase;
  id: string;
  service: string;
  name: string;
  identifier: string;
  loaded: number;
  total: number;
  message?: string;
};

/**
 * The reporter itself. It is serialised into the frame, so it must stay
 * self-contained: no imports, no closures over module scope.
 */
function qappFetchReporter(
  topOrigin: string,
  minBytes: number,
  mark: string
): void {
  const w = window as any;
  try {
    if (w.top === w || location.origin === topOrigin) return;
    if (w.__goQdnFetchReporter) return;
    w.__goQdnFetchReporter = true;
  } catch {
    return;
  }

  let seq = 0;
  const newId = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${++seq}`;
  const post = (msg: any) => {
    try {
      msg[mark] = 1;
      w.top.postMessage(msg, topOrigin);
    } catch {
      /* reporting must never break the app */
    }
  };
  // The node gave no answer to a QDN load: GO checks the node and may say
  // it is down. Once in 20 s is plenty; GO checks at most every 15 s.
  let troubleAt = 0;
  const gatewayError = (status: number) =>
    status === 502 || status === 503 || status === 504;
  const nodeTrouble = (where: any) => {
    const now = Date.now();
    if (now - troubleAt < 20000) return;
    troubleAt = now;
    post({
      phase: 'node-trouble',
      id: newId(),
      service: where.service,
      name: where.name,
      identifier: where.identifier,
      loaded: 0,
      total: 0,
    });
  };
  const qdnTarget = (url: string) => {
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      const m = /^\/arbitrary\/([A-Z0-9_]+)\/([^/]+)(?:\/([^/]+))?/.exec(
        u.pathname
      );
      if (!m) return null;
      return {
        service: m[1],
        name: decodeURIComponent(m[2]),
        identifier: m[3] ? decodeURIComponent(m[3]) : '',
      };
    } catch {
      return null;
    }
  };

  const nativeFetch = w.fetch;
  if (
    typeof nativeFetch === 'function' &&
    typeof w.ReadableStream === 'function' &&
    typeof w.Response === 'function'
  ) {
    const track = (res: any, where: any) => {
      if (!res || res.status !== 200 || !res.body) return res;
      const total = Number(res.headers.get('content-length')) || 0;
      if (total < minBytes) return res;
      const id = newId();
      const reader = res.body.getReader();
      let loaded = 0;
      let lastAt = 0;
      let started = false;
      let finished = false;
      // Plain ES2017 on purpose: bundler helpers do not survive toString().
      const report = (phase: string, message?: string) => {
        const msg: any = {
          phase,
          id,
          service: where.service,
          name: where.name,
          identifier: where.identifier,
          loaded,
          total,
        };
        if (message) msg.message = message;
        post(msg);
      };
      const body = new w.ReadableStream(
        {
          pull(controller: any) {
            if (!started) {
              started = true;
              report('start');
            }
            return reader.read().then(
              (r: any) => {
                if (r.done) {
                  if (!finished) {
                    finished = true;
                    report('done');
                  }
                  controller.close();
                  return;
                }
                loaded += r.value.byteLength;
                const now = Date.now();
                if (now - lastAt >= 250) {
                  lastAt = now;
                  report('progress');
                }
                controller.enqueue(r.value);
              },
              (err: any) => {
                if (!finished) {
                  finished = true;
                  report('error', String((err && err.message) || err));
                }
                controller.error(err);
              }
            );
          },
          cancel(reason: any) {
            if (started && !finished) {
              finished = true;
              report('cancel');
            }
            return reader.cancel(reason);
          },
        },
        // Read only when the app reads, never ahead of it.
        { highWaterMark: 0 }
      );
      const out = new w.Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      try {
        Object.defineProperty(out, 'url', { value: res.url });
        Object.defineProperty(out, 'redirected', { value: res.redirected });
        Object.defineProperty(out, 'type', { value: res.type });
      } catch {
        /* cosmetic */
      }
      return out;
    };

    w.fetch = function (input: any, init?: any) {
      // eslint-disable-next-line prefer-rest-params
      const pending = nativeFetch.apply(this, arguments);
      let where: any = null;
      try {
        const url =
          typeof input === 'string'
            ? input
            : input && input.url
              ? input.url
              : String(input);
        const method = String(
          (init && init.method) ||
            (input && typeof input === 'object' && input.method) ||
            'GET'
        ).toUpperCase();
        where = method === 'GET' ? qdnTarget(url) : null;
      } catch {
        where = null;
      }
      if (!where) return pending;
      return pending.then(
        (res: any) => {
          if (res && gatewayError(res.status)) nodeTrouble(where);
          try {
            return track(res, where);
          } catch {
            return res;
          }
        },
        (err: any) => {
          if (!err || err.name !== 'AbortError') nodeTrouble(where);
          throw err;
        }
      );
    };
  }

  // XMLHttpRequest (axios and friends): listening to progress changes nothing.
  const XHR = w.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method: any, url: any) {
      try {
        this.__goQdnTarget =
          String(method).toUpperCase() === 'GET'
            ? qdnTarget(String(url))
            : null;
      } catch {
        this.__goQdnTarget = null;
      }
      // eslint-disable-next-line prefer-rest-params
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      const where = this.__goQdnTarget;
      if (where) {
        this.addEventListener('error', () => nodeTrouble(where));
        this.addEventListener('load', () => {
          if (gatewayError(this.status)) nodeTrouble(where);
        });
        let id: string | null = null;
        let lastAt = 0;
        let loaded = 0;
        let total = 0;
        let finished = false;
        const report = (phase: string) =>
          post({
            phase,
            id,
            service: where.service,
            name: where.name,
            identifier: where.identifier,
            loaded,
            total,
          });
        this.addEventListener('progress', (e: any) => {
          if (!e.lengthComputable || e.total < minBytes) return;
          loaded = e.loaded;
          total = e.total;
          if (!id) {
            id = newId();
            report('start');
          }
          const now = Date.now();
          if (now - lastAt >= 250) {
            lastAt = now;
            report('progress');
          }
        });
        const end = (phase: string) => () => {
          if (!id || finished) return;
          finished = true;
          report(phase === 'done' && this.status !== 200 ? 'error' : phase);
        };
        this.addEventListener('load', end('done'));
        this.addEventListener('error', end('error'));
        this.addEventListener('abort', end('cancel'));
        this.addEventListener('timeout', end('error'));
      }
      // eslint-disable-next-line prefer-rest-params
      return send.apply(this, arguments);
    };
  }
}

export function buildQappFetchReporterScript(topOrigin: string): string {
  return `(${qappFetchReporter.toString()})(${JSON.stringify(topOrigin)}, ${QAPP_FETCH_MIN_BYTES}, ${JSON.stringify(QAPP_FETCH_MESSAGE_KEY)});`;
}

/** Validates a message from a frame; null when it is not a well-formed report. */
export function parseQappFetchMessage(data: unknown): QappFetchMessage | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw[QAPP_FETCH_MESSAGE_KEY] !== 1) return null;
  const phases: QappFetchPhase[] = [
    'start',
    'progress',
    'done',
    'error',
    'cancel',
    'node-trouble',
  ];
  const phase = raw.phase as QappFetchPhase;
  if (!phases.includes(phase)) return null;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  const id = text(raw.id, 64);
  const service = text(raw.service, 64);
  const name = text(raw.name, 128);
  if (!id || !/^[A-Z0-9_]+$/.test(service) || !name) return null;
  return {
    phase,
    id,
    service,
    name,
    identifier: text(raw.identifier, 256),
    loaded: count(raw.loaded),
    total: count(raw.total),
    ...(typeof raw.message === 'string'
      ? { message: text(raw.message, 200) }
      : {}),
  };
}
