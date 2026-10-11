import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The keyboard store is a module singleton, so every test loads fresh copies
// of it and of the layout store it reads.
type InsetModule = typeof import('./useSoftKeyboardInset');
type LayoutModule = typeof import('../layout/goLayout');

let kb: InsetModule;
let layout: LayoutModule;

const KEY = 'qortal.softKeyboardHeight';
const PORTRAIT_KEY = `${KEY}.portrait`;
const LANDSCAPE_KEY = `${KEY}.landscape`;

class FakeViewport extends EventTarget {
  width = 393;
  height = 873;
}
let vv: FakeViewport;

// jsdom's own window size, put back after tests that move it.
const JSDOM_INNER_WIDTH = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const JSDOM_INNER_HEIGHT = Object.getOwnPropertyDescriptor(
  window,
  'innerHeight'
);

function setInnerSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: h,
  });
}

function setViewport(height: number, width = vv.width): void {
  vv.width = width;
  vv.height = height;
  vv.dispatchEvent(new Event('resize'));
}

// Puts the layout store and the (keyboard-free) viewport at one size.
function goAt(width: number, stableHeight: number): void {
  vv.width = width;
  vv.height = stableHeight;
  layout.__setGoLayoutForTests({ go: true, width, stableHeight });
}

function setMetrics(m: {
  width: number;
  height: number;
  ime: number;
  smallestWidthDp?: number;
}): void {
  const metrics = {
    insetLeft: 0,
    insetRight: 0,
    smallestWidthDp: 393,
    ...m,
  };
  window.__goWindowMetrics = metrics;
  window.dispatchEvent(
    new CustomEvent(layout.GO_WINDOW_METRICS_EVENT, { detail: metrics })
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  window.localStorage.clear();
  delete window.__goWindowMetrics;
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: vv,
  });
  vi.resetModules();
  layout = await import('../layout/goLayout');
  kb = await import('./useSoftKeyboardInset');
});

afterEach(() => {
  // Unmount first: resetting the layout store notifies mounted hooks.
  cleanup();
  layout.__setGoLayoutForTests(null);
  delete window.__goWindowMetrics;
  window.localStorage.clear();
  if (JSDOM_INNER_WIDTH) {
    Object.defineProperty(window, 'innerWidth', JSDOM_INNER_WIDTH);
  }
  if (JSDOM_INNER_HEIGHT) {
    Object.defineProperty(window, 'innerHeight', JSDOM_INNER_HEIGHT);
  }
  vi.useRealTimers();
});

describe('Hub path (not GO)', () => {
  beforeEach(() => {
    layout.__setGoLayoutForTests({ go: false });
  });

  it('keeps the grow-only baseline and the single storage key', () => {
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(kb.getLastSoftKeyboardHeight()).toBe(300);

    setViewport(543);
    expect(kb.getSoftKeyboardInset()).toBe(330);
    expect(window.localStorage.getItem(KEY)).toBe('330');

    setViewport(873);
    expect(kb.getSoftKeyboardInset()).toBe(0);

    // Today's behaviour, deliberately unchanged on the Hub: a height drop
    // with a width change still reads as a keyboard.
    setViewport(393, 873);
    expect(kb.getSoftKeyboardInset()).toBe(480);
    expect(kb.getLastSoftKeyboardHeight()).toBe(480);
    expect(window.localStorage.getItem(KEY)).toBe('480');
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();
    expect(kb.getSoftKeyboardGatedInset()).toBe(0);
  });

  it('reads the legacy stored height', () => {
    window.localStorage.setItem(KEY, '480');
    expect(kb.getLastSoftKeyboardHeight()).toBe(480);
  });
});

