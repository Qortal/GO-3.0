import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileReticulumBridge } from './wireBridge';

const PEER = 'b'.repeat(32);
const OTHER = 'c'.repeat(32);
const UNKNOWN = {
  ok: false,
  error: 'Unknown peer identity',
  payload: { code: 'unknown_peer_identity' },
};

type Reply = Record<string, any> | Error;

/**
 * Python's ensure_peer_identity answers from a script; every other command
 * is ok. `hold` keeps answers back until `release` (a check in flight).
 */
function makeBridge(script: Reply[]) {
  const calls: Array<{ action: string; payload: Record<string, any> }> = [];
  const held: Array<() => void> = [];
  let hold = false;
  const sendCommand = vi.fn(
    async (action: string, payload: Record<string, any>) => {
      calls.push({ action, payload });
      if (action !== 'ensure_peer_identity') return { ok: true };
      const reply = script.length > 1 ? script.shift()! : script[0];
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
      if (reply instanceof Error) throw reply;
      return reply as { ok: boolean };
    }
  );
  const bridge = new MobileReticulumBridge(sendCommand as any);
  bridge.markReady({});
  const checks = () =>
    calls.filter((c) => c.action === 'ensure_peer_identity').length;
  return {
    bridge,
    checks,
    hold: (on: boolean) => {
      hold = on;
    },
    release: () => {
      for (const resolve of held.splice(0)) resolve();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensurePeerIdentityKnown: unknown answers', () => {
  it('asks Python once for two checks of an unknown peer within 30 s', async () => {
    const { bridge, checks } = makeBridge([UNKNOWN]);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    vi.advanceTimersByTime(29_000);
    expect(await bridge.ensurePeerIdentityKnown(PEER.toUpperCase())).toBe(
      false
    );
    expect(checks()).toBe(1);
    // Another peer is asked about on its own.
    expect(await bridge.ensurePeerIdentityKnown(OTHER)).toBe(false);
    expect(checks()).toBe(2);
    // After 30 s Python is asked again.
    vi.advanceTimersByTime(1_001);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(checks()).toBe(3);
  });

  it('shares one question between checks that overlap', async () => {
    const { bridge, checks, hold, release } = makeBridge([UNKNOWN]);
    hold(true);
    const first = bridge.ensurePeerIdentityKnown(PEER);
    const second = bridge.ensurePeerIdentityKnown(PEER);
    release();
    hold(false);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(checks()).toBe(1);
  });

  it('keeps nothing for a timeout or a full queue', async () => {
    const { bridge, checks } = makeBridge([
      new Error('worker->native request timed out: ensure_peer_identity'),
      { ok: false, payload: { code: 'bridge_command_queue_full' } },
      UNKNOWN,
    ]);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(checks()).toBe(3);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(checks()).toBe(3);
  });

  it('still keeps a known answer for 10 minutes', async () => {
    const { bridge, checks } = makeBridge([{ ok: true }]);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(true);
    vi.advanceTimersByTime(9 * 60_000);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(true);
    expect(checks()).toBe(1);
  });
});

describe('ensurePeerIdentityKnown: forgetting an unknown answer', () => {
  it('asks again after the identity is registered', async () => {
    const { bridge, checks } = makeBridge([UNKNOWN, { ok: true }]);
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(false);
    expect(await bridge.registerPeerIdentityFromGroupJoin(PEER, 'a2V5')).toBe(
      true
    );
    expect(await bridge.ensurePeerIdentityKnown(PEER)).toBe(true);
    expect(checks()).toBe(2);
  });

  it('asks again after an identity_offer names the peer (hex or compact)', async () => {
    const { bridge, checks } = makeBridge([UNKNOWN]);
    const offer = (d: string) =>
      bridge.dispatchPythonEvent('reticulum_chat_message', {
        wire: {
          t: 'RCHAT',
          k: 'identity_offer',
          d,
          rk: 'a2V5',
          rid: 'f'.repeat(24),
        },
        peerPresenceHash: OTHER,
      });
    await bridge.ensurePeerIdentityKnown(PEER);
    offer(PEER);
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(2);
    // The compact form engines put on the wire: base64url of the 16 bytes.
    const compact = btoa(String.fromCharCode(...new Array(16).fill(0xbb)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    offer(compact);
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(3);
    // An offer for someone else leaves this answer alone.
    offer(OTHER);
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(3);
  });

  it('asks again once a link from the peer is admitted, and after a Python restart', async () => {
    const { bridge, checks } = makeBridge([UNKNOWN]);
    await bridge.ensurePeerIdentityKnown(PEER);
    bridge.dispatchPythonEvent('overlay_link_state', {
      linkId: 'l1',
      peerPresenceHash: PEER,
      established: true,
      overlayTransportAdmitted: true,
    });
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(2);
    bridge.markStopped();
    bridge.markReady({});
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(3);
  });

  it('does not keep an unknown answer that raced a register', async () => {
    const { bridge, checks, hold, release } = makeBridge([UNKNOWN]);
    hold(true);
    const racing = bridge.ensurePeerIdentityKnown(PEER);
    hold(false);
    // Registered while the check was out; its old "unknown" must not stick.
    await bridge.registerPeerIdentityFromGroupJoin(PEER, 'a2V5');
    release();
    expect(await racing).toBe(false);
    await bridge.ensurePeerIdentityKnown(PEER);
    expect(checks()).toBe(2);
  });
});
