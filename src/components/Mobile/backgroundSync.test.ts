import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  android: true,
  plugin: {
    getBackgroundSyncState: vi.fn(),
    isIgnoringBatteryOptimizations: vi.fn(),
    requestIgnoreBatteryOptimizations: vi.fn(),
    openAppBatterySettings: vi.fn(),
    openVendorBatterySettings: vi.fn() as ReturnType<typeof vi.fn> | undefined,
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => native.android,
      getPlatform: () => (native.android ? 'android' : 'web'),
    },
  };
});
vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: native.plugin,
}));

import {
  fetchBackgroundSyncState,
  fetchIgnoringBatteryOptimizations,
  formatUnlockDeviceDetail,
  normalizeBackgroundSyncState,
  normalizeVendorFreezeEvent,
  normalizeVendorFreezeRecords,
  openVendorBatterySettings,
  requestBatteryExemption,
  subscribeBackgroundSyncEvents,
} from './backgroundSync';

const AT = Date.UTC(2026, 9, 2, 6, 0, 0);

describe('normalizeVendorFreezeRecords', () => {
  it('keeps valid records, oldest first, one per time', () => {
    expect(
      normalizeVendorFreezeRecords([
        { at: AT, gapMs: 600_000, ignoring: true, charging: true },
        { at: AT - 1_000, gapMs: '120000', ignoring: 'yes', charging: 1 },
        { at: AT, gapMs: 700_000, ignoring: false, charging: false },
        { at: 0, gapMs: 1 },
        { at: AT + 1, gapMs: -1 },
        { at: AT + 2 },
        { at: true, gapMs: 1 },
        null,
        'junk',
      ])
    ).toEqual([
      { at: AT - 1_000, gapMs: 120_000, ignoring: false, charging: false },
      { at: AT, gapMs: 700_000, ignoring: false, charging: false },
    ]);
    expect(normalizeVendorFreezeRecords(undefined)).toEqual([]);
    expect(normalizeVendorFreezeRecords({})).toEqual([]);
  });

  it('keeps the newest when a build sends more than it should', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      at: AT + i,
      gapMs: 1,
    }));
    const kept = normalizeVendorFreezeRecords(many);
    expect(kept).toHaveLength(50);
    expect(kept[kept.length - 1].at).toBe(AT + 79);
  });
});

