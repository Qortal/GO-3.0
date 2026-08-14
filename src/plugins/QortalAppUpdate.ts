import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type AppUpdateDownloadProgress = {
  /** Bytes written so far. */
  bytes: number;
  /** -1 when the node does not report a content length. */
  percent: number;
  /** 0 when unknown. */
  total: number;
};

export interface QortalAppUpdatePlugin {
  addListener(
    eventName: 'downloadProgress',
    listener: (progress: AppUpdateDownloadProgress) => void
  ): Promise<PluginListenerHandle>;
  canInstall(): Promise<{ allowed: boolean }>;
  cancel(): Promise<void>;
  download(options: {
    filename: string;
    url: string;
  }): Promise<{ bytes: number; path: string }>;
  install(options: { path: string }): Promise<void>;
  requestInstallPermission(): Promise<void>;
}

export const QortalAppUpdate =
  registerPlugin<QortalAppUpdatePlugin>('QortalAppUpdate');
