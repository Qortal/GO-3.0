import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: 'android' }));
const calls = vi.hoisted(() => [] as string[]);
const plugin = vi.hoisted(() => ({
  resetHolds: vi.fn(async () => {
    calls.push('reset');
  }),
  setSecure: vi.fn(async ({ on }: { on: boolean }) => {
    calls.push(`secure:${on}`);
    return { on };
  }),
  setTouchProtection: vi.fn(async ({ on }: { on: boolean }) => {
    calls.push(`touch:${on}`);
    return { on };
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform },
  registerPlugin: () => plugin,
}));

const PAGE_RESET_MARK = '__qortalScreenSecurityPageReset';

/** Loads the module the way a freshly (re)loaded page does. */
const loadOnNewPage = async () => {
  delete (globalThis as Record<string, unknown>)[PAGE_RESET_MARK];
  vi.resetModules();
  return import('./ScreenSecurity');
};

describe('ScreenSecurity page start', () => {
  beforeEach(() => {
    native.platform = 'android';
    calls.length = 0;
    plugin.resetHolds.mockClear();
  });

  it("drops the previous page's native holds before this page's first hold", async () => {
    const { holdScreenProtection } = await loadOnNewPage();
    expect(calls).toEqual(['reset']);

    const release = holdScreenProtection('secure');
    release();
    expect(calls).toEqual(['reset', 'secure:true', 'secure:false']);
  });

  it('resets again after a reload', async () => {
    const first = await loadOnNewPage();
    first.holdScreenProtection('secure');
    // The page goes away while the lock screen holds secure mode.
    const second = await loadOnNewPage();
    second.holdScreenProtection('touch');
    expect(calls).toEqual(['reset', 'secure:true', 'reset', 'touch:true']);
  });

  it('resets only once per page, even if the module is evaluated again', async () => {
    const first = await loadOnNewPage();
    first.holdScreenProtection('secure');
    // A dev hot reload evaluates the module again in the same page: the
    // first copy's hold must survive.
    vi.resetModules();
    await import('./ScreenSecurity');
    expect(calls).toEqual(['reset', 'secure:true']);
  });

  it('does nothing in the desktop app or the browser', async () => {
    native.platform = 'electron';
    const { holdScreenProtection } = await loadOnNewPage();
    holdScreenProtection('secure')();
    native.platform = 'web';
    await loadOnNewPage();
    expect(calls).toEqual([]);
  });

  it('survives a native shell without the reset method', async () => {
    plugin.resetHolds.mockRejectedValueOnce(new Error('not implemented'));
    await expect(loadOnNewPage()).resolves.toBeDefined();

    plugin.resetHolds.mockImplementationOnce(() => {
      throw new Error('plugin missing');
    });
    const { holdScreenProtection } = await loadOnNewPage();
    holdScreenProtection('secure');
    expect(calls).toEqual(['secure:true']);
  });
});
