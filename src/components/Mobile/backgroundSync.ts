import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  QortalBackground,
  type VendorBatterySettingsPage,
  type VendorFreezeRecord,
} from '../../plugins/QortalBackground';

export type { VendorBatterySettingsPage, VendorFreezeRecord };

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
  manufacturer: string;
  /**
   * Up to 50 recorded freezes, oldest first. When its log is full, native
   * drops stale or short episodes first, so this is not strictly the last N.
   */
  vendorFreezeRecent: VendorFreezeRecord[];
  /** Current exemption; null when an older native build does not say. */
  ignoringBatteryOptimizations: boolean | null;
};

export type VendorFreezeEvent = {
  count: number;
  lastAt: number;
  manufacturer: string;
  /** Null from older native builds, which do not send them. */
  gapMs: number | null;
  ignoring: boolean | null;
  charging: boolean | null;
};

type BackgroundSyncPlugin = {
  setBackgroundSyncMode(options: {
    mode: BackgroundSyncMode;
  }): Promise<{ ok: boolean }>;
  getBackgroundSyncState(): Promise<Partial<BackgroundSyncState>>;
  acknowledgeVendorFreezeHint(): Promise<{ ok: boolean }>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring?: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ success?: boolean }>;
  openAppBatterySettings(): Promise<{ success?: boolean }>;
  openVendorBatterySettings(): Promise<{ opened?: unknown }>;
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

/** Native's log holds up to 50 (VendorFreezeLog.MAX_ENTRIES). */
export const VENDOR_FREEZE_RECENT_MAX = 50;

const finitePositive = (value: unknown): number | null => {
  if (value == null || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Valid records only (epoch ms `at`, non-negative gap), oldest first, one per
 * `at`, at most VENDOR_FREEZE_RECENT_MAX (the newest kept).
 */
export const normalizeVendorFreezeRecords = (
  raw: unknown
): VendorFreezeRecord[] => {
  if (!Array.isArray(raw)) return [];
  const byAt = new Map<number, VendorFreezeRecord>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Partial<Record<keyof VendorFreezeRecord, unknown>>;
    const at = finitePositive(value.at);
    if (at == null) continue;
    const gap = Number(value.gapMs);
    if (value.gapMs == null || !Number.isFinite(gap) || gap < 0) continue;
    byAt.set(at, {
      at,
      gapMs: gap,
      ignoring: value.ignoring === true,
      charging: value.charging === true,
    });
  }
  return [...byAt.values()]
    .sort((a, b) => a.at - b.at)
    .slice(-VENDOR_FREEZE_RECENT_MAX);
};

export const normalizeBackgroundSyncState = (
  raw: unknown
): BackgroundSyncState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Record<keyof BackgroundSyncState, unknown>> &
    Partial<BackgroundSyncState>;
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
    manufacturer:
      typeof value.manufacturer === 'string' ? value.manufacturer.trim() : '',
    vendorFreezeRecent: normalizeVendorFreezeRecords(value.vendorFreezeRecent),
    ignoringBatteryOptimizations:
      typeof value.ignoringBatteryOptimizations === 'boolean'
        ? value.ignoringBatteryOptimizations
        : null,
  };
};

/** The live event's payload; fields an older native build omits are null. */
export const normalizeVendorFreezeEvent = (
  raw: unknown,
  now: number = Date.now()
): VendorFreezeEvent => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof VendorFreezeEvent, unknown>
  >;
  const count = Number(value.count);
  const gap = Number(value.gapMs);
  return {
    count: Number.isFinite(count) && count > 0 ? count : 0,
    lastAt: finitePositive(value.lastAt) ?? now,
    manufacturer:
      typeof value.manufacturer === 'string' ? value.manufacturer.trim() : '',
    gapMs: value.gapMs != null && Number.isFinite(gap) && gap >= 0 ? gap : null,
    ignoring: typeof value.ignoring === 'boolean' ? value.ignoring : null,
    charging: typeof value.charging === 'boolean' ? value.charging : null,
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

/**
 * Whether GO is on the battery-optimisation whitelist now. Null off Android
 * or when native cannot say.
 */
export const fetchIgnoringBatteryOptimizations = async (): Promise<
  boolean | null
> => {
  if (!isNativeAndroid()) return null;
  try {
    const result = await plugin.isIgnoringBatteryOptimizations();
    return typeof result?.ignoring === 'boolean' ? result.ignoring : null;
  } catch {
    return null;
  }
};

/** Opens Android's 'Allow in background' dialog. False when it could not. */
export const requestBatteryExemption = async (): Promise<boolean> => {
  if (!isNativeAndroid()) return false;
  try {
    const result = await plugin.requestIgnoreBatteryOptimizations();
    return result?.success !== false;
  } catch {
    return false;
  }
};

const isSettingsPage = (value: unknown): value is VendorBatterySettingsPage =>
  value === 'vendor' || value === 'app_details';

/**
 * The phone's own battery page where native knows one (vivo / iQOO), else
 * GO's App info page. An older native build without the method falls back to
 * openAppBatterySettings (App info). Null when nothing opened.
 */
export const openVendorBatterySettings =
  async (): Promise<VendorBatterySettingsPage | null> => {
    if (!isNativeAndroid()) return null;
    try {
      const result = await plugin.openVendorBatterySettings();
      return isSettingsPage(result?.opened) ? result.opened : null;
    } catch {
      // Method missing (older APK) or rejected: App info still helps.
    }
    try {
      const result = await plugin.openAppBatterySettings();
      return result?.success === false ? null : 'app_details';
    } catch {
      return null;
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
        onFreeze(normalizeVendorFreezeEvent(event));
      })
    );
  }
  return () => {
    for (const handle of handles) {
      void handle.then((h) => h?.remove()).catch(() => {});
    }
  };
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
