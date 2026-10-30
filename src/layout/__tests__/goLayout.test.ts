import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GO_LAYOUT,
  GO_WINDOW_METRICS_EVENT,
  computeGoLayout,
  getGoLayout,
  getGoWindowMetrics,
  installGoLayout,
  isGoLayout,
  subscribeGoLayout,
  __setGoLayoutForTests,
  type GoLayout,
  type GoLayoutInput,
  type GoWindowMetrics,
} from '../goLayout';
import { isGoApp } from '../../utils/platform';

type TestWindow = Window & {
  Capacitor?: unknown;
  coreSetup?: unknown;
};
const tw = window as TestWindow;

function input(width: number, stableHeight: number): GoLayoutInput {
  return {
    go: true,
    width,
    stableHeight,
    deviceOrientation: width > stableHeight ? 'landscape' : 'portrait',
    largeScreen: Math.min(width, stableHeight) >= 600,
    epoch: 0,
    nativeMetrics: false,
  };
}

describe('computeGoLayout', () => {
  // §3.0 of the plan. 873x393 is 'expanded' by the ≥840 rule (the plan's
  // table said medium, which contradicts its own class definition).
  const rows: [
    string,
    GoLayout['widthClass'],
    boolean, // short
    'top' | 'bottom',
    boolean, // two-pane
  ][] = [
    ['393x873', 'compact', false, 'bottom', false],
    ['592x360', 'compact', true, 'top', false], // 640x360 minus 3-button nav
    ['780x360', 'medium', true, 'top', false],
    ['873x393', 'expanded', true, 'top', false],
    ['915x412', 'expanded', true, 'top', false],
    ['990x440', 'expanded', true, 'top', false],
    ['1280x400', 'expanded', true, 'top', false],
    ['673x841', 'medium', false, 'bottom', false],
    ['600x960', 'medium', false, 'bottom', false],
    ['640x800', 'medium', false, 'bottom', false],
    ['840x900', 'expanded', false, 'bottom', true],
    ['800x1280', 'medium', false, 'bottom', true],
    ['1024x1366', 'expanded', false, 'bottom', true],
    ['900x840', 'expanded', false, 'top', true],
    ['841x701', 'expanded', false, 'top', true],
    ['960x600', 'expanded', false, 'top', true],
    ['1280x800', 'expanded', false, 'top', true],
    ['1366x1024', 'expanded', false, 'top', true],
    ['1848x1140', 'expanded', false, 'top', true],
  ];

  it.each(rows)('%s', (size, widthClass, short, nav, twoPane) => {
    const [w, h] = size.split('x').map(Number);
    const l = computeGoLayout(input(w, h));
    expect(l.widthClass).toBe(widthClass);
    expect(l.short).toBe(short);
    expect(l.navInTopBar ? 'top' : 'bottom').toBe(nav);
    expect(l.chatTwoPane).toBe(twoPane);
    expect(l.landscape).toBe(w > h);
    // One-row toolbar everywhere except phone portrait.
    expect(l.toolbarOneRow).toBe(size !== '393x873');
    expect(Object.isFrozen(l)).toBe(true);
  });

  it('keeps two-pane on down to 748 once on, and needs 760 to turn on', () => {
    const on = computeGoLayout(input(760, 1000));
    expect(on.chatTwoPane).toBe(true);
    expect(computeGoLayout(input(759, 1000)).chatTwoPane).toBe(false);
    expect(computeGoLayout(input(748, 1000), on).chatTwoPane).toBe(true);
    expect(computeGoLayout(input(747, 1000), on).chatTwoPane).toBe(false);
    const off = computeGoLayout(input(700, 1000));
    expect(computeGoLayout(input(759, 1000), off).chatTwoPane).toBe(false);
  });

  it('enters short below 520 and stays short below 532', () => {
    const tall = computeGoLayout(input(1000, 520));
    expect(tall.short).toBe(false);
    const short = computeGoLayout(input(1000, 519));
    expect(short.short).toBe(true);
    expect(computeGoLayout(input(1000, 531), short).short).toBe(true);
    expect(computeGoLayout(input(1000, 532), short).short).toBe(false);
    expect(computeGoLayout(input(1000, 525), tall).short).toBe(false);
  });

  it('never turns two-pane on off GO or in short windows', () => {
    expect(
      computeGoLayout({ ...input(1280, 800), go: false }).chatTwoPane
    ).toBe(false);
    expect(computeGoLayout(input(1280, 400)).chatTwoPane).toBe(false);
  });
});

