import { describe, expect, it, vi } from 'vitest';

vi.mock('../../encryption/addressKeyCheck', () => ({
  publicKeyBelongsToAddress: (key: string, address: string) =>
    key === `pk-of-${address}`,
}));

import {
  dmFriendFromHistory,
  isOwnFriendAddDeleted,
  ownFriendRemovalPeer,
  restoreDmFriendFromHistory,
} from './dmFriendRestore';

const ME = 'QmeAddress000000000000000000000000';
const PEER = 'QpeerAddress0000000000000000000000';
const OTHER = 'QotherAddress000000000000000000000';

let seq = 0;
const friendAdd = (
  actor: string,
  target: string,
  timestamp: number,
  overrides: Record<string, unknown> = {}
) => ({
  eventId: `add-${++seq}`,
  senderAddress: actor,
  recipientAddress: actor === ME ? PEER : ME,
  senderPublicKey: `pk-of-${actor}`,
  eventType: 'message',
  timestamp,
  payload: JSON.stringify({
    messageText: `${actor} added ${target} as a friend.`,
    otherData: {
      type: 'dm_friend_added',
      dmFriendEvent: {
        actorAddress: actor,
        actorName: 'Actor',
        targetAddress: target,
        targetName: 'Peer Name',
        callsAvailable: false,
      },
    },
  }),
  ...overrides,
});

const deleteOf = (target: string, timestamp: number, sender = ME) => ({
  eventId: `del-${++seq}`,
  senderAddress: sender,
  recipientAddress: sender === ME ? PEER : ME,
  eventType: 'delete',
  targetEventId: target,
  timestamp,
  payload: '{}',
});

const peerText = (timestamp: number) => ({
  eventId: `msg-${++seq}`,
  senderAddress: PEER,
  recipientAddress: ME,
  senderPublicKey: `pk-of-${PEER}`,
  eventType: 'message',
  timestamp,
  payload: JSON.stringify({ messageText: 'hi' }),
});

describe('dmFriendFromHistory', () => {
  it('restores a friend from the account’s own add event', () => {
    const add = friendAdd(ME, PEER, 1000);
    const result = dmFriendFromHistory([add, peerText(2000)], ME, PEER);
    expect(result).toEqual({
      publicKey: `pk-of-${PEER}`,
      name: 'Peer Name',
      addedAt: 1000,
      eventId: add.eventId,
    });
  });

  it('ignores the peer’s own "added you" event', () => {
    expect(
      dmFriendFromHistory([friendAdd(PEER, ME, 1000)], ME, PEER)
    ).toBeNull();
  });

  it('ignores an add that names a different target or actor', () => {
    const wrongTarget = friendAdd(ME, OTHER, 1000);
    const forgedActor = friendAdd(ME, PEER, 1100);
    forgedActor.payload = forgedActor.payload.replace(
      `"actorAddress":"${ME}"`,
      `"actorAddress":"${OTHER}"`
    );
    expect(
      dmFriendFromHistory([wrongTarget, forgedActor], ME, PEER)
    ).toBeNull();
  });

  it('an add deleted later means not a friend', () => {
    const add = friendAdd(ME, PEER, 1000);
    expect(
      dmFriendFromHistory([add, deleteOf(add.eventId, 2000)], ME, PEER)
    ).toBeNull();
  });

  it('re-adding after a removal restores the friend', () => {
    const first = friendAdd(ME, PEER, 1000);
    const second = friendAdd(ME, PEER, 3000);
    const result = dmFriendFromHistory(
      [first, deleteOf(first.eventId, 2000), second],
      ME,
      PEER
    );
    expect(result?.eventId).toBe(second.eventId);
  });

  it('a removal of the newer of two adds wins over the older surviving add', () => {
    const older = friendAdd(ME, PEER, 1000);
    const newer = friendAdd(ME, PEER, 2000);
    expect(
      dmFriendFromHistory(
        [older, newer, deleteOf(newer.eventId, 3000)],
        ME,
        PEER
      )
    ).toBeNull();
  });

  it('a delete sent by the peer does not remove the friend', () => {
    const add = friendAdd(ME, PEER, 1000);
    expect(
      dmFriendFromHistory([add, deleteOf(add.eventId, 2000, PEER)], ME, PEER)
        ?.eventId
    ).toBe(add.eventId);
  });

  it('leaves publicKey empty when no peer event proves it', () => {
    const result = dmFriendFromHistory([friendAdd(ME, PEER, 1000)], ME, PEER);
    expect(result?.publicKey).toBe('');
  });

  it('does not take a peer key that does not belong to the peer', () => {
    const bad = peerText(2000);
    bad.senderPublicKey = 'not-the-peers-key';
    const result = dmFriendFromHistory(
      [friendAdd(ME, PEER, 1000), bad],
      ME,
      PEER
    );
    expect(result?.publicKey).toBe('');
  });

  it('handles junk input', () => {
    expect(dmFriendFromHistory([null, 3, 'x', {}], ME, PEER)).toBeNull();
    expect(dmFriendFromHistory([], ME, PEER)).toBeNull();
    expect(dmFriendFromHistory([friendAdd(ME, ME, 1)], ME, ME)).toBeNull();
    const broken = friendAdd(ME, PEER, 1000, { payload: '{not json' });
    expect(dmFriendFromHistory([broken], ME, PEER)).toBeNull();
  });
});