describe('normalizeBackgroundSyncState', () => {
  it('reads the new fields', () => {
    const state = normalizeBackgroundSyncState({
      mode: 'always',
      manufacturer: ' vivo ',
      vendorFreezeRecent: [
        { at: AT, gapMs: 300_000, ignoring: false, charging: true },
      ],
      ignoringBatteryOptimizations: true,
    });
    expect(state).toMatchObject({
      mode: 'always',
      manufacturer: 'vivo',
      vendorFreezeRecent: [
        { at: AT, gapMs: 300_000, ignoring: false, charging: true },
      ],
      ignoringBatteryOptimizations: true,
    });
  });

  it('marks fields an older native build lacks', () => {
    expect(normalizeBackgroundSyncState({ mode: 'charging' })).toMatchObject({
      vendorFreezeRecent: [],
      ignoringBatteryOptimizations: null,
      thermalStatus: null,
      powerSave: null,
      batteryTempC: null,
      plugType: null,
      batteryPct: null,
    });
  });

  it('keeps valid device facts', () => {
    expect(
      normalizeBackgroundSyncState({
        mode: 'charging',
        thermalStatus: 2,
        powerSave: true,
        batteryTempC: 31.2,
        plugType: 'usb',
        batteryPct: 64,
      })
    ).toMatchObject({
      thermalStatus: 2,
      powerSave: true,
      batteryTempC: 31.2,
      plugType: 'usb',
      batteryPct: 64,
    });
    // The edges of each range, and every plug type native sends.
    expect(
      normalizeBackgroundSyncState({
        thermalStatus: 0,
        powerSave: false,
        batteryTempC: -40,
        plugType: 'none',
        batteryPct: 0,
      })
    ).toMatchObject({
      thermalStatus: 0,
      powerSave: false,
      batteryTempC: -40,
      plugType: 'none',
      batteryPct: 0,
    });
    expect(
      normalizeBackgroundSyncState({
        thermalStatus: 6,
        batteryTempC: 120,
        batteryPct: 100,
      })
    ).toMatchObject({ thermalStatus: 6, batteryTempC: 120, batteryPct: 100 });
    for (const plugType of [
      'none',
      'ac',
      'usb',
      'wireless',
      'dock',
      'other',
      'unknown',
    ]) {
      expect(normalizeBackgroundSyncState({ plugType })?.plugType).toBe(
        plugType
      );
    }
  });

  it('drops device facts that are out of range or the wrong type', () => {
    expect(
      normalizeBackgroundSyncState({
        mode: 'charging',
        thermalStatus: 9,
        powerSave: 'yes',
        batteryTempC: 'hot',
        plugType: 'magic',
        batteryPct: 140,
      })
    ).toMatchObject({
      thermalStatus: null,
      powerSave: null,
      batteryTempC: null,
      plugType: null,
      batteryPct: null,
    });
    expect(
      normalizeBackgroundSyncState({
        thermalStatus: 1.5,
        powerSave: 1,
        batteryTempC: Number.NaN,
        plugType: 'USB',
        batteryPct: 64.5,
      })
    ).toMatchObject({
      thermalStatus: null,
      powerSave: null,
      batteryTempC: null,
      plugType: null,
      batteryPct: null,
    });
    expect(
      normalizeBackgroundSyncState({
        thermalStatus: -1,
        batteryTempC: 121,
        batteryPct: -1,
      })
    ).toMatchObject({
      thermalStatus: null,
      batteryTempC: null,
      batteryPct: null,
    });
    expect(
      normalizeBackgroundSyncState({
        thermalStatus: '2',
        batteryTempC: '31.2',
        batteryPct: '64',
      })
    ).toMatchObject({
      thermalStatus: null,
      batteryTempC: null,
      batteryPct: null,
    });
  });
});

describe('formatUnlockDeviceDetail', () => {
  it('summarises the device facts on one line', () => {
    expect(
      formatUnlockDeviceDetail(
        normalizeBackgroundSyncState({
          charging: true,
          plugType: 'usb',
          batteryPct: 64,
          batteryTempC: 31.2,
          thermalStatus: 2,
          powerSave: false,
        })
      )
    ).toBe(
      'charging usb, battery 64%, 31.2 °C, thermal moderate, power save off'
    );
    expect(
      formatUnlockDeviceDetail(
        normalizeBackgroundSyncState({
          charging: false,
          plugType: 'none',
          batteryTempC: 38,
          thermalStatus: 6,
          powerSave: true,
        })
      )
    ).toBe('on battery, 38.0 °C, thermal shutdown, power save on');
  });

  it('says unknown for facts a phone does not give', () => {
    // Android 9: no thermal status.
    expect(
      formatUnlockDeviceDetail(
        normalizeBackgroundSyncState({
          charging: true,
          plugType: 'unknown',
          powerSave: false,
        })
      )
    ).toBe('charging, thermal unknown, power save off');
  });

  it('gives nothing for an older native build or no state', () => {
    expect(
      formatUnlockDeviceDetail(
        normalizeBackgroundSyncState({ mode: 'charging', charging: true })
      )
    ).toBeNull();
    expect(formatUnlockDeviceDetail(null)).toBeNull();
    expect(formatUnlockDeviceDetail(undefined)).toBeNull();
  });
});

describe('normalizeVendorFreezeEvent', () => {
  it('reads the new payload fields', () => {
    expect(
      normalizeVendorFreezeEvent({
        count: 3,
        lastAt: AT,
        manufacturer: 'vivo',
        gapMs: 900_000,
        ignoring: false,
        charging: true,
      })
    ).toEqual({
      count: 3,
      lastAt: AT,
      manufacturer: 'vivo',
      gapMs: 900_000,
      ignoring: false,
      charging: true,
    });
  });

  it('nulls what an older build does not send', () => {
    expect(normalizeVendorFreezeEvent({ count: 1 }, AT)).toEqual({
      count: 1,
      lastAt: AT,
      manufacturer: '',
      gapMs: null,
      ignoring: null,
      charging: null,
    });
    expect(normalizeVendorFreezeEvent(null, AT).count).toBe(0);
  });
});

