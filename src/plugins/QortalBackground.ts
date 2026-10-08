import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export type AlertNotificationActionEvent = {
  fromAddress?: string;
  type?: 'direct' | 'group' | 'general';
};

export type IncomingCallActionEvent = {
  callId?: string;
  action?: 'accept' | 'decline' | 'open';
};

/** When GO keeps chat running after it leaves the screen. */
export type BackgroundSyncMode = 'off' | 'charging' | 'always';

/**
 * 'full' = charging on an unmetered network (stable for 2 min): relay group
 * traffic and keep desktop-sized neighbour caps. 'leaf' = phone defaults.
 */
export type RelayProfile = 'full' | 'leaf';

/**
 * One detected vendor freeze, as the native side recorded it
 * (VendorFreezeLog.Entry). Entries come in recording order; sort by `at`.
 */
export type VendorFreezeRecord = {
  /** Wall-clock epoch ms of the service tick that noticed the freeze. */
  at: number;
  /**
   * From the last tick before the freeze to `at`, so `at - gapMs` is when
   * the freeze began; includes up to one 25 s tick interval.
   */
  gapMs: number;
  /**
   * GO was exempt from battery optimisation both at the last tick before
   * the freeze and when it was noticed.
   */
  ignoring: boolean;
  /** On the charger at the last tick before the freeze. */
  charging: boolean;
};

/** Which page openVendorBatterySettings() reached. */
export type VendorBatterySettingsPage = 'vendor' | 'app_details';

export type BackgroundSyncState = {
  mode: BackgroundSyncMode;
  charging: boolean;
  unmetered: boolean;
  relayProfile: RelayProfile;
  /** The WebView is being kept visible to Chromium while GO is off screen. */
  keepAliveActive: boolean;
  /** Times the vendor froze GO although it was meant to stay awake. */
  vendorFreezeCount: number;
  vendorFreezeLastAt: number | null;
  manufacturer: string;
  /**
   * Up to 50 recorded freezes, oldest first; when its log is full, native
   * drops stale or short episodes first. Missing on older native builds.
   */
  vendorFreezeRecent?: VendorFreezeRecord[];
  /**
   * GO is exempt now. Null when the system cannot say; missing on older
   * native builds.
   */
  ignoringBatteryOptimizations?: boolean | null;
};

export type VendorFreezeDetectedEvent = {
  count: number;
  lastAt: number;
  manufacturer: string;
  /** Newer native builds only. */
  gapMs?: number;
  ignoring?: boolean;
  charging?: boolean;
};

export interface QortalBackgroundPlugin {
  /** Persisted natively; default 'charging'. Older native builds reject. */
  setBackgroundSyncMode(options: {
    mode: BackgroundSyncMode;
  }): Promise<{ ok: boolean }>;

  getBackgroundSyncState(): Promise<BackgroundSyncState>;

  /** True while own messages still wait to leave the phone. */
  setOutboxPending(options: { pending: boolean }): Promise<{ ok: boolean }>;

  /** How many own messages wait to send, for native status texts. */
  setOutboxCount(options: { count: number }): Promise<{ ok: boolean }>;

  /**
   * Translated texts for notifications the native side draws itself, kept
   * across restarts. Values may hold a literal `{{count}}` for native to
   * fill; a missing key falls back to the English resources. Keys:
   * status_paused_title, status_paused_text, status_waiting_text,
   * status_waiting_short, fgs_timeout_title, fgs_timeout_text,
   * battery_pause_text, status_syncing_background.
   */
  setLocalizedStrings(options: {
    strings: Record<string, string>;
  }): Promise<{ ok: boolean }>;

  acknowledgeVendorFreezeHint(): Promise<{ ok: boolean }>;

  startPersistentStatus(options: {
    title?: string;
    detail?: string;
    nodeLabel?: string;
    syncLabel?: string;
    peersLabel?: string;
    statusKind?: 'starting' | 'online' | 'offline';
  }): Promise<{ success: boolean }>;

  updatePersistentStatus(options: {
    title?: string;
    detail?: string;
    nodeLabel?: string;
    syncLabel?: string;
    peersLabel?: string;
    statusKind?: 'starting' | 'online' | 'offline';
  }): Promise<{ success: boolean }>;

  stopPersistentStatus(): Promise<{ success: boolean }>;

  showAlertNotification(options: {
    alertId?: number;
    /** Stable per-conversation tag; identity becomes (tag, id) in the tray. */
    alertTag?: string;
    title?: string;
    body?: string;
    iconUrl?: string;
    fromAddress?: string;
    notificationType?: 'direct' | 'group' | 'general' | 'payment';
  }): Promise<{ success: boolean }>;

  showTransferNotification(options: {
    transferId: string;
    title?: string;
    text?: string;
    /** 0-100 for a determinate bar, -1 for indeterminate, -2 (default) for no bar. */
    progress?: number;
    ongoing?: boolean;
    /** Saved file a tap should open (content:// uri or path). */
    openUri?: string;
    openMimeType?: string;
    /** Pop up (heads-up) once rather than update quietly. */
    alert?: boolean;
    /** Button that opens the saved file, e.g. "Install". */
    actionLabel?: string;
  }): Promise<{ success: boolean }>;

  dismissTransferNotification(options: {
    transferId: string;
  }): Promise<{ success: boolean }>;

  getPendingAlertNotification(): Promise<{
    fromAddress?: string;
    type?: string;
  }>;

  clearPendingAlertNotification(): Promise<{ success: boolean }>;

  showIncomingCallNotification(options: {
    callId: string;
    fromAddress?: string;
    fromName?: string;
  }): Promise<{ success: boolean }>;

  dismissIncomingCallNotification(): Promise<{ success: boolean }>;

  /** Clear Group/DM alert notifications from the Android tray. */
  dismissChatAlertNotifications(): Promise<{ success: boolean }>;

  /** Cancel a single Group/DM alert by (tag, hashed id). */
  dismissChatAlertNotification(options: {
    alertId: number;
    alertTag?: string;
  }): Promise<{ success: boolean }>;

  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;

  requestIgnoreBatteryOptimizations(): Promise<{ success: boolean }>;

  openAppBatterySettings(): Promise<{ success: boolean }>;

  /**
   * The phone's own battery page where one exists (vivo / iQOO), else GO's
   * App info page. Older native builds reject (method missing).
   */
  openVendorBatterySettings(): Promise<{
    opened: VendorBatterySettingsPage | null;
  }>;

  /** Same radio probe as the tray: airplane / no Wi-Fi / no ethernet / no VPN. */
  getDeviceNetwork(): Promise<{ online: boolean }>;

  addListener(
    eventName: 'incomingCallAction',
    listenerFunc: (event: IncomingCallActionEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'deviceNetwork',
    listenerFunc: (event: { online: boolean }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'relayProfileChanged',
    listenerFunc: (event: { profile: RelayProfile }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'vendorFreezeDetected',
    listenerFunc: (event: VendorFreezeDetectedEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'alertNotificationAction',
    listenerFunc: (event: AlertNotificationActionEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Fired every 25 s by the foreground service. Android throttles WebView
   * timers in the background; this native tick keeps presence heartbeats
   * flowing while the app is backgrounded.
   */
  addListener(
    eventName: 'presenceTick',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
}

export const QortalBackground =
  registerPlugin<QortalBackgroundPlugin>('QortalBackground');
