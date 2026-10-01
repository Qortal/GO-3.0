import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ServiceModule = typeof import('./mobileBackgroundService');
type I18nModule = typeof import('../i18n/i18n');

const native = vi.hoisted(() => ({ platform: true }));
const plugin = vi.hoisted(
  () =>
    ({}) as {
      setLocalizedStrings?: ReturnType<typeof vi.fn>;
      setOutboxCount?: ReturnType<typeof vi.fn>;
    }
);

vi.mock('../plugins/QortalBackground', () => ({ QortalBackground: plugin }));
vi.mock('./platform', () => ({ isCapacitor: () => native.platform }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('../bridge/capacitorBridge', () => ({
  getMobileReticulumStatus: () => null,
  onMobileReticulumStatus: () => () => {},
}));
vi.mock('../components/Reticulum/reticulumStatus', () => ({
  getDeviceOnline: () => true,
  reticulumDisplayPhase: () => 'online',
  subscribeDeviceOnline: () => () => {},
  subscribeReticulumStatus: () => () => {},
}));

const NATIVE_KEYS = [
  'fgs_timeout_text',
  'fgs_timeout_title',
  'status_paused_text',
  'status_paused_title',
  'status_syncing_background',
  'status_waiting_text',
];

/** Fresh module state (and a fresh i18next instance) per test. */
async function load(): Promise<{
  service: ServiceModule;
  i18n: I18nModule['default'];
}> {
  vi.resetModules();
  const { default: i18n } = await import('../i18n/i18n');
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) =>
      i18n.on('initialized', () => resolve())
    );
  }
  const service = await import('./mobileBackgroundService');
  return { service, i18n };
}

const lastStrings = (): Record<string, string> => {
  const calls = plugin.setLocalizedStrings?.mock.calls ?? [];
  return (calls[calls.length - 1]?.[0] as { strings: Record<string, string> })
    .strings;
};

describe('native localized strings', () => {
  beforeEach(() => {
    native.platform = true;
    plugin.setLocalizedStrings = vi.fn().mockResolvedValue({ ok: true });
    plugin.setOutboxCount = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    delete plugin.setLocalizedStrings;
    delete plugin.setOutboxCount;
    vi.restoreAllMocks();
  });

  it('pushes every key once at install, with {{count}} left for native', async () => {
    const { service } = await load();
    service.installNativeLocalizedStrings();
    service.installNativeLocalizedStrings();
    expect(plugin.setLocalizedStrings).toHaveBeenCalledTimes(1);
    const strings = lastStrings();
    expect(Object.keys(strings).sort()).toEqual(NATIVE_KEYS);
    expect(strings.status_waiting_text).toContain('{{count}}');
    expect(strings.fgs_timeout_title).toBe('GO paused');
  });

  it('a language change triggers one push with the new texts', async () => {
    const { service, i18n } = await load();
    service.installNativeLocalizedStrings();
    expect(plugin.setLocalizedStrings).toHaveBeenCalledTimes(1);
    const english = lastStrings();

    await i18n.changeLanguage('de');
    // German loads lazily; its bundle arriving pushes the real texts.
    await vi.waitFor(() =>
      expect(plugin.setLocalizedStrings).toHaveBeenCalledTimes(2)
    );
    const german = lastStrings();
    expect(german.fgs_timeout_title).toBe('GO pausiert');
    expect(german.status_waiting_text).toContain('{{count}}');
    expect(german).not.toEqual(english);

    // The rest of the bundles landing does not push the same texts again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(plugin.setLocalizedStrings).toHaveBeenCalledTimes(2);
    await i18n.changeLanguage('en');
  });

  it('leaves out a key missing from every locale (never a raw key path)', async () => {
    const { service, i18n } = await load();
    const exists = i18n.exists.bind(i18n);
    vi.spyOn(i18n, 'exists').mockImplementation(((key: string, opts?: never) =>
      key.endsWith('.status_syncing_background')
        ? false
        : exists(key, opts)) as typeof i18n.exists);
    const strings = service.buildNativeLocalizedStrings();
    expect(strings).not.toHaveProperty('status_syncing_background');
    expect(
      Object.values(strings).some((v) => v.includes('background_sync.'))
    ).toBe(false);
    expect(Object.keys(strings)).toHaveLength(NATIVE_KEYS.length - 1);
  });

  it('is harmless on an APK without the method', async () => {
    delete plugin.setLocalizedStrings;
    const { service, i18n } = await load();
    expect(() => service.installNativeLocalizedStrings()).not.toThrow();
    await expect(i18n.changeLanguage('fr')).resolves.toBeDefined();
    await i18n.changeLanguage('en');
  });

  it('swallows a native rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    plugin.setLocalizedStrings = vi
      .fn()
      .mockRejectedValue(new Error('UNIMPLEMENTED'));
    const { service } = await load();
    service.installNativeLocalizedStrings();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it('does nothing off native', async () => {
    native.platform = false;
    const { service } = await load();
    service.installNativeLocalizedStrings();
    service.reportOwnOutboxCount(3);
    expect(plugin.setLocalizedStrings).not.toHaveBeenCalled();
    expect(plugin.setOutboxCount).not.toHaveBeenCalled();
  });
});

describe('own outbox count', () => {
  beforeEach(() => {
    native.platform = true;
    plugin.setLocalizedStrings = vi.fn().mockResolvedValue({ ok: true });
    plugin.setOutboxCount = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    delete plugin.setLocalizedStrings;
    delete plugin.setOutboxCount;
    vi.restoreAllMocks();
  });

  it('sends changes only, in order', async () => {
    const { service } = await load();
    for (const n of [3, 3, 0, 0, 2, Number.NaN, -1]) {
      service.reportOwnOutboxCount(n);
    }
    await vi.waitFor(() =>
      expect(plugin.setOutboxCount).toHaveBeenCalledTimes(4)
    );
    expect(plugin.setOutboxCount?.mock.calls).toEqual([
      [{ count: 3 }],
      [{ count: 0 }],
      [{ count: 2 }],
      [{ count: 0 }],
    ]);
  });

  it('is harmless on an APK without the method', async () => {
    delete plugin.setOutboxCount;
    const { service } = await load();
    expect(() => service.reportOwnOutboxCount(1)).not.toThrow();
  });

  it('swallows a native rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    plugin.setOutboxCount = vi
      .fn()
      .mockRejectedValueOnce(new Error('UNIMPLEMENTED'))
      .mockResolvedValue({ ok: true });
    const { service } = await load();
    service.reportOwnOutboxCount(1);
    service.reportOwnOutboxCount(2);
    await vi.waitFor(() =>
      expect(plugin.setOutboxCount).toHaveBeenCalledTimes(2)
    );
    expect(warn).toHaveBeenCalled();
  });
});
