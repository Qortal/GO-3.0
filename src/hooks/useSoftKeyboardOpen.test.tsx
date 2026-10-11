import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh copies per test: the keyboard store behind the GO path is a module
// singleton, and so is the layout store.
type OpenModule = typeof import('./useSoftKeyboardOpen');
type LayoutModule = typeof import('../layout/goLayout');

let hooks: OpenModule;
let layout: LayoutModule;

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

function setMetrics(w: number, h: number, ime: number): void {
  act(() => {
    const m = {
      width: w,
      height: h,
      ime,
      insetLeft: 0,
      insetRight: 0,
      smallestWidthDp: Math.min(w, h),
    };
    window.__goWindowMetrics = m;
    window.dispatchEvent(
      new CustomEvent(layout.GO_WINDOW_METRICS_EVENT, { detail: m })
    );
  });
}

function setViewport(height: number, width = vv.width): void {
  act(() => {
    vv.width = width;
    vv.height = height;
    vv.dispatchEvent(new Event('resize'));
  });
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
  hooks = await import('./useSoftKeyboardOpen');
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

describe('useSoftKeyboardOpen on the Hub', () => {
  beforeEach(() => {
    layout.__setGoLayoutForTests({ go: false });
  });

  it('keeps the per-mount grow-only baseline', () => {
    const { result } = renderHook(() => hooks.useSoftKeyboardOpen());
    expect(result.current).toBe(false);
    setViewport(573);
    expect(result.current).toBe(true);
    setViewport(873);
    expect(result.current).toBe(false);
    // Unchanged on the Hub: a width change with a height drop still counts.
    setViewport(393, 873);
    expect(result.current).toBe(true);
  });

  it('applies its own threshold', () => {
    const { result } = renderHook(() => hooks.useSoftKeyboardOpen(120));
    setViewport(733);
    expect(result.current).toBe(true);
  });
});

describe('useSoftKeyboardOpen on GO', () => {
  beforeEach(() => {
    layout.__setGoLayoutForTests({ go: true, width: 393, stableHeight: 873 });
  });

  it('useSoftKeyboardOpen(120) uses its own threshold below 160', () => {
    const low = renderHook(() => hooks.useSoftKeyboardOpen(120));
    const normal = renderHook(() => hooks.useSoftKeyboardOpen());
    expect(low.result.current).toBe(false);
    setViewport(733);
    expect(low.result.current).toBe(true);
    expect(normal.result.current).toBe(false);
    setViewport(573);
    expect(normal.result.current).toBe(true);
    setViewport(873);
    expect(low.result.current).toBe(false);
    expect(normal.result.current).toBe(false);
  });

  it('a rotation does not read as an open keyboard', () => {
    const { result } = renderHook(() => hooks.useSoftKeyboardOpen());
    act(() => {
      layout.__setGoLayoutForTests({
        go: true,
        width: 873,
        stableHeight: 393,
        epoch: 1,
      });
    });
    setViewport(393, 873);
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(720);
    });
    expect(result.current).toBe(false);
  });

  it('needs an IME report when native metrics are present', () => {
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
    const { result } = renderHook(() => hooks.useSoftKeyboardOpen(120));
    setViewport(573);
    expect(result.current).toBe(false);

    setMetrics(393, 873, 300);
    expect(result.current).toBe(true);
  });
});

describe('useSoftKeyboardOpen on GO with the real layout store', () => {
  let orientation: EventTarget & { type: string };

  function setWindow(w: number, h: number, type: string): void {
    setInnerSize(w, h);
    orientation.type = type;
  }

  beforeEach(() => {
    orientation = Object.assign(new EventTarget(), {
      type: 'landscape-primary',
    });
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: orientation,
    });
  });

  afterEach(() => {
    delete (window.screen as { orientation?: unknown }).orientation;
  });

  it('stays open through a rotation while the store holds its snapshot', () => {
    setWindow(1280, 800, 'landscape-primary');
    window.__goWindowMetrics = {
      width: 1280,
      height: 800,
      ime: 0,
      insetLeft: 0,
      insetRight: 0,
      smallestWidthDp: 800,
    };
    layout.__setGoLayoutForTests({ go: true });
    layout.installGoLayout();
    vv.width = 1280;
    vv.height = 800;

    const renders: boolean[] = [];
    const { result } = renderHook(() => {
      const open = hooks.useSoftKeyboardOpen(120);
      renders.push(open);
      return open;
    });
    setMetrics(1280, 800, 330);
    setWindow(1280, 470, 'landscape-primary');
    setViewport(470, 1280);
    expect(result.current).toBe(true);
    renders.length = 0;

    // Resize before native's new metrics: the store holds the landscape
    // snapshot, which against the portrait viewport would read closed.
    setWindow(800, 900, 'portrait-primary');
    setViewport(900, 800);
    expect(result.current).toBe(true);
    setMetrics(800, 1280, 380);
    expect(layout.getGoLayout().epoch).toBe(1);
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(720);
    });
    expect(result.current).toBe(true);
    expect(renders).not.toContain(false);
  });
});
