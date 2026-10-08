import { atomWithReset } from 'jotai/utils';
import type { PreparedChatShare } from './chatShareIntake';

/**
 * Something shared from another app ("GO Groups" / "GO DMs" in the share
 * sheet) that waits for the user to tap a chat in the Groups or DM list. The
 * phone Q-Chat header shows it in place of its buttons; Group.tsx hands it to
 * the chat tapped. Null when nothing waits.
 */
export const pendingChatShareAtom = atomWithReset<PreparedChatShare | null>(
  null
);

/** A share handed back by a chat (returnChatShare) carries all of this. */
export const isPreparedChatShare = (
  value: unknown
): value is PreparedChatShare => {
  const share = value as Partial<PreparedChatShare> | null;
  return (
    !!share &&
    typeof share.id === 'number' &&
    typeof share.scope === 'string' &&
    Array.isArray(share.items) &&
    typeof (share.files as Promise<File[]> | undefined)?.then === 'function'
  );
};
