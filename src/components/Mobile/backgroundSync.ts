import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { QortalBackground } from '../../plugins/QortalBackground';

/**
 * Background sync ("keep-alive") setting for GO on Android. The native side
 * (QortalBackgroundPlugin) owns the rule and persists the mode, so it still
 * applies while the page is frozen; this module only reads/writes it and
 * guards every call because older APKs do not implement these methods.
 */

export type BackgroundSyncMode = 'off' | 'charging' | 'always';

export const BACKGROUND_SYNC_MODES: readonly BackgroundSyncMode[] = [
  'off',
  'charging',
  'always',
];

export const DEFAULT_BACKGROUND_SYNC_MODE: BackgroundSyncMode = 'charging';

export type BackgroundSyncState = {
  mode: BackgroundSyncMode;
  charging: boolean;
  unmetered: boolean;
  relayProfile: 'full' | 'leaf';
  keepAliveActive: boolean;
  vendorFreezeCount: number;
  vendorFreezeLastAt: number | null;
  vendorFreezeHintPending: boolean;
  manufacturer: string;
};

export type VendorFreezeEvent = {
  count: number;
  lastAt: number;
  manufacturer: string;
};

type BackgroundSyncPlugin = {
  setBackgroundSyncMode(options: {
    mode: BackgroundSyncMode;
  }): Promise<{ ok: boolean }>;
  getBackgroundSyncState(): Promise<Partial<BackgroundSyncState>>;
  acknowledgeVendorFreezeHint(): Promise<{ ok: boolean }>;
  addListener(
    eventName: 'relayProfileChanged',
    listenerFunc: (event: { profile?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'vendorFreezeDetected',
    listenerFunc: (event: Partial<VendorFreezeEvent>) => void
  ): Promise<PluginListenerHandle>;
};

const plugin = QortalBackground as unknown as BackgroundSyncPlugin;

export const isNativeAndroid = (): boolean => {
  try {
    return (
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    );
  } catch {
    return false;
  }
};

export const isBackgroundSyncMode = (
  value: unknown
): value is BackgroundSyncMode =>
  typeof value === 'string' &&
  (BACKGROUND_SYNC_MODES as readonly string[]).includes(value);

export const normalizeBackgroundSyncState = (
  raw: unknown
): BackgroundSyncState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<BackgroundSyncState>;
  const lastAt = Number(value.vendorFreezeLastAt);
  const count = Number(value.vendorFreezeCount);
  return {
    mode: isBackgroundSyncMode(value.mode)
      ? value.mode
      : DEFAULT_BACKGROUND_SYNC_MODE,
    charging: value.charging === true,
    unmetered: value.unmetered === true,
    relayProfile: value.relayProfile === 'full' ? 'full' : 'leaf',
    keepAliveActive: value.keepAliveActive === true,
    vendorFreezeCount: Number.isFinite(count) && count > 0 ? count : 0,
    vendorFreezeLastAt: Number.isFinite(lastAt) && lastAt > 0 ? lastAt : null,
    vendorFreezeHintPending: value.vendorFreezeHintPending === true,
    manufacturer:
      typeof value.manufacturer === 'string' ? value.manufacturer.trim() : '',
  };
};

/** Resolves null when the plugin or method is missing (web, older APK). */
export const fetchBackgroundSyncState =
  async (): Promise<BackgroundSyncState | null> => {
    if (!isNativeAndroid()) return null;
    try {
      return normalizeBackgroundSyncState(
        await plugin.getBackgroundSyncState()
      );
    } catch {
      return null;
    }
  };

export const saveBackgroundSyncMode = async (
  mode: BackgroundSyncMode
): Promise<boolean> => {
  if (!isNativeAndroid()) return false;
  try {
    const result = await plugin.setBackgroundSyncMode({ mode });
    return result?.ok !== false;
  } catch {
    return false;
  }
};

export const acknowledgeVendorFreezeHint = async (): Promise<boolean> => {
  if (!isNativeAndroid()) return false;
  try {
    const result = await plugin.acknowledgeVendorFreezeHint();
    return result?.ok !== false;
  } catch {
    return false;
  }
};

export const subscribeBackgroundSyncEvents = (handlers: {
  onRelayProfileChanged?: (profile: 'full' | 'leaf') => void;
  onVendorFreezeDetected?: (event: VendorFreezeEvent) => void;
}): (() => void) => {
  if (!isNativeAndroid()) return () => {};
  const handles: Promise<PluginListenerHandle | null>[] = [];
  const guard = (register: () => Promise<PluginListenerHandle>) => {
    try {
      handles.push(register().catch(() => null));
    } catch {
      // Older APK without the event: nothing to listen to.
    }
  };
  if (handlers.onRelayProfileChanged) {
    const onRelay = handlers.onRelayProfileChanged;
    guard(() =>
      plugin.addListener('relayProfileChanged', (event) => {
        onRelay(event?.profile === 'full' ? 'full' : 'leaf');
      })
    );
  }
  if (handlers.onVendorFreezeDetected) {
    const onFreeze = handlers.onVendorFreezeDetected;
    guard(() =>
      plugin.addListener('vendorFreezeDetected', (event) => {
        const count = Number(event?.count);
        const lastAt = Number(event?.lastAt);
        onFreeze({
          count: Number.isFinite(count) ? count : 0,
          lastAt: Number.isFinite(lastAt) ? lastAt : Date.now(),
          manufacturer:
            typeof event?.manufacturer === 'string'
              ? event.manufacturer.trim()
              : '',
        });
      })
    );
  }
  return () => {
    for (const handle of handles) {
      void handle.then((h) => h?.remove()).catch(() => {});
    }
  };
};

const DONT_KILL_MY_APP_BASE = 'https://dontkillmyapp.com/';

/** Vendors with their own page on dontkillmyapp.com. */
const DONT_KILL_MY_APP_VENDORS = new Set([
  'asus',
  'blackview',
  'google',
  'htc',
  'huawei',
  'lenovo',
  'meizu',
  'motorola',
  'nokia',
  'oneplus',
  'oppo',
  'realme',
  'samsung',
  'sony',
  'unihertz',
  'vivo',
  'wiko',
  'xiaomi',
]);

/** Build.MANUFACTURER values that report a sub-brand or holding company. */
const DONT_KILL_MY_APP_ALIASES: Record<string, string> = {
  hmd: 'nokia',
  hmdglobal: 'nokia',
  honor: 'huawei',
  iqoo: 'vivo',
  poco: 'xiaomi',
  redmi: 'xiaomi',
};

export const dontKillMyAppUrl = (manufacturer: string | null | undefined) => {
  const key = String(manufacturer ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const vendor = DONT_KILL_MY_APP_ALIASES[key] ?? key;
  return DONT_KILL_MY_APP_VENDORS.has(vendor)
    ? `${DONT_KILL_MY_APP_BASE}${vendor}`
    : `${DONT_KILL_MY_APP_BASE}general`;
};

const MANUFACTURER_DISPLAY: Record<string, string> = {
  google: 'Google',
  huawei: 'Huawei',
  motorola: 'Motorola',
  oneplus: 'OnePlus',
  oppo: 'OPPO',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
};

/** Build.MANUFACTURER is often lowercase ("samsung"); show the brand name. */
export const displayManufacturer = (
  manufacturer: string | null | undefined
) => {
  const raw = String(manufacturer ?? '').trim();
  return MANUFACTURER_DISPLAY[raw.toLowerCase()] ?? raw;
};
