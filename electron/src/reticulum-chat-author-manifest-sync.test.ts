import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReticulumChatSignedFields,
  hashReticulumChatPayload,
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumChatManagerOptions,
} from './reticulum-chat';
import {
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';
// The same allow-list the renderer applies in signReticulumChatEventCase for
// both the desktop Hub (setup.ts) and GO (mobile worker) signers.
import { assertAllowedReticulumSigningPayload } from '../../src/background/reticulum-signing-policy';

const GROUP_ID = 72;
const PROVIDER_HASH = 'a'.repeat(32);
const REQUESTER_HASH = 'b'.repeat(32);
const STREAM_ID = 'f'.repeat(32);

// Managers use the real clock: the request is signed with the requester's
// clock and checked against the provider's, like two devices on the network.
const managers: ReticulumChatManager[] = [];
const tempPaths: string[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-manifest-sync-'));
  tempPaths.push(root);
  return path.join(root, 'reticulum-chat.db');
}

function track(manager: ReticulumChatManager): ReticulumChatManager {
  managers.push(manager);
  return manager;
}

/** Signs exactly like signReticulumChatEventCase, policy check included. */
function createPolicyCheckedSigner(): NonNullable<
  ReticulumChatManagerOptions['signLocalFields']
> {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  return async (fields) => {
    assertAllowedReticulumSigningPayload(fields);
    const signature = nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning({ ...fields, authorAddress, authorPublicKey })
      ),
      kp.secretKey
    );
    return {
      authorAddress,
      authorPublicKey,
      signature: base58Encode(signature),
    };
  };
}

function signedAuthorEvents(count: number): ReticulumChatEvent[] {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(publicKey);
  const baseTimestamp = Date.now() - 10_000;
  return Array.from({ length: count }, (_, index) => {
    const event: ReticulumChatEvent = {
      eventId: `manifest-sync-event-${index + 1}`,
      groupId: GROUP_ID,
      channelId: 'general',
      authorAddress,
      authorPublicKey: publicKey,
      authorStreamId: STREAM_ID,
      authorSeq: index + 1,
      timestamp: baseTimestamp + index,
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
  });
}

type Captured = Array<Record<string, any>>;

function createRequester(
  bridgeOverrides: Record<string, unknown> = {},
  signLocalFields = createPolicyCheckedSigner()
) {
  const sessions: Captured = [];
  const accepts: Captured = [];
  const manager = track(
    new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => REQUESTER_HASH,
        // The bridge already holds the provider's identity, so
        // ensureResourcePeerIdentity answers '' rather than a key.
        ensurePeerIdentityKnown: async () => true,
        ensureReticulumResourceSessionDetailed: async (
          payload: Record<string, any>
        ) => {
          sessions.push(payload);
          return { ok: true as const };
        },
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          accepts.push(payload);
          return { ok: true as const };
        },
        ...bridgeOverrides,
      } as any,
      signLocalFields,
      validateGroupMember: async () => true,
    })
  );
  manager.setLocalGroupMemberships([GROUP_ID]);
  manager.subscribeGroup(GROUP_ID);
  return { manager, sessions, accepts };
}

function createProvider() {
  const registered: Captured = [];
  const authorized: Captured = [];
  const rejected: Captured = [];
  const manager = track(
    new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => PROVIDER_HASH,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          registered.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          authorized.push(payload);
          return { ok: true as const };
        },
        rejectReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          rejected.push(payload);
          return { ok: true as const };
        },
      } as any,
      validateGroupMember: async () => true,
    })
  );
  manager.setLocalGroupMemberships([GROUP_ID]);
  return { manager, registered, authorized, rejected };
}

async function startManifestSync(
  requester: ReticulumChatManager,
  remoteRoot: string
): Promise<string> {
  const localSnapshot = await (requester as any).ensureAuthorTreeSnapshot(
    GROUP_ID
  );
  expect(localSnapshot).toBeTruthy();
  (requester as any).enqueueAuthorManifestSync(
    PROVIDER_HASH,
    GROUP_ID,
    remoteRoot,
    localSnapshot
  );
  return `${GROUP_ID}:${remoteRoot}`;
}

