import { useCallback, useEffect, useRef } from 'react';
import { returnChatShare, type ChatShareContent } from './chatShareInbox';

export type ChatShareChannelDeliveryOptions = {
  /** The chat has channels (the Reticulum group chat). */
  enabled: boolean;
  /** The group on screen. */
  groupKey: string;
  /** The channel on screen. */
  selectedChannelId: string;
  /** The channels the chat shows. */
  channelIds: readonly string[];
  /** Switches the chat to a channel (as a tap in its channel list does). */
  openChannel: (channelId: string) => void;
  /** Puts the share in the composer of the channel on screen. */
  insert: (content: ChatShareContent) => void | Promise<void>;
  /** The picked channel is not in the chat (gone since): it was handed back. */
  onChannelUnavailable?: () => void;
};

/**
 * For a group chat's useChatShareInbox: hands a share to the right channel.
 * A share whose channel was picked in the channel step (`channelId`, see
 * ChatShareChannelStep) opens that channel first and goes in once it is
 * the channel on screen; a file still being read when the channel switches
 * would be dropped. Without a picked channel it goes in at once. A picked
 * channel the chat does not have, or another chat opening before the
 * channel did, hands the share back to the lists (returnChatShare).
 */
export function useChatShareChannelDelivery(
  options: ChatShareChannelDeliveryOptions
): (content: ChatShareContent) => void | Promise<void> {
  const latest = useRef(options);
  latest.current = options;
  const waitingRef = useRef<{
    groupKey: string;
    channelId: string;
    content: ChatShareContent;
  } | null>(null);
  const { groupKey, selectedChannelId } = options;

  useEffect(() => {
    const waiting = waitingRef.current;
    if (!waiting) return;
    if (waiting.groupKey !== groupKey) {
      // Another chat opened first: the share waits in the lists again.
      waitingRef.current = null;
      returnChatShare(waiting.content);
      return;
    }
    if (waiting.channelId !== selectedChannelId) return;
    waitingRef.current = null;
    void latest.current.insert(waiting.content);
  }, [groupKey, selectedChannelId]);

  // The chat closed before the channel opened: back to the lists too.
  useEffect(
    () => () => {
      const waiting = waitingRef.current;
      if (!waiting) return;
      waitingRef.current = null;
      returnChatShare(waiting.content);
    },
    []
  );

  return useCallback((content: ChatShareContent) => {
    const current = latest.current;
    const channelId = current.enabled ? content.channelId : undefined;
    if (!channelId || channelId === current.selectedChannelId) {
      return current.insert(content);
    }
    if (!current.channelIds.includes(channelId)) {
      returnChatShare(content);
      current.onChannelUnavailable?.();
      return;
    }
    waitingRef.current = { groupKey: current.groupKey, channelId, content };
    current.openChannel(channelId);
  }, []);
}
