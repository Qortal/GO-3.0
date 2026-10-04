import { afterEach, describe, expect, it, vi } from 'vitest';

// GO-02 / GO-14: Capacitor's logcat logging is off in every build, and WebView
// DevTools is pinned off so no release (non-debuggable) build can have it.
// (Chromium forces DevTools on in a debuggable build whatever this says.)
describe('capacitor.config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async () => (await import('../capacitor.config')).default;

  it('turns Capacitor logging and WebView debugging off explicitly', async () => {
    const config = await load();
    expect(config.loggingBehavior).toBe('none');
    expect(config.android?.loggingBehavior).toBeUndefined();
    expect(config.android?.webContentsDebuggingEnabled).toBe(false);
  });

  it('keeps DisableDeploy in the generated config.xml (N-18)', async () => {
    const config = await load();
    expect(config.cordova?.preferences?.DisableDeploy).toBe('true');
  });

  it.each(['1', 'true', 'yes'])(
    'cannot be switched on from the environment (QORTAL_GO_WEBVIEW_DEBUG=%s)',
    async (value) => {
      vi.stubEnv('QORTAL_GO_WEBVIEW_DEBUG', value);
      const config = await load();
      expect(config.android?.webContentsDebuggingEnabled).toBe(false);
      expect(config.loggingBehavior).toBe('none');
    }
  );
});