describe('GO without native metrics', () => {
  beforeEach(() => {
    goAt(393, 873);
  });

  it('opens against stableHeight and remembers the portrait height', () => {
    expect(kb.getSoftKeyboardInset()).toBe(0);
    setViewport(573);
    expect(kb.getSoftKeyboardInset()).toBe(300);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    setViewport(873);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(kb.getLastSoftKeyboardHeight()).toBe(300);
  });

  it('ignores shrinks of 160 px or less', () => {
    kb.getSoftKeyboardInset();
    setViewport(713);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(kb.getSoftKeyboardGatedInset()).toBe(160);
  });

  it('rotating 873 -> 393 gives inset 0 at once and stores nothing', () => {
    window.localStorage.setItem(PORTRAIT_KEY, '300');
    kb.getSoftKeyboardInset();
    // The viewport reports the landscape height before the layout store has
    // caught up: for that moment the old baseline would read 480.
    layout.__setGoLayoutForTests({
      go: true,
      width: 873,
      stableHeight: 393,
      epoch: 1,
    });
    setViewport(393, 873);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');
  });

  it('stays quiet for 700 ms after an epoch change, then re-evaluates', () => {
    kb.getSoftKeyboardInset();
    layout.__setGoLayoutForTests({
      go: true,
      width: 873,
      stableHeight: 393,
      epoch: 1,
    });
    // A keyboard (or a lagging viewport) inside the quiet window.
    setViewport(183, 873);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();

    vi.advanceTimersByTime(720);
    expect(kb.getSoftKeyboardInset()).toBe(210);
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBe('210');
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
  });

  it('every epoch change restarts the quiet window', () => {
    kb.getSoftKeyboardInset();
    layout.__setGoLayoutForTests({
      go: true,
      width: 873,
      stableHeight: 393,
      epoch: 1,
    });
    vi.advanceTimersByTime(500);
    layout.__setGoLayoutForTests({
      go: true,
      width: 873,
      stableHeight: 393,
      epoch: 2,
    });
    vi.advanceTimersByTime(500);
    setViewport(183, 873);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    vi.advanceTimersByTime(250);
    expect(kb.getSoftKeyboardInset()).toBe(210);
  });

  it('does not store heights above 520', () => {
    goAt(800, 1280);
    kb.getSoftKeyboardInset();
    setViewport(700, 800);
    expect(kb.getSoftKeyboardInset()).toBe(580);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
  });
});

describe('GO with native metrics', () => {
  beforeEach(() => {
    // The WebView at the store's width; a mismatch reads as mid-rotation.
    setInnerSize(393, 873);
    window.__goWindowMetrics = {
      width: 393,
      height: 873,
      ime: 0,
      insetLeft: 0,
      insetRight: 0,
      smallestWidthDp: 393,
    };
    layout.__setGoLayoutForTests({
      go: true,
      width: 393,
      stableHeight: 873,
      nativeMetrics: true,
    });
  });

  it('a viewport shrink without an IME is not a keyboard', () => {
    kb.getSoftKeyboardInset();
    setViewport(436);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(kb.getSoftKeyboardGatedInset()).toBe(0);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
  });

  it('opens with the IME, stores it, and follows the viewport while closing', () => {
    kb.getSoftKeyboardInset();
    setMetrics({ width: 393, height: 873, ime: 300 });
    // Native reports the IME before the viewport has moved.
    expect(kb.getSoftKeyboardInset()).toBe(0);

    // Mid-animation: open, but not remembered (too far from the IME).
    setViewport(623);
    expect(kb.getSoftKeyboardInset()).toBe(250);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();

    setViewport(573);
    expect(kb.getSoftKeyboardInset()).toBe(300);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');

    // Closing: native says 0 at once, the viewport animates down.
    setMetrics({ width: 393, height: 873, ime: 0 });
    expect(kb.getSoftKeyboardInset()).toBe(300);
    setViewport(673);
    expect(kb.getSoftKeyboardInset()).toBe(200);
    setViewport(773);
    expect(kb.getSoftKeyboardInset()).toBe(0);

    // Closed now, so a shrink without an IME cannot reopen it.
    setViewport(573);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(kb.getLastSoftKeyboardHeight()).toBe(300);
  });

  it('a split-screen height change is no phantom keyboard', () => {
    kb.getSoftKeyboardInset();
    setMetrics({ width: 393, height: 436, ime: 0 });
    layout.__setGoLayoutForTests({
      go: true,
      width: 393,
      stableHeight: 436,
      nativeMetrics: true,
    });
    setViewport(436);
    expect(kb.getSoftKeyboardInset()).toBe(0);
  });
});

