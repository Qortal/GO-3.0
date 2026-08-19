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

export interface QortalBackgroundPlugin {
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
    title?: string;
    body?: string;
    iconUrl?: string;
    fromAddress?: string;
    notificationType?: 'direct' | 'group' | 'general';
  }): Promise<{ success: boolean }>;

  showTransferNotification(options: {
    transferId: string;
    title?: string;
    text?: string;
    /** 0-100 for a determinate bar, -1 for indeterminate, -2 (default) for no bar. */
    progress?: number;
    ongoing?: boolean;
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

  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;

  requestIgnoreBatteryOptimizations(): Promise<{ success: boolean }>;

  openAppBatterySettings(): Promise<{ success: boolean }>;

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

export const QortalBackground = registerPlugin<QortalBackgroundPlugin>(
  'QortalBackground'
);
