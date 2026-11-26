import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  addListener: vi.fn(
    async (_event: string, _cb: (event: { at: number }) => void) => ({
      remove: async () => {},
    })
  ),
}));

vi.mock('../utils/platform', () => ({ isCapacitor: () => h.native }));
vi.mock('../plugins/QortalBackground', () => ({
  QortalBackground: { addListener: h.addListener },
}));

beforeEach(() => {
  vi.resetModules();
  h.native = true;
  h.addListener.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('default network changes', () => {
  it('listens to the native event once and tells every subscriber', async () => {
    const mod = await import('./defaultNetworkChange');
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = mod.subscribeDefaultNetworkChanged(first);
    await vi.waitFor(() => expect(h.addListener).toHaveBeenCalled());
    mod.subscribeDefaultNetworkChanged(second);
    await import('../plugins/QortalBackground');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.addListener).toHaveBeenCalledTimes(1);
    const [event, emit] = h.addListener.mock.calls[0]!;
    expect(event).toBe('defaultNetworkChanged');

    emit({ at: 1 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    emit({ at: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('one listener that throws does not keep the others from hearing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('./defaultNetworkChange');
    const heard = vi.fn();
    mod.subscribeDefaultNetworkChanged(() => {
      throw new Error('boom');
    });
    mod.subscribeDefaultNetworkChanged(heard);
    mod.reportDefaultNetworkChanged();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('asks no native code outside GO, and survives a native build without it', async () => {
    h.native = false;
    const desktop = await import('./defaultNetworkChange');
    desktop.subscribeDefaultNetworkChanged(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.addListener).not.toHaveBeenCalled();

    vi.resetModules();
    h.native = true;
    h.addListener.mockRejectedValueOnce(new Error('not implemented'));
    const old = await import('./defaultNetworkChange');
    const heard = vi.fn();
    old.subscribeDefaultNetworkChanged(heard);
    await vi.waitFor(() => expect(h.addListener).toHaveBeenCalledTimes(1));
    old.reportDefaultNetworkChanged();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