describe('GO with the real layout store', () => {
  let orientation: EventTarget & { type: string };

  function setWindow(w: number, h: number, type: string): void {
    setInnerSize(w, h);
    orientation.type = type;
  }

  beforeEach(() => {
    orientation = Object.assign(new EventTarget(), {
      type: 'portrait-primary',
    });
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: orientation,
    });
    setWindow(393, 873, 'portrait-primary');
    // Detection is GO; the store then runs on real events.
    layout.__setGoLayoutForTests({ go: true });
    layout.installGoLayout();
  });

  afterEach(() => {
    delete (window.screen as { orientation?: unknown }).orientation;
  });

  it('a portrait -> landscape rotation is not a keyboard', () => {
    window.localStorage.setItem(PORTRAIT_KEY, '300');
    expect(kb.getSoftKeyboardInset()).toBe(0);

    setWindow(873, 393, 'landscape-primary');
    setViewport(393, 873);
    expect(layout.getGoLayout().epoch).toBe(1);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    vi.advanceTimersByTime(720);
    expect(kb.getSoftKeyboardInset()).toBe(0);
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');

    // A landscape keyboard after the quiet window is measured and kept apart.
    setWindow(873, 193, 'landscape-primary');
    setViewport(193, 873);
    expect(kb.getSoftKeyboardInset()).toBe(200);
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBe('200');
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');
  });

  describe('with native metrics, rotating with the keyboard up', () => {
    // Every inset the store hands out from the rotation on.
    let seen: number[];

    // Restarts the store at one size with native metrics, keyboard closed.
    function installAt(w: number, h: number, type: string): void {
      setWindow(w, h, type);
      window.__goWindowMetrics = {
        width: w,
        height: h,
        ime: 0,
        insetLeft: 0,
        insetRight: 0,
        smallestWidthDp: Math.min(w, h),
      };
      layout.__setGoLayoutForTests({ go: true });
      layout.installGoLayout();
      vv.width = w;
      vv.height = h;
      expect(layout.getGoLayout().nativeMetrics).toBe(true);
      kb.subscribeSoftKeyboard(() => {
        seen.push(kb.getSoftKeyboardInset(), kb.getSoftKeyboardGatedInset());
      });
    }

    function openKeyboard(w: number, h: number, ime: number, type: string) {
      setMetrics({ width: w, height: h, ime, smallestWidthDp: Math.min(w, h) });
      setWindow(w, h - ime, type);
      setViewport(h - ime, w);
    }

    beforeEach(() => {
      seen = [];
    });

    it('tablet landscape -> portrait keeps it open while the store holds', () => {
      installAt(1280, 800, 'landscape-primary');
      openKeyboard(1280, 800, 330, 'landscape-primary');
      expect(kb.getSoftKeyboardInset()).toBe(330);
      expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBe('330');
      seen = [];

      // The WebView's resize lands before native's new metrics, so the store
      // still holds the landscape snapshot (800 tall) against a 900 viewport.
      setWindow(800, 900, 'portrait-primary');
      setViewport(900, 800);
      expect(layout.getGoLayout().width).toBe(1280);
      expect(kb.getSoftKeyboardInset()).toBe(330);
      expect(kb.getSoftKeyboardGatedInset()).toBe(330);

      setMetrics({ width: 800, height: 1280, ime: 380, smallestWidthDp: 800 });
      expect(layout.getGoLayout().epoch).toBe(1);
      expect(kb.getSoftKeyboardInset()).toBe(380);
      expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
      vi.advanceTimersByTime(720);
      expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('380');
      expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBe('330');

      expect(seen.length).toBeGreaterThan(0);
      expect(Math.min(...seen)).toBeGreaterThan(160);
      expect(Math.max(...seen)).toBeLessThanOrEqual(380);
    });

    it('phone portrait -> landscape never hands out a window-sized inset', () => {
      installAt(393, 873, 'portrait-primary');
      openKeyboard(393, 873, 300, 'portrait-primary');
      expect(kb.getSoftKeyboardInset()).toBe(300);
      seen = [];

      // Held portrait snapshot (873 tall) against a 193 px landscape viewport
      // would read 680.
      setWindow(873, 193, 'landscape-primary');
      setViewport(193, 873);
      expect(kb.getSoftKeyboardInset()).toBe(300);

      setMetrics({ width: 873, height: 393, ime: 200, smallestWidthDp: 393 });
      expect(kb.getSoftKeyboardInset()).toBe(200);
      vi.advanceTimersByTime(720);
      expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBe('200');
      expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('300');

      expect(seen.length).toBeGreaterThan(0);
      expect(Math.min(...seen)).toBeGreaterThan(160);
      expect(Math.max(...seen)).toBeLessThanOrEqual(300);
    });

    it('follows the fallback once the store gives up holding', () => {
      installAt(393, 873, 'portrait-primary');
      openKeyboard(393, 873, 300, 'portrait-primary');

      // Native never sends the landscape size: after 300 ms the store
      // publishes its own height, and the keyboard re-baselines on that.
      setWindow(873, 393, 'landscape-primary');
      setViewport(393, 873);
      expect(kb.getSoftKeyboardInset()).toBe(300);
      vi.advanceTimersByTime(300);
      expect(layout.getGoLayout().width).toBe(873);
      expect(layout.getGoLayout().nativeMetrics).toBe(false);
      expect(kb.getSoftKeyboardInset()).toBe(0);
      vi.advanceTimersByTime(720);
      expect(kb.getSoftKeyboardInset()).toBe(0);
      expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();
    });
  });
});

