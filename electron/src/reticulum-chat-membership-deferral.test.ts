import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ReticulumChatManager,
  type ReticulumChatMobileProfile,
} from './reticulum-chat';

// GO (mobileProfile.keepMembershipDeferredPulls): events that only wait on a
// Core membership answer keep their pull. Before, they went through the
// per-peer cap of 64 and a 100-event page from one peer lost 36 of them.

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function makeManager(mobileProfile?: ReticulumChatMobileProfile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-member-defer-'));
  tempPaths.push(root);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
    } as any,
    validateGroupMember: async () => null,
    mobileProfile,
  });
  managers.push(manager);
  const m = manager as any;
  // Only the queue contents matter here; nothing is pulled.
  vi.spyOn(m, 'scheduleEventPullQueue').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return m;
}

const peer = (n: number) => n.toString(16).padStart(32, '0');

function fakeEvent(groupId: number, i: number) {
  return {
    eventId: `ev-${groupId}-${i}`,
    groupId,
    channelId: 'general',
    authorAddress: `QAuthor${i % 7}`,
    authorStreamId: '',
    authorSeq: i + 1,
    timestamp: Date.now() - 60_000 + i,
    eventType: 'message',
    payloadHash: 'h'.repeat(64),
    mentionAddressHashes: [],
  } as any;
}

function hint(groupId: number, i: number) {
  return {
    eventId: `hint-${groupId}-${i}`,
    groupId,
    channelId: '*',
    authorAddress: '',
    authorSeq: 0,
    timestamp: Date.now(),
    eventType: 'message',
    payloadHash: '',
    mentionAddressHashes: [],
  };
}

const queuedFrom = (m: any, peerHash: string) =>
  [...m.pendingEventPulls.values()].filter((item: any) =>
    item.peerHashes.has(peerHash)
  ).length;

describe('membership-deferred events and the pull queue', () => {
  it('keeps all 100 deferred events of one peer (upstream: 64 kept, 36 lost)', () => {
    const go = makeManager({ keepMembershipDeferredPulls: true });
    const legacy = makeManager();
    for (let i = 0; i < 100; i += 1) {
      go.deferEventForMembershipValidation(fakeEvent(42, i), peer(1), '');
      legacy.deferEventForMembershipValidation(fakeEvent(42, i), peer(1), '');
    }
    expect(queuedFrom(go, peer(1))).toBe(100);
    expect(queuedFrom(legacy, peer(1))).toBe(64);
    for (const item of go.pendingEventPulls.values()) {
      expect(item.membershipDeferrals).toBe(1);
      expect(item.nextAttemptAt).toBeGreaterThan(Date.now());
    }
    expect(go.getDeliveryCounters()).toMatchObject({ membershipDeferred: 100 });
    expect(go.getDeliveryCounters().membershipDeferredDropped).toBeUndefined();
    expect(legacy.getDeliveryCounters().membershipDeferred).toBeUndefined();
  });

  it("deferred events do not use up the peer's cap for hints", () => {
    const go = makeManager({ keepMembershipDeferredPulls: true });
    for (let i = 0; i < 100; i += 1) {
      go.deferEventForMembershipValidation(fakeEvent(42, i), peer(1), '');
    }
    for (let i = 0; i < 70; i += 1) {
      go.enqueueEventPull(peer(1), hint(42, i));
    }
    // 100 deferred + the hint cap of 64.
    expect(queuedFrom(go, peer(1))).toBe(164);
  });

  it('at the global cap hint pulls are evicted before deferred events', () => {
    const go = makeManager({ keepMembershipDeferredPulls: true });
    // 448 hints from 7 peers (64 each), then 100 deferred events.
    for (let p = 0; p < 7; p += 1) {
      for (let i = 0; i < 64; i += 1) {
        go.enqueueEventPull(peer(100 + p), hint(50 + p, i));
      }
    }
    expect(go.pendingEventPulls.size).toBe(448);
    for (let i = 0; i < 100; i += 1) {
      go.deferEventForMembershipValidation(fakeEvent(42, i), peer(1), '');
    }
    expect(go.pendingEventPulls.size).toBe(500);
    expect(queuedFrom(go, peer(1))).toBe(100);
    // The 48 oldest hints made room.
    expect(go.pendingEventPulls.has('50:hint-50-0')).toBe(false);
    expect(go.pendingEventPulls.has('50:hint-50-47')).toBe(false);
    expect(go.pendingEventPulls.has('50:hint-50-48')).toBe(true);

    // Deferred events past the cap still evict the oldest item when only
    // deferred events are left to evict.
    const onlyDeferred = makeManager({ keepMembershipDeferredPulls: true });
    for (let i = 0; i < 520; i += 1) {
      onlyDeferred.deferEventForMembershipValidation(
        fakeEvent(43, i),
        peer(2),
        ''
      );
    }
    expect(onlyDeferred.pendingEventPulls.size).toBe(500);
    expect(onlyDeferred.pendingEventPulls.has('43:ev-43-0')).toBe(false);
    expect(onlyDeferred.pendingEventPulls.has('43:ev-43-519')).toBe(true);
    expect(onlyDeferred.getDeliveryCounters().membershipDeferredEvicted).toBe(
      20
    );
  });

  it('a Core answer for the group wakes every kept deferred event', async () => {
    let answer: boolean | null = null;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-member-defer-'));
    tempPaths.push(root);
    const manager = new ReticulumChatManager({
      dbPath: path.join(root, 'reticulum-chat.db'),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
      validateGroupMember: async () => answer,
      mobileProfile: { keepMembershipDeferredPulls: true },
    });
    managers.push(manager);
    const m = manager as any;
    vi.spyOn(m, 'scheduleEventPullQueue').mockImplementation(() => undefined);
    for (let i = 0; i < 100; i += 1) {
      m.deferEventForMembershipValidation(fakeEvent(44, i), peer(3), '');
    }
    answer = true;
    await m.getCoreValidatedGroupMembership(44, 'QAuthor1');
    const woke = [...m.pendingEventPulls.values()].filter(
      (item: any) => item.nextAttemptAt <= Date.now()
    ).length;
    expect(woke).toBe(100);
  });
});
