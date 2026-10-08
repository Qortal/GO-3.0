import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReticulumChatManager } from './reticulum-chat';

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function makeManager() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-pull-queue-'));
  tempPaths.push(root);
  const manager = new ReticulumChatManager({
    dbPath: path.join(root, 'reticulum-chat.db'),
    bridge: {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
    } as any,
  });
  managers.push(manager);
  return manager;
}

const peer = (n: number) => String(n).padStart(32, '0');

function queuePull(
  manager: ReticulumChatManager,
  groupId: number,
  eventId: string,
  peerHash: string
) {
  (manager as any).pendingEventPulls.set(`${groupId}:${eventId}`, {
    hint: {
      eventId,
      groupId,
      channelId: '*',
      authorAddress: '',
      authorSeq: 0,
      timestamp: Date.now(),
      eventType: 'message',
      payloadHash: '',
      mentionAddressHashes: [],
    },
    peerHashes: new Set([peerHash]),
    digestFingerprint: '',
    attempts: 0,
    nextAttemptAt: 0,
    inFlight: false,
  });
}

/** Starts that never finish unless released; records who was asked. */
function holdStarts(manager: ReticulumChatManager) {
  const started: Array<{ peer: string; eventId: string }> = [];
  const releases = new Map<string, () => void>();
  vi.spyOn(manager as any, 'requestEventPull').mockImplementation(
    (peerKey: unknown, item: unknown) => {
      started.push({
        peer: String(peerKey),
        eventId: (item as { hint: { eventId: string } }).hint.eventId,
      });
      return new Promise<void>((resolve) => {
        releases.set(
          (item as { hint: { eventId: string } }).hint.eventId,
          resolve
        );
      });
    }
  );
  return { started, releases };
}

const runPass = async (manager: ReticulumChatManager) => {
  await (manager as any).processEventPullQueue();
  await Promise.resolve();
};

describe('event pull queue', () => {
  it('keeps starting pulls from other peers while one peer hangs', async () => {
    const manager = makeManager();
    const { started } = holdStarts(manager);
    queuePull(manager, 70, 'from-gone-peer', peer(1));
    queuePull(manager, 70, 'from-live-peer', peer(2));

    // Before, the pass awaited the first start (up to the 30 s path wait)
    // and the second pull waited behind it.
    await runPass(manager);
    expect(started.map((s) => s.eventId)).toEqual([
      'from-gone-peer',
      'from-live-peer',
    ]);
  });

  it('starts pulls for the open chat first', async () => {
    const manager = makeManager();
    const { started } = holdStarts(manager);
    queuePull(manager, 80, 'background-1', peer(1));
    queuePull(manager, 80, 'background-2', peer(2));
    queuePull(manager, 80, 'background-3', peer(3));
    queuePull(manager, 81, 'open-chat', peer(4));
    (manager as any).activeChannelSubscriptions.set(81, new Set(['general']));

    await runPass(manager);
    expect(started.map((s) => s.eventId)).toEqual([
      'open-chat',
      'background-1',
      'background-2',
    ]);
  });

  it('runs one start per peer at a time', async () => {
    const manager = makeManager();
    const { started, releases } = holdStarts(manager);
    queuePull(manager, 90, 'first', peer(1));
    queuePull(manager, 90, 'second', peer(1));

    await runPass(manager);
    await runPass(manager);
    expect(started.map((s) => s.eventId)).toEqual(['first']);

    releases.get('first')?.();
    await Promise.resolve();
    await Promise.resolve();
    await runPass(manager);
    expect(started.map((s) => s.eventId)).toEqual(['first', 'second']);
  });

  it('still starts the open chat while slow background starts fill the cap', async () => {
    const manager = makeManager();
    const { started } = holdStarts(manager);
    for (let i = 1; i <= 5; i += 1) queuePull(manager, 96, `bg${i}`, peer(i));
    await runPass(manager);
    await runPass(manager);
    expect(started).toHaveLength(4);

    queuePull(manager, 97, 'open-chat', peer(9));
    (manager as any).activeChannelSubscriptions.set(97, new Set(['general']));
    await runPass(manager);
    expect(started.map((s) => s.eventId)).toContain('open-chat');
    // Background pulls still wait for a free slot.
    expect(started.map((s) => s.eventId)).not.toContain('bg5');
  });

  it('caps the starts in progress across all peers', async () => {
    const manager = makeManager();
    const { started } = holdStarts(manager);
    for (let i = 1; i <= 7; i += 1) queuePull(manager, 95, `e${i}`, peer(i));

    await runPass(manager); // 3 per pass
    await runPass(manager); // one more reaches the cap of 4
    await runPass(manager);
    expect(started).toHaveLength(4);
    expect(new Set(started.map((s) => s.peer)).size).toBe(4);
  });
});