describe('restoreDmFriendFromHistory', () => {
  it('reads the DM history and returns the restored friend', async () => {
    const add = friendAdd(ME, PEER, 1000);
    const reader = vi.fn().mockResolvedValue([add]);
    const result = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: reader,
    });
    expect(reader).toHaveBeenCalledWith(ME, PEER, 1000);
    expect(result?.eventId).toBe(add.eventId);
  });

  it('looks the peer key up when the history does not prove it', async () => {
    const add = friendAdd(ME, PEER, 1000);
    const good = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: async () => [add],
      lookupPublicKey: async () => `pk-of-${PEER}`,
    });
    expect(good?.publicKey).toBe(`pk-of-${PEER}`);
    const wrong = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: async () => [add],
      lookupPublicKey: async () => 'someone-elses-key',
    });
    expect(wrong?.publicKey).toBe('');
    expect(wrong?.eventId).toBe(add.eventId);
    const failing = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: async () => [add],
      lookupPublicKey: () => Promise.reject(new Error('node down')),
    });
    expect(failing?.publicKey).toBe('');
  });

  it('does not look the key up when the history proves it', async () => {
    const lookup = vi.fn();
    const result = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: async () => [friendAdd(ME, PEER, 1000), peerText(2000)],
      lookupPublicKey: lookup,
    });
    expect(result?.publicKey).toBe(`pk-of-${PEER}`);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('finds an old own add that the newest-history window no longer holds', async () => {
    const add = friendAdd(ME, PEER, 1000);
    const recent = Array.from({ length: 5 }, (_, i) => peerText(10_000 + i));
    const result = await restoreDmFriendFromHistory(ME, PEER, {
      getDirectHistory: async () => recent,
      getOwnFriendEvents: async () => [add],
    });
    expect(result?.eventId).toBe(add.eventId);
    // The peer's key still comes from the recent history.
    expect(result?.publicKey).toBe(`pk-of-${PEER}`);
  });

  it('an old own add deleted later stays removed via the own-events reader', async () => {
    const add = friendAdd(ME, PEER, 1000);
    const removal = deleteOf(add.eventId, 2000);
    expect(
      await restoreDmFriendFromHistory(ME, PEER, {
        getDirectHistory: async () => [add],
        getOwnFriendEvents: async () => [add, removal],
      })
    ).toBeNull();
  });

  it('returns null when the history reader is missing, fails or hangs', async () => {
    expect(
      await restoreDmFriendFromHistory(ME, PEER, {
        getDirectHistory: null,
        getOwnFriendEvents: null,
      })
    ).toBeNull();
    expect(
      await restoreDmFriendFromHistory(ME, PEER, {
        getDirectHistory: () => Promise.reject(new Error('boom')),
      })
    ).toBeNull();
    expect(
      await restoreDmFriendFromHistory(ME, PEER, {
        getDirectHistory: () => new Promise(() => {}),
        timeoutMs: 10,
      })
    ).toBeNull();
  });
});

describe('friend removed on another device', () => {
  it('an own delete of the stored add removes that friend only', () => {
    const add = friendAdd(ME, PEER, 1000);
    const removal = deleteOf(add.eventId, 2000);
    expect(
      ownFriendRemovalPeer(removal, ME, { [PEER]: { eventId: add.eventId } })
    ).toBe(PEER);
    // A different add (made on this device) is not what was deleted.
    expect(
      ownFriendRemovalPeer(removal, ME, { [PEER]: { eventId: 'other' } })
    ).toBeNull();
    // The peer deleting something is not a removal by the account.
    expect(
      ownFriendRemovalPeer(deleteOf(add.eventId, 2000, PEER), ME, {
        [PEER]: { eventId: add.eventId },
      })
    ).toBeNull();
    expect(
      ownFriendRemovalPeer(add, ME, { [PEER]: { eventId: add.eventId } })
    ).toBeNull();
  });

  it('isOwnFriendAddDeleted reads the own friend events', async () => {
    const add = friendAdd(ME, PEER, 1000);
    expect(
      await isOwnFriendAddDeleted(ME, PEER, add.eventId, {
        getOwnFriendEvents: async () => [add, deleteOf(add.eventId, 2000)],
      })
    ).toBe(true);
    expect(
      await isOwnFriendAddDeleted(ME, PEER, add.eventId, {
        getOwnFriendEvents: async () => [add],
      })
    ).toBe(false);
    expect(
      await isOwnFriendAddDeleted(ME, PEER, add.eventId, {
        getOwnFriendEvents: null,
      })
    ).toBe(false);
  });
});
