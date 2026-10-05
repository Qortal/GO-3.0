import { afterEach, describe, expect, it, vi } from 'vitest';

type Win = Record<string, unknown>;
const win = window as unknown as Win;

afterEach(() => {
  delete win.Capacitor;
  delete win.CapacitorCustomPlatform;
  delete win.coreSetup;
  vi.resetModules();
});

/**
 * The Electron main-window preload, then a fresh @capacitor/core, the way the
 * desktop boots: the preload exposes CapacitorCustomPlatform before the
 * renderer bundle loads.
 */
async function bootDesktopCapacitor() {
  win.CapacitorCustomPlatform = { name: 'electron', plugins: {} };
  win.coreSetup = {};
  delete win.Capacitor;
  vi.resetModules();
  return import('@capacitor/core');
}

async function loadPlatform() {
  return import('./platform');
}

describe('isCapacitor on the Electron desktop', () => {
  it('is false although Capacitor counts the electron platform as native', async () => {
    const { Capacitor } = await bootDesktopCapacitor();
    // The premise: what the desktop main window really reports.
    expect(Capacitor.getPlatform()).toBe('electron');
    expect(Capacitor.isNativePlatform()).toBe(true);

    const { isCapacitor, isGoApp, isElectron } = await loadPlatform();
    expect(isElectron()).toBe(true);
    expect(isCapacitor()).toBe(false);
    expect(isGoApp()).toBe(false);
  });

  it('is false in the bridge copy too', async () => {
    await bootDesktopCapacitor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bridge = await import('../bridge/capacitorBridge');
      expect(bridge.isCapacitor()).toBe(false);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('isCapacitor elsewhere', () => {
  it('is true in GO on Android', async () => {
    win.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    const { isCapacitor, isGoApp } = await loadPlatform();
    expect(isCapacitor()).toBe(true);
    expect(isGoApp()).toBe(true);
  });

  it('is false in a plain browser', async () => {
    win.Capacitor = {
      isNativePlatform: () => false,
      getPlatform: () => 'web',
    };
    const { isCapacitor } = await loadPlatform();
    expect(isCapacitor()).toBe(false);
  });

  it('is false without Capacitor or when it throws', async () => {
    const { isCapacitor } = await loadPlatform();
    expect(isCapacitor()).toBe(false);
    win.Capacitor = {
      isNativePlatform: () => {
        throw new Error('not ready');
      },
    };
    expect(isCapacitor()).toBe(false);
  });
});
