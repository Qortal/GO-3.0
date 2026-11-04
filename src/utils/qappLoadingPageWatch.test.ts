import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildQappLoadingPageWatchScript,
  QAPP_LOADING_BACKGROUND_STILL_MS,
  QAPP_LOADING_CHECK_MS,
  QAPP_LOADING_FIRST_CHECK_MS,
  QAPP_LOADING_GIVE_UP_MS,
  QAPP_LOADING_LEAVING_GRACE_MS,
  QAPP_LOADING_MAX_RELOADS,
  QAPP_LOADING_RELOAD_WINDOW_MS,
  QAPP_LOADING_RELOADS_KEY,
  QAPP_LOADING_SLOW_AFTER_MS,
  QAPP_LOADING_SLOW_CHECK_MS,
  QAPP_LOADING_TIMEOUT_MS,
} from './qappLoadingPageWatch';

const GO_ORIGIN = 'http://localhost';
const NODE = 'https://ext-node.qortal.link';
const PAGE = `${NODE}/render/APP/Q-Assets?theme=dark&lang=en&identifier=`;

type FakeDocument = {
  title: string;
  readyState: string;
  hidden: boolean;
  getElementById: (id: string) => object | null;
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
};

/** Core's loading page, or another page when `title` says so. */
function fakeDocument({
  title = 'Loading - Qortal Network',
  ids = ['panel-outer', 'status', 'progress'],
  readyState = 'interactive',
} = {}): FakeDocument {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    title,
    readyState,
    hidden: false,
    getElementById: (id) => (ids.includes(id) ? {} : null),
    addEventListener: (type, listener) => {
      (listeners[type] = listeners[type] || []).push(listener);
    },
    fire: (type) => (listeners[type] || []).forEach((listener) => listener()),
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

/**
 * Runs the serialised watcher the way it runs in a Q-App frame on the node:
 * `window` is the frame (its top is GO), `fetch` answers like the node.
 */
function runInFrame({
  doc = fakeDocument(),
  href = PAGE,
  isTop = false,
  answer = async (): Promise<Response> => new Response(null, { status: 503 }),
  storage = fakeStorage(),
  raf,
}: {
  doc?: FakeDocument;
  href?: string;
  isTop?: boolean;
  answer?: (input: string, init?: RequestInit) => Promise<Response>;
  storage?: ReturnType<typeof fakeStorage>;
  raf?: (callback: FrameRequestCallback) => number;
} = {}) {
  const url = new URL(href);
  const reload = vi.fn();
  const location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    reload,
  };
  const fetch = vi.fn(answer);
  const windowListeners: Record<string, (() => void)[]> = {};
  const frame: Record<string, unknown> = {
    AbortController,
    addEventListener: (type: string, listener: () => void) => {
      (windowListeners[type] = windowListeners[type] || []).push(listener);
    },
    fetch,
    sessionStorage: storage,
  };
  if (raf) frame.requestAnimationFrame = raf;
  frame.top = isTop ? frame : {};
  new Function(
    'window',
    'location',
    'document',
    buildQappLoadingPageWatchScript(GO_ORIGIN)
  )(frame, location, doc);
  const fireWindow = (type: string) =>
    (windowListeners[type] || []).forEach((listener) => listener());
  return { doc, fetch, fireWindow, frame, reload, storage };
}

const ok = async () => new Response(null, { status: 200 });

