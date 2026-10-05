import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReticulumChatHistoryPageRequestSignedFields,
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  RETICULUM_CHAT_HISTORY_SERVE_QUEUE_TTL_MS,
  RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS,
  type ReticulumChatEvent,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

const GROUP_ID = 69;
const BRIDGE_SOURCES = [
  path.resolve(__dirname, '../resources/presence_bridge.py'),
  path.resolve(
    __dirname,
    '../../android/app/src/main/python/presence_bridge.py'
  ),
];

const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-history-serve-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function signedEvent(timestamp: number): ReticulumChatEvent {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const event: ReticulumChatEvent = {
    eventId: 'history-serve-ttl-event',
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: deriveAddressFromPublicKey(publicKey),
    authorPublicKey: publicKey,
    authorStreamId: 'f'.repeat(32),
    authorSeq: 1,
    timestamp,
    eventType: 'message',
    encryptedPayload: 'ciphertext',
    payloadHash: hashReticulumChatPayload('ciphertext'),
    mentionAddressHashes: [],
    signature: '',
  };
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event))
      ),
      kp.secretKey
    )
  );
  return event;
}

function signedHistoryPageAuth(
  transferId: string,
  cursor: { id: string; ts: number },
  timestamp: number
): Record<string, unknown> {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumChatHistoryPageRequestSignedFields({
    groupId: GROUP_ID,
    channelId: '*',
    direction: 'before',
    before: cursor,
    includeCursor: true,
    limit: 100,
    authorAddress,
    authorPublicKey,
    timestamp,
  });
  return {
    type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
    transferId,
    groupId: GROUP_ID,
    c: '*',
    d: 'before',
    before: cursor,
    inc: 1,
    limit: 100,
    a: authorAddress,
    pk: authorPublicKey,
    ts: timestamp,
    sig: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

describe('history page serve queue', () => {
  it('never keeps a queued page longer than the bundled bridges wait for authorization', () => {
    for (const source of BRIDGE_SOURCES) {
      const match = fs
        .readFileSync(source, 'utf8')
        .match(
          /^_RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS\s*=\s*([0-9.]+)/m
        );
      expect(match, source).not.toBeNull();
      const bridgeWindowMs = Number(match![1]) * 1_000;
      expect(RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS, source).toBe(
        bridgeWindowMs
      );
      expect(RETICULUM_CHAT_HISTORY_SERVE_QUEUE_TTL_MS).toBeLessThanOrEqual(
        bridgeWindowMs
      );
    }
  });

  it('sheds a queued page once the bridge authorization window has passed', async () => {
    const start = Date.now();
    let now = start;
    let resolveMembership: ((value: boolean) => void) | undefined;
    const membership = new Promise<boolean>((resolve) => {
      resolveMembership = resolve;
    });
    const registered: Array<Record<string, unknown>> = [];
    const authorized: Array<Record<string, unknown>> = [];
    const rejected: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          registered.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          authorized.push(payload);
          return { ok: true as const };
        },
        rejectReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          rejected.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      validateGroupMember: async () => membership,
    });
    managers.push(manager);
    const event = signedEvent(start - 20_000);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const cursor = { id: event.eventId, ts: event.timestamp };

    // Four providers stay busy on a slow membership check; the fifth waits.
    for (let index = 0; index < 5; index += 1) {
      const transferId = `history-serve-ttl-${index}`;
      manager.handleResourceEvent({
        status: 'auth',
        linkId: `link-${index}`,
        transferId,
        peerPresenceHash: String(index + 1).repeat(32),
        auth: signedHistoryPageAuth(transferId, cursor, start),
      } as any);
    }
    await vi.waitUntil(() => (manager as any).historyPageServeActive === 4, {
      timeout: 1_000,
    });
    expect((manager as any).historyPageServeQueue).toHaveLength(1);

    // Still inside the window: the page keeps its place.
    now = start + RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS;
    (manager as any).processHistoryPageServeQueue();
    expect((manager as any).historyPageServeQueue).toHaveLength(1);
    expect(rejected).toEqual([]);

    // Past it, the bridge has already dropped the waiter, so building the
    // page would only end in unknown_resource_request.
    now = start + RETICULUM_CHAT_PROVIDER_AUTH_WINDOW_MS + 1;
    (manager as any).processHistoryPageServeQueue();
    expect((manager as any).historyPageServeQueue).toHaveLength(0);
    await vi.waitUntil(() => rejected.length === 1, { timeout: 1_000 });
    expect(rejected).toEqual([
      {
        linkId: 'link-4',
        transferId: 'history-serve-ttl-4',
        reason: 'history_provider_busy',
      },
    ]);

    resolveMembership?.(true);
    await vi.waitUntil(() => authorized.length === 4, { timeout: 1_000 });
    await vi.waitUntil(() => (manager as any).historyPageServeActive === 0, {
      timeout: 1_000,
    });
    expect(registered.map((item) => item.transferId)).not.toContain(
      'history-serve-ttl-4'
    );
    expect(authorized.map((item) => item.transferId)).not.toContain(
      'history-serve-ttl-4'
    );
  });
});