describe('native calls', () => {
  beforeEach(() => {
    native.android = true;
    native.plugin.openVendorBatterySettings = vi
      .fn()
      .mockResolvedValue({ opened: 'vendor' });
    native.plugin.openAppBatterySettings.mockResolvedValue({ success: true });
    native.plugin.isIgnoringBatteryOptimizations.mockResolvedValue({
      ignoring: true,
    });
    native.plugin.requestIgnoreBatteryOptimizations.mockResolvedValue({
      success: true,
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the vendor page, as native reports', async () => {
    await expect(openVendorBatterySettings()).resolves.toBe('vendor');
    native.plugin.openVendorBatterySettings?.mockResolvedValue({
      opened: 'app_details',
    });
    await expect(openVendorBatterySettings()).resolves.toBe('app_details');
    native.plugin.openVendorBatterySettings?.mockResolvedValue({
      opened: null,
    });
    await expect(openVendorBatterySettings()).resolves.toBeNull();
    expect(native.plugin.openAppBatterySettings).not.toHaveBeenCalled();
  });

  it('falls back to App info on an older native build', async () => {
    native.plugin.openVendorBatterySettings = undefined;
    await expect(openVendorBatterySettings()).resolves.toBe('app_details');
    native.plugin.openVendorBatterySettings = vi
      .fn()
      .mockRejectedValue(new Error('UNIMPLEMENTED'));
    await expect(openVendorBatterySettings()).resolves.toBe('app_details');
    native.plugin.openAppBatterySettings.mockRejectedValue(new Error('no'));
    await expect(openVendorBatterySettings()).resolves.toBeNull();
  });

  it('wraps the exemption calls', async () => {
    await expect(fetchIgnoringBatteryOptimizations()).resolves.toBe(true);
    await expect(requestBatteryExemption()).resolves.toBe(true);
    native.plugin.isIgnoringBatteryOptimizations.mockRejectedValue(
      new Error('x')
    );
    native.plugin.requestIgnoreBatteryOptimizations.mockRejectedValue(
      new Error('x')
    );
    await expect(fetchIgnoringBatteryOptimizations()).resolves.toBeNull();
    await expect(requestBatteryExemption()).resolves.toBe(false);
  });

  it('does nothing off Android', async () => {
    native.android = false;
    await expect(openVendorBatterySettings()).resolves.toBeNull();
    await expect(fetchIgnoringBatteryOptimizations()).resolves.toBeNull();
    await expect(requestBatteryExemption()).resolves.toBe(false);
    await expect(fetchBackgroundSyncState()).resolves.toBeNull();
    expect(subscribeBackgroundSyncEvents({})).toBeTypeOf('function');
    expect(native.plugin.getBackgroundSyncState).not.toHaveBeenCalled();
    expect(native.plugin.addListener).not.toHaveBeenCalled();
  });

  it('passes the full freeze event to the listener', async () => {
    let handler: ((event: unknown) => void) | undefined;
    native.plugin.addListener.mockImplementation(
      async (_name: string, fn: (event: unknown) => void) => {
        handler = fn;
        return { remove: vi.fn() };
      }
    );
    const onVendorFreezeDetected = vi.fn();
    const unsubscribe = subscribeBackgroundSyncEvents({
      onVendorFreezeDetected,
    });
    handler?.({
      count: 2,
      lastAt: AT,
      manufacturer: 'vivo',
      gapMs: 1_000_000,
      ignoring: true,
      charging: false,
    });
    expect(onVendorFreezeDetected).toHaveBeenCalledWith({
      count: 2,
      lastAt: AT,
      manufacturer: 'vivo',
      gapMs: 1_000_000,
      ignoring: true,
      charging: false,
    });
    unsubscribe();
  });
});
