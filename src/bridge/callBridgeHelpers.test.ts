import { describe, expect, it } from 'vitest';
import {
  encodeJoinIdentityWire as hubEncodeJoinIdentityWire,
  encodeJoinWire as hubEncodeJoinWire,
} from '../../electron/src/group-call-wire-reticulum';
import { getRouteBoundDestinationHash as hubRouteBoundDestination } from '../../electron/src/reticulum-route-bound-id';
import { createRouteBoundId } from '../lib/reticulum/routeBoundId';
import {
  buildCallRejectSignatures,
  buildGacPongPayload,
  buildGroupCallJoinWires,
  classifyAudioLinkPayload,
  dmAudioLinkOpenDelayMs,
  encodeGcLinkControlFrame,
  getRouteBoundCallDestinationHash,
  isLinkAuthAcceptedEvidence,
  parseGroupCallJoinArgs,
  prunePendingIncoming,
  resolveSignedJoinGeneration,
} from './callBridgeHelpers';

const DEST = '0123456789abcdef0123456789abcdef';
const RK = btoa(
  String.fromCharCode(...Array.from({ length: 64 }, (_, i) => 200 - i))
);

describe('route-bound call ids', () => {
  it('reads the destination the caller bound into its call id, like the Hub', () => {
    const id = createRouteBoundId('call', DEST)!;
    expect(getRouteBoundCallDestinationHash(id)).toBe(DEST);
    expect(getRouteBoundCallDestinationHash(id)).toBe(
      hubRouteBoundDestination('call', id)
    );
  });

  it('returns null for ordinary and presence ids', () => {
    expect(getRouteBoundCallDestinationHash(crypto.randomUUID())).toBeNull();
    expect(
      getRouteBoundCallDestinationHash(createRouteBoundId('presence', DEST))
    ).toBeNull();
    expect(getRouteBoundCallDestinationHash('C' + '!'.repeat(35))).toBeNull();
    expect(getRouteBoundCallDestinationHash(undefined)).toBeNull();
  });
});

describe('CALL_REJECT pair', () => {
  it('sends the reason-signed CX first, then the legacy one (call.ts:1603-1620)', () => {
    expect(
      buildCallRejectSignatures({
        reason: 'rejected',
        signature: 'legacy',
        reasonSignature: 'with-reason',
      })
    ).toEqual([
      { reason: 'rejected', signature: 'with-reason' },
      { signature: 'legacy' },
    ]);
  });

  it('sends only the legacy CX when there is no reason signature', () => {
    expect(
      buildCallRejectSignatures({ reason: 'busy', signature: 'legacy' })
    ).toEqual([{ signature: 'legacy' }]);
    expect(buildCallRejectSignatures({})).toEqual([{ signature: '' }]);
  });
});

describe('pending incoming requests', () => {
  const item = (callId: string, receivedAt: number) => ({
    env: { callId },
    senderHash: '',
    receivedAt,
  });

  it('drops expired and duplicate requests and keeps the newest', () => {
    const now = 1_000_000;
    const kept = prunePendingIncoming(
      [
        item('old', now - 61_000),
        item('a', now - 5_000),
        item('b', now - 4_000),
        item('a', now - 1_000),
      ],
      now
    );
    expect(kept.map((p) => [p.env.callId, p.receivedAt])).toEqual([
      ['b', now - 4_000],
      ['a', now - 1_000],
    ]);
  });

  it('is bounded', () => {
    const now = 5_000;
    const list = Array.from({ length: 40 }, (_, i) => item(`c${i}`, now));
    const kept = prunePendingIncoming(list, now, 60_000, 16);
    expect(kept).toHaveLength(16);
    expect(kept[15].env.callId).toBe('c39');
  });
});

