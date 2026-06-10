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
  }): Promise<{ success: boolean }>;

  updatePersistentStatus(options: {
    title?: string;
    detail?: string;
    nodeLabel?: string;
    syncLabel?: string;
    peersLabel?: string;
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

  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;

  requestIgnoreBatteryOptimizations(): Promise<{ success: boolean }>;

  openAppBatterySettings(): Promise<{ success: boolean }>;

  addListener(
    eventName: 'incomingCallAction',
    listenerFunc: (event: IncomingCallActionEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'alertNotificationAction',
    listenerFunc: (event: AlertNotificationActionEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const QortalBackground = registerPlugin<QortalBackgroundPlugin>(
  'QortalBackground'
);