describe('getLastSoftKeyboardHeight on GO', () => {
  it('falls back to 300 in portrait and 200 in landscape', () => {
    goAt(800, 1280);
    expect(kb.getLastSoftKeyboardHeight()).toBe(300);
    goAt(1280, 800);
    expect(kb.getLastSoftKeyboardHeight()).toBe(200);
  });

  it('uses the height stored for the current orientation', () => {
    window.localStorage.setItem(PORTRAIT_KEY, '330');
    window.localStorage.setItem(LANDSCAPE_KEY, '230');
    goAt(800, 1280);
    expect(kb.getLastSoftKeyboardHeight()).toBe(330);
    goAt(1280, 800);
    expect(kb.getLastSoftKeyboardHeight()).toBe(230);
  });

  it('clamps to half the stable height on short windows', () => {
    window.localStorage.setItem(LANDSCAPE_KEY, '230');
    goAt(873, 393);
    expect(layout.getGoLayout().short).toBe(true);
    expect(kb.getLastSoftKeyboardHeight()).toBe(197);
  });

  it('migrates a plausible legacy height into portrait only', () => {
    window.localStorage.setItem(KEY, '330');
    goAt(393, 873);
    expect(kb.getLastSoftKeyboardHeight()).toBe(330);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBe('330');
    expect(window.localStorage.getItem(LANDSCAPE_KEY)).toBeNull();
  });

  it('drops a legacy height that a rotation probably wrote', () => {
    window.localStorage.setItem(KEY, '480');
    goAt(393, 873);
    expect(kb.getLastSoftKeyboardHeight()).toBe(300);
    expect(window.localStorage.getItem(PORTRAIT_KEY)).toBeNull();
  });

  it('keeps an existing portrait height over the legacy one', () => {
    window.localStorage.setItem(KEY, '330');
    window.localStorage.setItem(PORTRAIT_KEY, '280');
    goAt(393, 873);
    expect(kb.getLastSoftKeyboardHeight()).toBe(280);
  });

  it('useLastSoftKeyboardHeight follows the layout store', () => {
    goAt(393, 873);
    const { result } = renderHook(() => kb.useLastSoftKeyboardHeight());
    expect(result.current).toBe(300);
    act(() => {
      layout.__setGoLayoutForTests({
        go: true,
        width: 873,
        stableHeight: 393,
        epoch: 1,
      });
    });
    expect(result.current).toBe(197);
  });
});

describe('waitForSoftKeyboardClose', () => {
  beforeEach(() => {
    goAt(393, 873);
  });

  it('resolves at once when the keyboard is closed', async () => {
    const done = vi.fn();
    await kb.waitForSoftKeyboardClose().then(done);
    expect(done).toHaveBeenCalled();
  });

  it('resolves when the keyboard closes', async () => {
    kb.getSoftKeyboardInset();
    setViewport(573);
    const done = vi.fn();
    const p = kb.waitForSoftKeyboardClose(5000).then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    setViewport(873);
    await p;
    expect(done).toHaveBeenCalled();
  });

  it('falls back to the timeout', async () => {
    kb.getSoftKeyboardInset();
    setViewport(573);
    const done = vi.fn();
    const p = kb.waitForSoftKeyboardClose(400).then(done);
    vi.advanceTimersByTime(400);
    await p;
    expect(done).toHaveBeenCalled();
    expect(kb.getSoftKeyboardInset()).toBe(300);
  });
});