describe('store', () => {
  let orientation: EventTarget & { type: string };

  function setWindow(w: number, h: number) {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: w,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: h,
    });
  }

  function setScreen(w: number, h: number, type: string) {
    Object.defineProperty(window.screen, 'width', {
      configurable: true,
      value: w,
    });
    Object.defineProperty(window.screen, 'height', {
      configurable: true,
      value: h,
    });
    orientation.type = type;
  }

  function sendMetrics(m: Partial<GoWindowMetrics>) {
    const full: GoWindowMetrics = {
      width: window.innerWidth,
      height: window.innerHeight,
      ime: 0,
      insetLeft: 0,
      insetRight: 0,
      smallestWidthDp: 800,
      ...m,
    };
    window.__goWindowMetrics = full;
    window.dispatchEvent(
      new CustomEvent(GO_WINDOW_METRICS_EVENT, { detail: full })
    );
  }

  const html = () => document.documentElement;

  beforeEach(() => {
    vi.useFakeTimers();
    orientation = Object.assign(new EventTarget(), {
      type: 'portrait-primary',
    });
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: orientation,
    });
    tw.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    delete window.__goWindowMetrics;
    __setGoLayoutForTests(null);
  });

  afterEach(() => {
    __setGoLayoutForTests(null);
    delete tw.Capacitor;
    delete window.__goWindowMetrics;
    vi.useRealTimers();
  });

  it('does nothing off GO: no listeners, no attributes, constant snapshot', () => {
    delete tw.Capacitor;
    __setGoLayoutForTests(null);
    const add = vi.spyOn(window, 'addEventListener');
    installGoLayout();
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
    expect(html().hasAttribute('data-go-layout')).toBe(false);
    expect(window.__goLayout).toBeUndefined();
    expect(getGoLayout().go).toBe(false);
    expect(getGoLayout()).toBe(getGoLayout());
    expect(getGoWindowMetrics()).toBeNull();
  });

  it('writes the <html> attributes on install and on every change', () => {
    setScreen(800, 1280, 'portrait-primary');
    setWindow(800, 1280);
    installGoLayout();
    expect(html().hasAttribute('data-go-layout')).toBe(true);
    expect(html().dataset.goWidth).toBe('medium');
    expect(html().dataset.goNav).toBe('bottom');
    expect(html().hasAttribute('data-go-short')).toBe(false);
    expect(window.__goLayout?.()).toBe(getGoLayout());

    setScreen(1280, 800, 'landscape-primary');
    setWindow(873, 393);
    window.dispatchEvent(new Event('resize'));
    expect(html().dataset.goWidth).toBe('expanded');
    expect(html().dataset.goNav).toBe('top');
    expect(html().hasAttribute('data-go-short')).toBe(true);
  });

  it('is idempotent', () => {
    setWindow(393, 873);
    installGoLayout();
    const add = vi.spyOn(window, 'addEventListener');
    installGoLayout();
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('ignores the keyboard when native metrics are present', () => {
    setScreen(393, 873, 'portrait-primary');
    setWindow(393, 873);
    installGoLayout();
    sendMetrics({ width: 393, height: 873, smallestWidthDp: 393 });
    const before = getGoLayout();
    expect(before.nativeMetrics).toBe(true);
    const cb = vi.fn();
    const unsub = subscribeGoLayout(cb);

    setWindow(393, 873 - 320);
    window.dispatchEvent(new Event('resize'));
    sendMetrics({ width: 393, height: 873, ime: 320, smallestWidthDp: 393 });

    expect(getGoLayout()).toBe(before);
    expect(cb).not.toHaveBeenCalled();
    expect(getGoWindowMetrics()?.ime).toBe(320);
    unsub();
  });

  it('falls back to the tallest height seen in the epoch', () => {
    setScreen(393, 873, 'portrait-primary');
    setWindow(393, 873);
    installGoLayout();
    expect(getGoLayout().nativeMetrics).toBe(false);
    const before = getGoLayout();

    setWindow(393, 553); // keyboard opens
    window.dispatchEvent(new Event('resize'));
    expect(getGoLayout()).toBe(before);
    expect(getGoLayout().stableHeight).toBe(873);

    // A small phone stays portrait-compact with the keyboard up.
    expect(getGoLayout().short).toBe(false);
    expect(getGoLayout().toolbarOneRow).toBe(false);
  });

  it('bumps epoch on rotation and re-baselines the fallback height', () => {
    setScreen(393, 873, 'portrait-primary');
    setWindow(393, 873);
    installGoLayout();
    expect(getGoLayout().epoch).toBe(0);

    setScreen(873, 393, 'landscape-primary');
    setWindow(873, 393);
    orientation.dispatchEvent(new Event('change'));
    expect(getGoLayout().epoch).toBe(1);
    expect(getGoLayout().stableHeight).toBe(393);
    expect(getGoLayout().deviceOrientation).toBe('landscape');

    // 1 px jitter is not a new epoch.
    setWindow(874, 393);
    window.dispatchEvent(new Event('resize'));
    expect(getGoLayout().epoch).toBe(1);

    setScreen(393, 873, 'portrait-primary');
    setWindow(393, 873);
    window.dispatchEvent(new Event('resize'));
    expect(getGoLayout().epoch).toBe(2);
    expect(getGoLayout().stableHeight).toBe(873);
  });

  it('holds the snapshot up to 300 ms while native and WebView disagree', () => {
    setScreen(800, 1280, 'portrait-primary');
    setWindow(800, 1280);
    installGoLayout();
    sendMetrics({ width: 800, height: 1280 });
    const before = getGoLayout();
    expect(before.nativeMetrics).toBe(true);

    // Native already reports landscape; the WebView has not resized yet.
    setScreen(1280, 800, 'landscape-primary');
    sendMetrics({ width: 1280, height: 800 });
    expect(getGoLayout()).toBe(before);

    vi.advanceTimersByTime(GO_LAYOUT.metricsHoldMs - 50);
    expect(getGoLayout()).toBe(before);

    // The WebView catches up inside the window: native wins at once.
    setWindow(1280, 800);
    window.dispatchEvent(new Event('resize'));
    expect(getGoLayout().width).toBe(1280);
    expect(getGoLayout().stableHeight).toBe(800);
    expect(getGoLayout().nativeMetrics).toBe(true);
    // Orientation and width arrive separately; each is a new baseline.
    expect(getGoLayout().epoch).toBeGreaterThan(before.epoch);
  });

  it('gives up holding after 300 ms and uses the fallback height', () => {
    setScreen(800, 1280, 'portrait-primary');
    setWindow(800, 1280);
    installGoLayout();
    sendMetrics({ width: 800, height: 1280 });
    const before = getGoLayout();

    setWindow(1280, 800);
    sendMetrics({ width: 700, height: 900 }); // stale or wrong native value
    expect(getGoLayout()).toBe(before);

    vi.advanceTimersByTime(GO_LAYOUT.metricsHoldMs + 1);
    expect(getGoLayout().width).toBe(1280);
    expect(getGoLayout().stableHeight).toBe(800);
    expect(getGoLayout().nativeMetrics).toBe(false);
  });

  it('reads largeScreen from smallestWidthDp, else from the screen', () => {
    setScreen(1280, 800, 'landscape-primary');
    setWindow(1280, 800);
    installGoLayout();
    expect(getGoLayout().largeScreen).toBe(true);
    sendMetrics({ width: 1280, height: 800, smallestWidthDp: 411 });
    expect(getGoLayout().largeScreen).toBe(false);
  });

  it('picks up metrics native set before install', () => {
    setWindow(960, 600);
    window.__goWindowMetrics = {
      width: 960,
      height: 600,
      ime: 0,
      insetLeft: 24,
      insetRight: 24,
      smallestWidthDp: 600,
    };
    installGoLayout();
    expect(getGoLayout().nativeMetrics).toBe(true);
    expect(getGoWindowMetrics()?.insetLeft).toBe(24);
  });
});