describe('Q-App loading page watch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the node for the page itself and reloads once it is served', async () => {
    let served = false;
    const frame = runInFrame({
      answer: async () => new Response(null, { status: served ? 200 : 503 }),
    });

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_FIRST_CHECK_MS - 1);
    expect(frame.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = frame.fetch.mock.calls[0];
    expect(input).toBe(PAGE);
    expect(init).toMatchObject({ method: 'HEAD', cache: 'no-store' });
    expect(frame.reload).not.toHaveBeenCalled();

    served = true;
    await vi.advanceTimersByTimeAsync(QAPP_LOADING_CHECK_MS);
    expect(frame.fetch).toHaveBeenCalledTimes(2);
    expect(frame.reload).toHaveBeenCalledTimes(1);

    // Done: nothing more is asked.
    await vi.advanceTimersByTimeAsync(10 * QAPP_LOADING_CHECK_MS);
    expect(frame.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps asking after no answer or a gateway error', async () => {
    const answers = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => new Response('<html>502</html>', { status: 502 }),
      ok,
    ];
    const frame = runInFrame({ answer: () => answers.shift()!() });

    await vi.advanceTimersByTimeAsync(
      QAPP_LOADING_FIRST_CHECK_MS + 2 * QAPP_LOADING_CHECK_MS
    );
    expect(frame.fetch).toHaveBeenCalledTimes(3);
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it('gives up on an ask with no answer and asks again', async () => {
    let calls = 0;
    const frame = runInFrame({
      answer: (_input, init) => {
        calls += 1;
        if (calls > 1) return ok();
        // Hangs until the watcher aborts it.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        });
      },
    });

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_FIRST_CHECK_MS);
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QAPP_LOADING_TIMEOUT_MS - 1);
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + QAPP_LOADING_CHECK_MS);
    expect(frame.fetch).toHaveBeenCalledTimes(2);
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the reload to the loading page when it is already reloading', async () => {
    const frame = runInFrame({ answer: ok });

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_FIRST_CHECK_MS - 500);
    // Core's page saw READY and reloads; the old page is still up meanwhile.
    frame.fireWindow('beforeunload');
    await vi.advanceTimersByTimeAsync(500);
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    expect(frame.reload).not.toHaveBeenCalled();

    // That reload never came through: GO reloads after all.
    await vi.advanceTimersByTimeAsync(
      QAPP_LOADING_LEAVING_GRACE_MS + QAPP_LOADING_CHECK_MS
    );
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it('waits while GO is off screen and asks as soon as it is back', async () => {
    const doc = fakeDocument();
    const frame = runInFrame({ doc, answer: ok });
    doc.hidden = true;

    await vi.advanceTimersByTimeAsync(5 * QAPP_LOADING_CHECK_MS);
    expect(frame.fetch).not.toHaveBeenCalled();

    doc.hidden = false;
    doc.fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it('asks less often after a while and stops in the end', async () => {
    const frame = runInFrame();

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_SLOW_AFTER_MS);
    const early = frame.fetch.mock.calls.length;
    expect(early).toBe(
      1 +
        Math.floor(
          (QAPP_LOADING_SLOW_AFTER_MS - QAPP_LOADING_FIRST_CHECK_MS) /
            QAPP_LOADING_CHECK_MS
        )
    );

    await vi.advanceTimersByTimeAsync(4 * QAPP_LOADING_SLOW_CHECK_MS);
    expect(frame.fetch.mock.calls.length - early).toBeLessThanOrEqual(4);
    expect(frame.fetch.mock.calls.length - early).toBeGreaterThanOrEqual(3);

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_GIVE_UP_MS);
    const atEnd = frame.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * QAPP_LOADING_SLOW_CHECK_MS);
    expect(frame.fetch.mock.calls.length).toBe(atEnd);
    expect(frame.reload).not.toHaveBeenCalled();
  });

  it('holds off reloading an address the node keeps sending back as loading', async () => {
    const now = Date.now();
    const storage = fakeStorage({
      [QAPP_LOADING_RELOADS_KEY]: JSON.stringify({
        '/render/APP/Q-Assets': Array.from(
          { length: QAPP_LOADING_MAX_RELOADS },
          (_, i) => now - 1_000 * (i + 1)
        ),
      }),
    });
    const frame = runInFrame({ answer: ok, storage });

    // All of those reloads are still in the window: no reload yet, but the
    // node is still asked.
    await vi.advanceTimersByTimeAsync(QAPP_LOADING_RELOAD_WINDOW_MS - 10_000);
    expect(frame.fetch.mock.calls.length).toBeGreaterThan(10);
    expect(frame.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000 + QAPP_LOADING_SLOW_CHECK_MS);
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it('counts its reloads per address and drops old ones', async () => {
    const storage = fakeStorage({
      [QAPP_LOADING_RELOADS_KEY]: JSON.stringify({
        '/render/APP/Old': [Date.now() - 24 * 60 * 60_000],
      }),
    });
    const frame = runInFrame({ answer: ok, storage });

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_FIRST_CHECK_MS);
    expect(frame.reload).toHaveBeenCalledTimes(1);
    const kept = JSON.parse(storage.data[QAPP_LOADING_RELOADS_KEY]);
    expect(Object.keys(kept)).toEqual(['/render/APP/Q-Assets']);
    expect(kept['/render/APP/Q-Assets']).toHaveLength(1);
  });

  it('stills the loading page background after a moment', async () => {
    const raf = vi.fn(() => 7);
    const { frame } = runInFrame({ raf });
    const pageRaf = frame.requestAnimationFrame as (
      callback: FrameRequestCallback
    ) => number;
    const draw = () => undefined;

    expect(pageRaf(draw)).toBe(7);
    expect(raf).toHaveBeenCalledWith(draw);

    await vi.advanceTimersByTimeAsync(QAPP_LOADING_BACKGROUND_STILL_MS);
    // The canvas asks for its next frame and gets none: it stays as drawn.
    expect(pageRaf(draw)).toBe(0);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('leaves animation frames alone on other pages', async () => {
    const raf = vi.fn(() => 7);
    const { frame } = runInFrame({
      doc: fakeDocument({ title: 'Q-Assets' }),
      raf,
    });

    await vi.advanceTimersByTimeAsync(2 * QAPP_LOADING_BACKGROUND_STILL_MS);
    expect(frame.requestAnimationFrame).toBe(raf);
  });

  it('starts once the page is parsed', async () => {
    const doc = fakeDocument({ readyState: 'loading' });
    const frame = runInFrame({ doc, answer: ok });

    await vi.advanceTimersByTimeAsync(2 * QAPP_LOADING_FIRST_CHECK_MS);
    expect(frame.fetch).not.toHaveBeenCalled();

    doc.fire('DOMContentLoaded');
    await vi.advanceTimersByTimeAsync(QAPP_LOADING_FIRST_CHECK_MS);
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an app page', { doc: fakeDocument({ title: 'Q-Assets' }) }],
    [
      'a page titled like it without its panel',
      { doc: fakeDocument({ ids: ['status'] }) },
    ],
    ['GO itself', { href: `${GO_ORIGIN}/render/APP/Q-Assets` }],
    ['the top window', { isTop: true }],
    ['a QDN file', { href: `${NODE}/arbitrary/APP/Q-Assets` }],
  ])('does nothing on %s', async (_name, options) => {
    const frame = runInFrame({ answer: ok, ...options });

    await vi.advanceTimersByTimeAsync(
      QAPP_LOADING_FIRST_CHECK_MS + 5 * QAPP_LOADING_CHECK_MS
    );
    expect(frame.fetch).not.toHaveBeenCalled();
    expect(frame.reload).not.toHaveBeenCalled();
  });
});
