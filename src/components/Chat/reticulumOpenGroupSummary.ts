import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import {
  reticulumChatSummariesAtom,
  type ReticulumChatSummaryAtomEntry,
} from '../../atoms/global';

/**
 * The open group's summary for ChatGroup. ChatGroup used to read the whole
 * summaries atom, so every refresh (about twice a second while a phone
 * catches up) re-rendered the open chat even when only another group changed.
 * It only reads the per-channel badge fields below, so it re-renders only
 * when one of those changes for its own group.
 */

const channelBadgeFieldsEqual = (
  left: ReticulumChatSummaryAtomEntry | undefined,
  right: ReticulumChatSummaryAtomEntry | undefined
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.channelId === right.channelId &&
    left.unreadCount === right.unreadCount &&
    left.mentionCount === right.mentionCount &&
    left.replyCount === right.replyCount &&
    left.hasUnreadMention === right.hasUnreadMention &&
    left.updatedAt === right.updatedAt &&
    left.lastEvent?.timestamp === right.lastEvent?.timestamp
  );
};

/**
 * Equal when every channel has the same badge fields (unread, mention and
 * reply counts, mention flag, and the timestamps the read marker uses).
 */
export const reticulumOpenGroupSummaryEqual = (
  left: ReticulumChatSummaryAtomEntry | undefined,
  right: ReticulumChatSummaryAtomEntry | undefined
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftChannels = Array.isArray(left.channels) ? left.channels : [];
  const rightChannels = Array.isArray(right.channels) ? right.channels : [];
  if (leftChannels.length !== rightChannels.length) return false;
  for (let index = 0; index < leftChannels.length; index += 1) {
    if (!channelBadgeFieldsEqual(leftChannels[index], rightChannels[index])) {
      return false;
    }
  }
  return true;
};

const openGroupSummaryKey = (selectedGroup: unknown): string => {
  const groupId = Number(selectedGroup);
  return Number.isInteger(groupId) && groupId > 0 ? String(groupId) : '';
};

export const useReticulumOpenGroupSummary = (
  selectedGroup: unknown
): ReticulumChatSummaryAtomEntry | undefined => {
  const groupKey = openGroupSummaryKey(selectedGroup);
  const summaryAtom = useMemo(
    () =>
      selectAtom(
        reticulumChatSummariesAtom,
        (summaries): ReticulumChatSummaryAtomEntry | undefined =>
          groupKey ? summaries?.[groupKey] : undefined,
        reticulumOpenGroupSummaryEqual
      ),
    [groupKey]
  );
  return useAtomValue(summaryAtom);
};
