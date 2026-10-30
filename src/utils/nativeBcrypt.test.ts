import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  hashPasswordBatch: vi.fn(),
  runtimeInfo: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
  registerPlugin: () => plugin,
}));

import { getNativeBcryptRuntimeInfo } from './nativeBcrypt';

const BASE = { debuggable: false, poolSize: 7, cores: 8, probeMs: 12 };

describe('getNativeBcryptRuntimeInfo', () => {
  beforeEach(() => {
    plugin.runtimeInfo.mockReset();
  });

  it('passes the GrapheneOS JIT flag and the WebView provider through', async () => {
    plugin.runtimeInfo.mockResolvedValueOnce({
      ...BASE,
      webViewJitRestricted: true,
      webViewPackage: 'app.vanadium.webview',
      webViewVersion: '141.0.7390.43',
    });
    await expect(getNativeBcryptRuntimeInfo()).resolves.toEqual({
      ...BASE,
      webViewJitRestricted: true,
      webViewPackage: 'app.vanadium.webview',
      webViewVersion: '141.0.7390.43',
    });
  });

  it('keeps an explicit null flag (no such OS flag) apart from an older app', async () => {
    plugin.runtimeInfo.mockResolvedValueOnce({
      ...BASE,
      webViewJitRestricted: null,
    });
    await expect(getNativeBcryptRuntimeInfo()).resolves.toEqual({
      ...BASE,
      webViewJitRestricted: null,
    });

    plugin.runtimeInfo.mockResolvedValueOnce({ ...BASE });
    const older = await getNativeBcryptRuntimeInfo();
    expect(older).toEqual(BASE);
    expect(older).not.toHaveProperty('webViewJitRestricted');
  });

  it('drops values of the wrong type', async () => {
    plugin.runtimeInfo.mockResolvedValueOnce({
      ...BASE,
      webViewJitRestricted: 'true',
      webViewPackage: 42,
      webViewVersion: '',
    });
    await expect(getNativeBcryptRuntimeInfo()).resolves.toEqual(BASE);
  });
});
