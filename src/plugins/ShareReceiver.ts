import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

/** A photo/video shared into the app via the Android share target (Quitter or Torq). */
export type SharedMediaItem = {
  /** Absolute native path in the app cache (cacheDir/shared_media/…). */
  path: string;
  mimeType: string;
  name: string;
  size: number;
};

interface ShareReceiverNativePlugin {
  getPendingShare(): Promise<{ items: SharedMediaItem[] }>;
  consumeSharedFile(options: { path: string }): Promise<void>;
  setShareTarget(options: { target: 'quitter' | 'torq' }): Promise<void>;
  addListener(
    eventName: 'shareReceived',
    listenerFunc: (event: { pending: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

const ShareReceiverNative =
  registerPlugin<ShareReceiverNativePlugin>('ShareReceiver');

export const isShareReceiverAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const ShareReceiver = {
  /** Drain queued shared media (returns [] when nothing is pending). */
  getPendingShare: async (): Promise<SharedMediaItem[]> => {
    if (!isShareReceiverAvailable()) return [];
    try {
      const res = await ShareReceiverNative.getPendingShare();
      return Array.isArray(res?.items) ? res.items : [];
    } catch {
      return [];
    }
  },
  /** Delete the imported cache file once its bytes are in the WebView. */
  consumeSharedFile: async (path: string): Promise<void> => {
    if (!isShareReceiverAvailable()) return;
    try {
      await ShareReceiverNative.consumeSharedFile({ path });
    } catch {
      // best-effort cleanup
    }
  },
  /** Name the share-sheet entry after the app the composer posts to. */
  setShareTarget: async (target: 'quitter' | 'torq'): Promise<void> => {
    if (!isShareReceiverAvailable()) return;
    try {
      await ShareReceiverNative.setShareTarget({ target });
    } catch {
      // older native build: the entry stays as it is
    }
  },
  addShareListener: async (
    listener: () => void
  ): Promise<PluginListenerHandle | null> => {
    if (!isShareReceiverAvailable()) return null;
    return ShareReceiverNative.addListener('shareReceived', listener);
  },
};