describe('group-call join arguments (group-call-ipc-contract.ts)', () => {
  it('reads the DM join exactly as joinDirectVoiceReticulumRoom passes it', () => {
    const args = parseGroupCallJoinArgs([
      'dmv:0123456789abcdef01',
      'direct:Qa:Qb',
      'Qa',
      'join-sig',
      'pk',
      1234,
      DEST.toUpperCase(),
      undefined,
      0,
      RK,
      'rk-sig',
      'waiter',
      undefined,
      'B'.repeat(32),
      'call-id',
    ]);
    expect(args).toEqual({
      roomId: 'dmv:0123456789abcdef01',
      chatId: 'direct:Qa:Qb',
      localAddress: 'Qa',
      signature: 'join-sig',
      publicKey: 'pk',
      timestamp: 1234,
      reticulumDestinationHash: DEST,
      joinGeneration: undefined,
      topologyEpochFloor: 0,
      reticulumIdentityPublicKeyBase64: RK,
      joinRkSignature: 'rk-sig',
      dmVoiceAudioLinkRole: 'waiter',
      takeover: false,
      dmVoicePeerDestinationHash: 'b'.repeat(32),
      dmVoiceCallId: 'call-id',
    });
  });

  it('reads the group runtime join (generation at 8, takeover at 13)', () => {
    const args = parseGroupCallJoinArgs([
      'gcall-qortal-7',
      'group-7',
      'Qa',
      'sig',
      'pk',
      1,
      DEST,
      123456,
      0,
      undefined,
      undefined,
      undefined,
      true,
    ]);
    expect(args.joinGeneration).toBe(123456);
    expect(args.takeover).toBe(true);
    expect(args.dmVoiceAudioLinkRole).toBeUndefined();
    expect(resolveSignedJoinGeneration(args.joinGeneration, true)).toBe(
      -1 - 123456
    );
  });

  it('keeps an already signed takeover generation as it is', () => {
    expect(resolveSignedJoinGeneration(-5, false)).toBe(-5);
    expect(resolveSignedJoinGeneration(7, false)).toBe(7);
    expect(resolveSignedJoinGeneration(undefined, true)).toBeUndefined();
  });
});

describe('join wires', () => {
  const base = {
    roomId: 'dmv:0123456789abcdef01',
    wireChatId: 'd:0123456789abcdef01',
    fromAddress: 'QhAddressXXXXXXXXXXXXXXXXXXXXXXXXX',
    fromPublicKey: 'B'.repeat(44),
    signature: 'S'.repeat(88),
    timestamp: 1_760_000_000_000,
    reticulumDestinationHash: DEST,
  };

  it('match the Hub GroupCallManager.joinRoom frames byte for byte', () => {
    const { joinWire, identityWire } = buildGroupCallJoinWires({
      ...base,
      reticulumIdentityPublicKeyBase64: RK,
      joinRkSignature: 'R'.repeat(88),
    });
    expect(joinWire).not.toHaveProperty('rk');
    expect(JSON.stringify(joinWire)).toBe(
      JSON.stringify(
        hubEncodeJoinWire({
          roomId: base.roomId,
          chatId: base.wireChatId,
          fromAddress: base.fromAddress,
          fromPublicKey: base.fromPublicKey,
          signature: base.signature,
          timestamp: base.timestamp,
          reticulumDestinationHash: DEST,
          reticulumIdentityPublicKeyBase64: undefined,
        })
      )
    );
    expect(JSON.stringify(identityWire)).toBe(
      JSON.stringify(
        hubEncodeJoinIdentityWire({
          fromAddress: base.fromAddress,
          signature: 'R'.repeat(88),
          timestamp: base.timestamp,
          reticulumDestinationHash: DEST,
          reticulumIdentityPublicKeyBase64: RK,
        })
      )
    );
  });

  it('carries the signed group generation in both frames', () => {
    const { joinWire, identityWire } = buildGroupCallJoinWires({
      ...base,
      roomId: 'gcall-qortal-7',
      wireChatId: 'group-7',
      signedJoinGeneration: -42,
      reticulumIdentityPublicKeyBase64: RK,
      joinRkSignature: 'R'.repeat(88),
    });
    expect(joinWire.j).toBe(-42);
    expect(identityWire?.j).toBe(-42);
  });

  it('sends no GI without an identity key or its signature', () => {
    expect(buildGroupCallJoinWires(base).identityWire).toBeNull();
    expect(
      buildGroupCallJoinWires({
        ...base,
        reticulumIdentityPublicKeyBase64: RK,
      }).identityWire
    ).toBeNull();
  });
});

