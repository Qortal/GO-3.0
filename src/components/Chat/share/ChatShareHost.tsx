import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { parkQortinoAgentSheet } from '../../../qortinoAgent/qortinoSheetNav';
import { closeGoWindows } from '../../../utils/closeGoWindows';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import { CHAT_SHARE_RETURN_EVENT } from './chatShareInbox';
import {
  CHAT_SHARE_REQUEST_EVENT,
  takeChatShareRequest,
} from './chatShareIntake';
import { showChatShareNotices } from './chatShareNotices';
import { isPreparedChatShare, pendingChatShareAtom } from './chatShareState';

/**
 * Shares from other apps into chats, for the signed-in account. A share
 * goes up in Q-Chat (pendingChatShareAtom): Group.tsx opens the Groups or DM
 * list with it in the header, or Saved Messages with it for "GO Self-DM".
 * A chat that could not take its share hands it back here.
 */
export function ChatShareHost({ account }: { account: string }) {
  const setPendingShare = useSetAtom(pendingChatShareAtom);

  useEffect(() => {
    const take = () => {
      const request = takeChatShareRequest();
      if (!request) return;
      if (request.kind === 'nothing') {
        showChatShareNotices(request.notices, 'error');
        return;
      }
      // GO may have been left in another window (Tabs, Settings, a viewer):
      // those close, or Chat opens under them and the share is never seen.
      // Here, in the render before Group switches to Chat: a window from a
      // section that then hides (Home's Settings) would stay up until that
      // hidden section renders again, in idle time.
      closeGoWindows();
      parkQortinoAgentSheet();
      setPendingShare(request.share);
    };
    const onReturn = (event: Event) => {
      const share = (event as CustomEvent<{ share?: unknown }>).detail?.share;
      if (isPreparedChatShare(share)) setPendingShare(share);
    };
    take();
    subscribeToEvent(CHAT_SHARE_REQUEST_EVENT, take);
    subscribeToEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
    return () => {
      unsubscribeFromEvent(CHAT_SHARE_REQUEST_EVENT, take);
      unsubscribeFromEvent(CHAT_SHARE_RETURN_EVENT, onReturn);
    };
  }, [setPendingShare]);

  // A share waits for this account's chats only: switching accounts or
  // signing out drops it.
  useEffect(() => () => setPendingShare(null), [account, setPendingShare]);

  return null;
}
