import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: 'android',
  isNative: true,
  getInsets: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
  },
  registerPlugin: () => ({
    getInsets: (...args: unknown[]) => native.getInsets(...args),
  }),
}));

import { GO_WINDOW_METRICS_EVENT } from '../layout/goLayout';
import {
  __resetMobileSafeAreaForTests,
  initMobileSafeAreaInsets,
  windowMetricsFromInsets,
} from './mobileSafeArea';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mobileSafeArea', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    native.platform = 'android';
    native.isNative = true;
    native.getInsets.mockReset();
    __resetMobileSafeAreaForTests();
    delete window.__goWindowMetrics;
    addSpy = vi.spyOn(window, 'addEventListener');
  });

  afterEach(() => {
    addSpy.mockRestore();
    delete window.__goWindowMetrics;
    const style = document.documentElement.style;
    for (const side of ['top', 'bottom', 'left', 'right']) {
      style.removeProperty(`--safe-area-inset-${side}`);
    }
  });

  it('re-queries on resize but never on orientationchange', () => {
    native.getInsets.mockResolvedValue({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
    initMobileSafeAreaInsets();
    const events = addSpy.mock.calls.map((call) => call[0]);
    expect(events).toContain('resize');
    expect(events).not.toContain('orientationchange');
  });

  it('writes the CSS vars and publishes the window metrics', async () => {
    native.getInsets.mockResolvedValue({
      top: 24,
      bottom: 0,
      left: 0,
      right: 0,
      windowWidth: 825,
      windowHeight: 393,
      ime: 0,
      insetLeft: 0,
      insetRight: 48,
      smallestWidthDp: 392,
    });
    const seen: unknown[] = [];
    const onMetrics = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
    try {
      initMobileSafeAreaInsets();
      await flush();
    } finally {
      window.removeEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
    }
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--safe-area-inset-top')).toBe('24px');
    expect(style.getPropertyValue('--safe-area-inset-right')).toBe('0px');
    const expected = {
      width: 825,
      height: 393,
      ime: 0,
      insetLeft: 0,
      insetRight: 48,
      smallestWidthDp: 392,
    };
    expect(window.__goWindowMetrics).toEqual(expected);
    expect(seen).toEqual([expected]);
  });

  it('publishes nothing when an older shell returns only the insets', async () => {
    native.getInsets.mockResolvedValue({
      top: 24,
      bottom: 16,
      left: 0,
      right: 0,
    });
    const onMetrics = vi.fn();
    window.addEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
    try {
      initMobileSafeAreaInsets();
      await flush();
    } finally {
      window.removeEventListener(GO_WINDOW_METRICS_EVENT, onMetrics);
    }
    expect(onMetrics).not.toHaveBeenCalled();
    expect(window.__goWindowMetrics).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue(
        '--safe-area-inset-bottom'
      )
    ).toBe('16px');
  });

  it('does nothing off Android', () => {
    native.platform = 'electron';
    initMobileSafeAreaInsets();
    expect(native.getInsets).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.map((call) => call[0])).not.toContain('resize');
  });

  it('survives a shell without the plugin', async () => {
    native.getInsets.mockRejectedValue(new Error('not implemented'));
    initMobileSafeAreaInsets();
    await flush();
    expect(window.__goWindowMetrics).toBeUndefined();
  });

  describe('windowMetricsFromInsets', () => {
    it('needs a positive window size', () => {
      expect(windowMetricsFromInsets(null)).toBeNull();
      expect(
        windowMetricsFromInsets({ top: 0, bottom: 0, left: 0, right: 0 })
      ).toBeNull();
      expect(
        windowMetricsFromInsets({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          windowWidth: 0,
          windowHeight: 873,
        })
      ).toBeNull();
    });

    it('defaults missing fields to 0', () => {
      expect(
        windowMetricsFromInsets({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          windowWidth: 393,
          windowHeight: 873,
        })
      ).toEqual({
        width: 393,
        height: 873,
        ime: 0,
        insetLeft: 0,
        insetRight: 0,
        smallestWidthDp: 0,
      });
    });
  });
});
