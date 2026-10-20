import { afterEach, describe, expect, it, vi } from 'vitest';

type CapWindow = { Capacitor?: unknown };

const loadDefault = async () => {
  vi.resetModules();
  const { isDisabledEditorEnterAtom } = await import('./global');
  return (isDisabledEditorEnterAtom as unknown as { init: boolean }).init;
};

describe('Enter default in the chat composer', () => {
  afterEach(() => {
    delete (window as CapWindow).Capacitor;
  });

  it('is new line in GO, like other phone chat apps', async () => {
    (window as CapWindow).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    expect(await loadDefault()).toBe(true);
  });

  it('stays send on the desktop', async () => {
    (window as CapWindow).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'electron',
    };
    expect(await loadDefault()).toBe(false);
  });
});