describe('author manifest sync with a peer the bridge already knows', () => {
  it('requests, serves and applies a manifest end to end', async () => {
    const provider = createProvider();
    const events = signedAuthorEvents(3);
    for (const event of events) {
      expect((provider.manager as any).db.insertEvent(event, true)).toBe(true);
    }
    const providerSnapshot = await (
      provider.manager as any
    ).ensureAuthorTreeSnapshot(GROUP_ID);
    expect(providerSnapshot?.count).toBe(1);

    const requester = createRequester();
    const failSpy = vi.spyOn(
      requester.manager as any,
      'failAuthorManifestSync'
    );
    await startManifestSync(requester.manager, providerSnapshot.root);
    await vi.waitUntil(() => requester.accepts.length === 1, {
      timeout: 2_000,
    });

    expect(failSpy).not.toHaveBeenCalled();
    expect(requester.sessions).toEqual([
      expect.objectContaining({
        peerPresenceHash: PROVIDER_HASH,
        reticulumIdentityPublicKeyBase64: '',
        logicalResourceType: 'reticulum_chat_author_manifest',
      }),
    ]);
    const accept = requester.accepts[0];
    expect(accept).toEqual(
      expect.objectContaining({
        peerPresenceHash: PROVIDER_HASH,
        reticulumIdentityPublicKeyBase64: '',
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_author_manifest',
          groupId: GROUP_ID,
          root: providerSnapshot.root,
        }),
        authMessage: expect.objectContaining({
          type: 'RETICULUM_CHAT_AUTHOR_MANIFEST_REQUEST',
          groupId: GROUP_ID,
          root: providerSnapshot.root,
          requesterPeerHash: REQUESTER_HASH,
          providerPeerHash: PROVIDER_HASH,
        }),
      })
    );

    // The provider receives the auth message over its resource session.
    await (provider.manager as any).authorizeResource({
      status: 'auth',
      linkId: 'author-manifest-link',
      transferId: accept.transferId,
      peerPresenceHash: REQUESTER_HASH,
      auth: accept.authMessage,
    });
    expect(provider.rejected).toEqual([]);
    expect(provider.authorized).toEqual([
      { linkId: 'author-manifest-link', transferId: accept.transferId },
    ]);
    expect(provider.registered).toHaveLength(1);
    expect(provider.registered[0]).toEqual(
      expect.objectContaining({
        allowedRecipientAddress: REQUESTER_HASH,
        transferId: accept.transferId,
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_author_manifest',
        }),
      })
    );

    // Hand the served bytes back to the requester as the bridge would.
    const receivedPath = path.join(
      path.dirname(tempDbPath()),
      'received-manifest.gz'
    );
    fs.copyFileSync(String(provider.registered[0].filePath), receivedPath);
    requester.manager.handleResourceEvent({
      status: 'received',
      transferId: accept.transferId,
      path: receivedPath,
      resourceType: 'reticulum_chat_event',
      metadata: { logicalResourceType: 'reticulum_chat_author_manifest' },
    } as any);
    await vi.waitUntil(
      () =>
        (requester.manager as any).db.getMissingRange(
          GROUP_ID,
          events[0].authorAddress,
          STREAM_ID,
          1,
          3
        ) != null,
      { timeout: 2_000 }
    );
    expect(failSpy).not.toHaveBeenCalled();
    expect(
      (requester.manager as any).db.getMissingRange(
        GROUP_ID,
        events[0].authorAddress,
        STREAM_ID,
        1,
        3
      )
    ).toMatchObject({ preferredPeer: PROVIDER_HASH });
  });

  it('still pauses on a real identity lookup failure', async () => {
    const requester = createRequester({
      ensurePeerIdentityKnown: async () => false,
    });
    vi.spyOn(
      requester.manager as any,
      'requestReticulumPeerIdentity'
    ).mockResolvedValue(null);
    const failSpy = vi.spyOn(
      requester.manager as any,
      'failAuthorManifestSync'
    );
    const sessionKey = await startManifestSync(
      requester.manager,
      'c'.repeat(64)
    );
    await vi.waitUntil(() => failSpy.mock.calls.length > 0, {
      timeout: 2_000,
    });

    expect(failSpy).toHaveBeenCalledWith(sessionKey, 'identity_unavailable');
    expect(requester.sessions).toEqual([]);
    expect(requester.accepts).toEqual([]);
  });

  it('stays harmless when an older provider refuses the request', async () => {
    const requester = createRequester();
    const sessionKey = await startManifestSync(
      requester.manager,
      'd'.repeat(64)
    );
    await vi.waitUntil(() => requester.accepts.length === 1, {
      timeout: 2_000,
    });
    const transferId = requester.accepts[0].transferId;

    requester.manager.handleResourceEvent({
      status: 'failed',
      transferId,
      reason: 'resource_request_rejected',
      resourceType: 'reticulum_chat_event',
      metadata: { logicalResourceType: 'reticulum_chat_author_manifest' },
    } as any);

    const session = (requester.manager as any).authorManifestSyncs.get(
      sessionKey
    );
    expect(session).toMatchObject({ status: 'backoff', rounds: 1 });
    expect(session.transferId).toBeUndefined();
    expect(
      (requester.manager as any).authorManifestTransfers.has(transferId)
    ).toBe(false);
    expect(
      (requester.manager as any).activeAuthorManifestSyncByGroup.has(GROUP_ID)
    ).toBe(false);
  });

  it('signs the manifest request through the shared signing policy', () => {
    expect(() =>
      assertAllowedReticulumSigningPayload({
        transferId: '0123456789abcdef',
        groupId: GROUP_ID,
        root: 'a'.repeat(64),
        baseRoot: 'b'.repeat(64),
        requesterPeerHash: REQUESTER_HASH,
        providerPeerHash: PROVIDER_HASH,
        timestamp: 100_000,
        type: 'RCHAT_AUTHOR_MANIFEST_REQUEST',
      })
    ).not.toThrow();
  });
});
