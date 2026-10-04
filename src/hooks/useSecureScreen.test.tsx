import { renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: true }));
const plugin = vi.hoisted(() => ({
  resetHolds: vi.fn(async () => undefined),
  setSecure: vi.fn(async ({ on }: { on: boolean }) => ({ on })),
  setTouchProtection: vi.fn(async ({ on }: { on: boolean }) => ({ on })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => (native.value ? 'android' : 'web') },
  registerPlugin: () => plugin,
}));

import {
  holdScreenProtection,
  resetScreenProtectionForTests,
  screenProtectionHolds,
} from '../plugins/ScreenSecurity';
import {
  useSecureScreen,
  type UseSecureScreenOptions,
} from './useSecureScreen';

const secureCalls = () => plugin.setSecure.mock.calls.map(([opts]) => opts.on);
const lastSecureCall = () => secureCalls()[secureCalls().length - 1];
const touchCalls = () =>
  plugin.setTouchProtection.mock.calls.map(([opts]) => opts.on);

describe('useSecureScreen', () => {
  beforeEach(() => {
    native.value = true;
    resetScreenProtectionForTests();
    plugin.setSecure.mockClear();
    plugin.setTouchProtection.mockClear();
  });

  afterEach(() => {
    resetScreenProtectionForTests();
  });

  it('protects the screen while mounted and releases it on unmount', () => {
    const { unmount } = renderHook(() => useSecureScreen({ secure: true }));
    expect(secureCalls()).toEqual([true]);
    expect(screenProtectionHolds('secure')).toBe(1);

    unmount();
    expect(secureCalls()).toEqual([true, false]);
    expect(screenProtectionHolds('secure')).toBe(0);
    expect(plugin.setTouchProtection).not.toHaveBeenCalled();
  });

  it('follows the flag of a dialog that stays mounted while closed', () => {
    const { rerender, unmount } = renderHook(
      (options: UseSecureScreenOptions) => useSecureScreen(options),
      { initialProps: { secure: false } }
    );
    expect(plugin.setSecure).not.toHaveBeenCalled();

    rerender({ secure: true });
    expect(secureCalls()).toEqual([true]);
    // Re-rendering while open does not send anything new.
    rerender({ secure: true });
    expect(secureCalls()).toEqual([true]);

    rerender({ secure: false });
    expect(secureCalls()).toEqual([true, false]);
    unmount();
    expect(secureCalls()).toEqual([true, false]);
  });

  it('keeps overlapping screens protected until the last one closes', () => {
    const seedScreen = renderHook(() => useSecureScreen({ secure: true }));
    const lockScreen = renderHook(() => useSecureScreen({ secure: true }));
    expect(screenProtectionHolds('secure')).toBe(2);
    // Only the first hold reaches the native side.
    expect(secureCalls()).toEqual([true]);

    lockScreen.unmount();
    expect(secureCalls()).toEqual([true]);
    expect(screenProtectionHolds('secure')).toBe(1);

    seedScreen.unmount();
    expect(secureCalls()).toEqual([true, false]);
  });

  it('counts touch protection separately from secure mode', () => {
    const approval = renderHook(() =>
      useSecureScreen({ secure: true, touchProtection: true })
    );
    const keyScreen = renderHook(() => useSecureScreen({ secure: true }));
    expect(touchCalls()).toEqual([true]);

    approval.unmount();
    expect(touchCalls()).toEqual([true, false]);
    // The key screen is still shown: the window stays secure.
    expect(secureCalls()).toEqual([true]);

    keyScreen.unmount();
    expect(secureCalls()).toEqual([true, false]);
  });

  it('ends protected after StrictMode mounts, unmounts and remounts', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { unmount } = renderHook(() => useSecureScreen({ secure: true }), {
      wrapper,
    });
    expect(lastSecureCall()).toBe(true);
    expect(screenProtectionHolds('secure')).toBe(1);

    unmount();
    expect(lastSecureCall()).toBe(false);
    expect(screenProtectionHolds('secure')).toBe(0);
  });

  it('does nothing on desktop or in the browser', () => {
    native.value = false;
    const { unmount } = renderHook(() =>
      useSecureScreen({ secure: true, touchProtection: true })
    );
    unmount();
    expect(plugin.setSecure).not.toHaveBeenCalled();
    expect(plugin.setTouchProtection).not.toHaveBeenCalled();
  });

  it('survives a native shell without the plugin', async () => {
    plugin.setSecure.mockRejectedValueOnce(new Error('not implemented'));
    const { unmount } = renderHook(() => useSecureScreen({ secure: true }));
    await Promise.resolve();
    unmount();
    expect(secureCalls()).toEqual([true, false]);
  });
});

describe('holdScreenProtection', () => {
  beforeEach(() => {
    native.value = true;
    resetScreenProtectionForTests();
    plugin.setSecure.mockClear();
  });

  it('ignores a second release of the same hold', () => {
    const releaseA = holdScreenProtection('secure');
    const releaseB = holdScreenProtection('secure');
    releaseA();
    releaseA();
    // B still holds it: releasing A twice must not turn protection off.
    expect(screenProtectionHolds('secure')).toBe(1);
    expect(secureCalls()).toEqual([true]);
    releaseB();
    expect(secureCalls()).toEqual([true, false]);
  });
});
