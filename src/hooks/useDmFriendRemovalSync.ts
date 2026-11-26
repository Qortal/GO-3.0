/**
 * GO: friends are stored per device. When the account removes a friend on
 * another device it publishes a signed delete of its "added as a friend"
 * event; once that delete syncs here, drop the local entry that came from
 * that very add (lib/dm/dmFriendRestore ownFriendRemovalPeer). Mount once.
 */
import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { dmFriendsByAddressAtom, userInfoAtom } from '../atoms/global';
import { ownFriendRemovalPeer } from '../lib/dm/dmFriendRestore';
import { isCapacitor } from '../utils/platform';

export function useDmFriendRemovalSync(): void {
  const myAddress = useAtomValue(userInfoAtom)?.address?.trim() ?? '';
  const friends = useAtomValue(dmFriendsByAddressAtom);
  const setFriends = useSetAtom(dmFriendsByAddressAtom);
  const friendsRef = useRef(friends);
  friendsRef.current = friends;

  useEffect(() => {
    if (!myAddress || !isCapacitor()) return undefined;
    const off = window.reticulumChat?.onDirectEvent?.(({ event }) => {
      const peer = ownFriendRemovalPeer(event, myAddress, friendsRef.current);
      if (!peer) return;
      const target = String(
        (event as { targetEventId?: unknown })?.targetEventId || ''
      );
      setFriends((prev) => {
        if (!prev[peer] || prev[peer].eventId !== target) return prev;
        const next = { ...prev };
        delete next[peer];
        return next;
      });
    });
    return () => off?.();
  }, [myAddress, setFriends]);
}