describe('__setGoLayoutForTests', () => {
  afterEach(() => __setGoLayoutForTests(null));

  it('forces a GO snapshot and notifies subscribers', () => {
    const cb = vi.fn();
    const unsub = subscribeGoLayout(cb);
    __setGoLayoutForTests({ go: true, width: 1280, stableHeight: 800 });
    expect(cb).toHaveBeenCalled();
    expect(isGoLayout()).toBe(true);
    expect(getGoLayout()).toMatchObject({
      go: true,
      widthClass: 'expanded',
      navInTopBar: true,
      chatTwoPane: true,
      deviceOrientation: 'landscape',
      largeScreen: true,
    });
    expect(document.documentElement.dataset.goWidth).toBe('expanded');
    unsub();
  });

  it('forces the Hub and clears everything on null', () => {
    __setGoLayoutForTests({ go: true });
    __setGoLayoutForTests({ go: false });
    expect(isGoLayout()).toBe(false);
    expect(document.documentElement.hasAttribute('data-go-layout')).toBe(false);
    __setGoLayoutForTests(null);
    expect(getGoLayout().go).toBe(false);
  });
});

describe('isGoLayout detection', () => {
  afterEach(() => {
    delete tw.Capacitor;
    delete tw.coreSetup;
    localStorage.removeItem('qortal.devGoLayout');
    vi.unstubAllEnvs();
    __setGoLayoutForTests(null);
  });

  const detect = () => {
    __setGoLayoutForTests(null);
    return isGoLayout();
  };

  it.each([
    ['Capacitor Android', { cap: 'android', core: false }, true],
    ['Capacitor electron', { cap: 'electron', core: false }, false],
    ['coreSetup present', { cap: 'android', core: true }, false],
    ['no Capacitor', { cap: null, core: false }, false],
  ])('%s matches isGoApp()', (_name, env, expected) => {
    if (env.cap) {
      tw.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => env.cap,
      };
    }
    if (env.core) tw.coreSetup = {};
    expect(detect()).toBe(expected);
    expect(detect()).toBe(isGoApp());
  });

  it('treats a throwing bridge as not GO', () => {
    tw.Capacitor = {
      isNativePlatform: () => {
        throw new Error('boom');
      },
    };
    expect(detect()).toBe(false);
  });

  it('caches the first answer for the session', () => {
    expect(detect()).toBe(false);
    tw.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    expect(isGoLayout()).toBe(false);
  });

  it('honours the dev flag only in DEV and never in Electron', () => {
    localStorage.setItem('qortal.devGoLayout', '1');
    vi.stubEnv('DEV', true);
    expect(detect()).toBe(true);

    tw.coreSetup = {};
    expect(detect()).toBe(false);
    delete tw.coreSetup;

    vi.stubEnv('DEV', false);
    expect(detect()).toBe(false);
  });
});