describe('DM audio link roles', () => {
  it('opener opens at once, waiter after the 4 s grace (group-call.ts:372)', () => {
    expect(
      dmAudioLinkOpenDelayMs({ role: 'opener', joinedAtMs: 0, nowMs: 0 })
    ).toBe(0);
    expect(
      dmAudioLinkOpenDelayMs({
        role: 'waiter',
        joinedAtMs: 1_000,
        nowMs: 2_000,
      })
    ).toBe(3_000);
    expect(
      dmAudioLinkOpenDelayMs({
        role: 'waiter',
        joinedAtMs: 1_000,
        nowMs: 9_000,
      })
    ).toBe(0);
  });

  it('without a role the lexicographically smaller address owns the link', () => {
    const now = { joinedAtMs: 0, nowMs: 0 };
    expect(
      dmAudioLinkOpenDelayMs({ ...now, localAddress: 'QA', peerAddress: 'QB' })
    ).toBe(0);
    expect(
      dmAudioLinkOpenDelayMs({ ...now, localAddress: 'QB', peerAddress: 'QA' })
    ).toBeNull();
    expect(dmAudioLinkOpenDelayMs(now)).toBeNull();
  });
});

describe('audio-link payloads', () => {
  it('routes link control to the control path and never to audio', () => {
    const gk = classifyAudioLinkPayload(
      encodeGcLinkControlFrame({ t: 'GK', R: 'dmv:x' })
    );
    expect(gk).toEqual({ kind: 'control', wire: { t: 'GK', R: 'dmv:x' } });
    expect(isLinkAuthAcceptedEvidence(gk)).toBe(true);

    for (const t of ['GO0', 'GO1']) {
      const frame = classifyAudioLinkPayload(
        encodeGcLinkControlFrame({ t, R: 'dmv:x', z: 'a'.repeat(64), n: 1 })
      );
      expect(frame.kind).toBe('control');
      expect(isLinkAuthAcceptedEvidence(frame)).toBe(false);
    }
    for (const t of ['GX', 'GO', 'GE', 'GE0', 'GE1', 'GF', 'ZZ']) {
      expect(
        classifyAudioLinkPayload(encodeGcLinkControlFrame({ t })).kind
      ).toBe('drop');
    }
    const broken = new Uint8Array([
      ...encodeGcLinkControlFrame({}).subarray(0, 8),
      0x7b,
      0x7b,
    ]);
    expect(classifyAudioLinkPayload(broken)).toEqual({
      kind: 'drop',
      reason: 'control-not-json',
    });
  });

  it('treats everything else as media, even if it happens to start with {', () => {
    const media = new Uint8Array(64).map((_, i) => (i * 37) & 0xff);
    expect(classifyAudioLinkPayload(media)).toEqual({ kind: 'media' });
    media[0] = 0x7b;
    expect(classifyAudioLinkPayload(media)).toEqual({ kind: 'media' });
    expect(isLinkAuthAcceptedEvidence({ kind: 'media' })).toBe(true);
    // Bare JSON with a group-call type (older GO peers) is still control.
    const bare = new TextEncoder().encode(JSON.stringify({ t: 'GQ' }));
    expect(classifyAudioLinkPayload(bare).kind).toBe('control');
  });
});

describe('GAC heartbeat', () => {
  it('answers a PING with a PONG on the same link and sequence', () => {
    expect(
      buildGacPongPayload(
        { t: 'GAC', R: 'dmv:x', c: 'PING', m: 1, p: 9 },
        'link-1',
        DEST
      )
    ).toEqual({
      roomId: 'dmv:x',
      command: 'PONG',
      linkId: 'link-1',
      seq: 9,
      peerPresenceHash: DEST,
    });
  });

  it('ignores PONGs, frames without a room or link, and bad sequences', () => {
    expect(
      buildGacPongPayload({ t: 'GAC', R: 'dmv:x', c: 'PONG' }, 'l', DEST)
    ).toBeNull();
    expect(buildGacPongPayload({ t: 'GAC', c: 'PING' }, 'l', DEST)).toBeNull();
    expect(
      buildGacPongPayload({ t: 'GAC', R: 'r', c: 'PING' }, undefined, DEST)
    ).toBeNull();
    expect(
      buildGacPongPayload({ t: 'GAC', R: 'r', c: 'PING', p: -1 }, 'l', '')
    ).toEqual({ roomId: 'r', command: 'PONG', linkId: 'l' });
  });
});
