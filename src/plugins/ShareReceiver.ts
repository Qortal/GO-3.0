import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isAndroidApp } from '../utils/androidApp';

/** A file shared into the app via an Android share-sheet entry. */
export type SharedMediaItem = {
  /** Absolute native path in the app cache (cacheDir/shared_media/…). */
  path: string;
  mimeType: string;
  name: string;
  size: number;
};

/**
 * Something shared into a group or a DM ("GO Groups", "GO DMs" or
 * "GO Self-DM" in the share sheet).
 */
export type PendingChatShare = {
  /**
   * The entry used: `chats:groups` / `chats:directs` (pick a chat in that
   * list) or `chats:self` (Saved Messages).
   */
  target: string;
  /** At most one: a chat message carries one file. */
  items: SharedMediaItem[];
  text?: string;
  subject?: string;
  /** Further files that were shared but not taken. */
  extraCount?: number;
  /** Files over `maxFileBytes`, not copied. */
  tooLargeCount?: number;
  unreadableCount?: number;
  maxFileBytes?: number;
};

/** A photo or video shared to "Torq Rev", for Torq's Rev editor. */
export type PendingRevShare = {
  /** Missing when nothing could be read (too large, or not media). */
  item?: SharedMediaItem;
  tooLarge?: boolean;
  maxFileBytes?: number;
};

export type ShareReceivedEvent = {
  pending: boolean;
  /** Missing from builds before chat shares (composer only). */
  kind?: 'composer' | 'chat' | 'rev';
};

interface ShareReceiverNativePlugin {
  getPendingShare(): Promise<{ items: SharedMediaItem[] }>;
  getPendingChatShare(): Promise<{ share: PendingChatShare | null }>;
  getPendingRevShare(): Promise<{ share: PendingRevShare | null }>;
  consumeSharedFile(options: { path: string }): Promise<void>;
  setShareTarget(options: { target: 'quitter' | 'torq' }): Promise<void>;
  addListener(
    eventName: 'shareReceived',
    listenerFunc: (event: ShareReceivedEvent) => void
  ): Promise<PluginListenerHandle>;
}

const ShareReceiverNative =
  registerPlugin<ShareReceiverNativePlugin>('ShareReceiver');

export const isShareReceiverAvailable = () => isAndroidApp();

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
  /** The waiting chat share, or null (also on builds without it). */
  getPendingChatShare: async (): Promise<PendingChatShare | null> => {
    if (!isShareReceiverAvailable()) return null;
    try {
      const res = await ShareReceiverNative.getPendingChatShare();
      const share = res?.share;
      if (!share || typeof share.target !== 'string') return null;
      return {
        ...share,
        items: Array.isArray(share.items) ? share.items : [],
      };
    } catch {
      return null;
    }
  },
  /** The waiting "Torq Rev" share, or null (also on builds without it). */
  getPendingRevShare: async (): Promise<PendingRevShare | null> => {
    if (!isShareReceiverAvailable()) return null;
    try {
      const res = await ShareReceiverNative.getPendingRevShare();
      return res?.share && typeof res.share === 'object' ? res.share : null;
    } catch {
      return null;
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
    listener: (event: ShareReceivedEvent) => void
  ): Promise<PluginListenerHandle | null> => {
    if (!isShareReceiverAvailable()) return null;
    return ShareReceiverNative.addListener('shareReceived', listener);
  },
};
