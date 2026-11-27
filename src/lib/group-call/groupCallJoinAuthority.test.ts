import { describe, expect, it } from 'vitest';
import {
  GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS,
  NEWCOMER_ROOT_CONTACT_GRACE_MS,
  OCCUPIED_HINT_PROVISIONAL_ROOT_MS,
  OCCUPIED_HINT_SELF_ELECTION_WAIT_MS,
  isSelfOnlyGroupRootElection,
  resolveProvisionalLocalRootMs,
  resolveSelfOnlyElectionWaitMs,
  sanitizeOccupiedRoomParticipantHint,
  shouldKeepProvisionalLocalRoot,
  shouldSuppressNewcomerStandbyFailover,
} from './groupCallJoinAuthority';

describe('group call join authority', () => {
  it('waits longer than the 1-3 s it takes Reticulum peers to appear', () => {
    expect(GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS).toBeGreaterThanOrEqual(
      3_000
    );
  });

  describe('sanitizeOccupiedRoomParticipantHint', () => {
    it('keeps positive counts and floors them', () => {
      expect(sanitizeOccupiedRoomParticipantHint(3)).toBe(3);
      expect(sanitizeOccupiedRoomParticipantHint(2.7)).toBe(2);
      expect(sanitizeOccupiedRoomParticipantHint('4')).toBe(4);
    });
    it('turns anything else into 0', () => {
      for (const value of [0, -1, NaN, Infinity, undefined, null, 'x', {}]) {
        expect(sanitizeOccupiedRoomParticipantHint(value)).toBe(0);
      }
    });
    it('caps absurd counts', () => {
      expect(sanitizeOccupiedRoomParticipantHint(10_000)).toBe(64);
    });
  });

  describe('isSelfOnlyGroupRootElection', () => {
    const base = {
      roomId: 'gcall-qortal-659',
      previousRoot: '',
      remoteParticipantCount: 0,
      hydratedRemoteCount: 0,
    };
    it('is true for a Qortal group call where we saw no one', () => {
      expect(isSelfOnlyGroupRootElection(base)).toBe(true);
    });
    it('is false once anyone else is known', () => {
      expect(
        isSelfOnlyGroupRootElection({ ...base, remoteParticipantCount: 1 })
      ).toBe(false);
      expect(
        isSelfOnlyGroupRootElection({ ...base, hydratedRemoteCount: 2 })
      ).toBe(false);
    });
    it('is false when a root was already in place', () => {
      expect(
        isSelfOnlyGroupRootElection({ ...base, previousRoot: 'Q-root' })
      ).toBe(false);
    });
    it('is false outside Qortal group calls', () => {
      expect(
        isSelfOnlyGroupRootElection({ ...base, roomId: 'dm-voice-abc' })
      ).toBe(false);
    });
  });

  describe('shouldKeepProvisionalLocalRoot', () => {
    it('keeps the window when we re-elect ourselves while provisional', () => {
      expect(
        shouldKeepProvisionalLocalRoot({
          myAddress: 'Q-me',
          previousRoot: 'Q-me',
          electedRoot: 'Q-me',
          provisionalActive: true,
        })
      ).toBe(true);
    });
    it('does not keep an expired or established root provisional', () => {
      expect(
        shouldKeepProvisionalLocalRoot({
          myAddress: 'Q-me',
          previousRoot: 'Q-me',
          electedRoot: 'Q-me',
          provisionalActive: false,
        })
      ).toBe(false);
    });
    it('does not apply when someone else becomes root', () => {
      expect(
        shouldKeepProvisionalLocalRoot({
          myAddress: 'Q-me',
          previousRoot: 'Q-me',
          electedRoot: 'Q-peer',
          provisionalActive: true,
        })
      ).toBe(false);
    });
  });

  describe('shouldSuppressNewcomerStandbyFailover', () => {
    const joinedAt = 1_000_000;
    const base = {
      hasRoomKey: false,
      lastVerifiedKeyAt: 0,
      lastDecodedMediaAt: 0,
      lastSpeakerActivityAt: 0,
      lastJoinSuccessAtMs: joinedAt,
      nowMs: joinedAt + 14_000,
    };
    it('suppresses a takeover by a newcomer that never reached the root', () => {
      expect(shouldSuppressNewcomerStandbyFailover(base)).toBe(true);
    });
    it('allows it once the grace after joining is over', () => {
      expect(
        shouldSuppressNewcomerStandbyFailover({
          ...base,
          nowMs: joinedAt + NEWCOMER_ROOT_CONTACT_GRACE_MS + 1,
        })
      ).toBe(false);
    });
    it('allows it when we hold the room key', () => {
      expect(
        shouldSuppressNewcomerStandbyFailover({ ...base, hasRoomKey: true })
      ).toBe(false);
    });
    it('allows it when the root was heard before (key, audio or speech)', () => {
      expect(
        shouldSuppressNewcomerStandbyFailover({
          ...base,
          lastVerifiedKeyAt: joinedAt + 1_000,
        })
      ).toBe(false);
      expect(
        shouldSuppressNewcomerStandbyFailover({
          ...base,
          lastDecodedMediaAt: joinedAt + 2_000,
        })
      ).toBe(false);
      expect(
        shouldSuppressNewcomerStandbyFailover({
          ...base,
          lastSpeakerActivityAt: joinedAt + 2_000,
        })
      ).toBe(false);
    });
    it('does nothing before a join succeeded', () => {
      expect(
        shouldSuppressNewcomerStandbyFailover({
          ...base,
          lastJoinSuccessAtMs: 0,
        })
      ).toBe(false);
    });
  });

  describe('resolveSelfOnlyElectionWaitMs', () => {
    it('waits long when the badge said the call was occupied (slow RNS paths: 38 s seen)', () => {
      expect(
        resolveSelfOnlyElectionWaitMs({
          occupiedRoomHint: true,
          occupiedRoomEvidence: true,
          failoverTimeoutMs: 11_500,
        })
      ).toBe(OCCUPIED_HINT_SELF_ELECTION_WAIT_MS);
      expect(OCCUPIED_HINT_SELF_ELECTION_WAIT_MS).toBeGreaterThanOrEqual(
        30_000
      );
    });
    it('keeps the failover window for other occupied-room evidence', () => {
      expect(
        resolveSelfOnlyElectionWaitMs({
          occupiedRoomHint: false,
          occupiedRoomEvidence: true,
          failoverTimeoutMs: 11_500,
        })
      ).toBe(11_500);
    });
    it('uses the short alone wait when nothing says the call is occupied', () => {
      expect(
        resolveSelfOnlyElectionWaitMs({
          occupiedRoomHint: false,
          occupiedRoomEvidence: false,
          failoverTimeoutMs: 11_500,
        })
      ).toBe(GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS);
    });
  });

  describe('resolveProvisionalLocalRootMs', () => {
    it('keeps a lonely self-election in an occupied call provisional for long', () => {
      expect(
        resolveProvisionalLocalRootMs({
          selfOnly: true,
          occupiedRoomHint: true,
          defaultMs: 12_500,
        })
      ).toBe(OCCUPIED_HINT_PROVISIONAL_ROOT_MS);
    });
    it('uses the default window otherwise', () => {
      for (const [selfOnly, occupiedRoomHint] of [
        [true, false],
        [false, true],
        [false, false],
      ] as const) {
        expect(
          resolveProvisionalLocalRootMs({
            selfOnly,
            occupiedRoomHint,
            defaultMs: 12_500,
          })
        ).toBe(12_500);
      }
    });
  });
});
