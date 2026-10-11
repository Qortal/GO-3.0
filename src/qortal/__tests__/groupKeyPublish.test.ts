import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Same factories as the other get.ts tests (see ./common.ts).

vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () => ({
  ...(await import('./common')).backgroundFactory(),
  ensureAltcoinKeyPair: vi.fn(),
}));
vi.mock('../../encryption/encryption', async () =>
  (await import('./common')).encryptionFactory()
);
vi.mock('../../components/Chat/AdminSpaceInner', async () =>
  (await import('./common')).adminSpaceFactory()
);
vi.mock('../../components/Chat/MessageDisplay', async () =>
  (await import('./common')).messageDisplayFactory()
);
vi.mock('../../components/Group/groupApi', async () =>
  (await import('./common')).groupApiFactory()
);
vi.mock('../../components/Group/groupDataPublishes', async () =>
  (await import('./common')).groupDataPublishesFactory()
);
vi.mock('../../components/Group/groupValidation', async () =>
  (await import('./common')).groupValidationFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('./common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('./common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('./common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('./common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('./common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('./common')).transactionsFactory()
);
vi.mock('../../utils/events', async () =>
  (await import('./common')).eventsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('./common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('./common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('./common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/Base58', async () =>
  (await import('./common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('./common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { fetchGroupKeyPublish } from '../get';

const URL =
  'https://ext-node.qortal.link/arbitrary/DOCUMENT_PRIVATE/admin/symmetric-qchat-group-7?encoding=base64&rebuild=true';
const KEY = 'cW9ydGFsR3JvdXBFbmNyeXB0ZWREYXRhN3r9I+hPoEf6u85Bx2XGXR4H';

const answer = (status: number, body: string) =>
  vi.fn(async () => new Response(body, { status }));

describe('fetchGroupKeyPublish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the key publish the node sends', async () => {
    vi.stubGlobal('fetch', answer(200, `${KEY}\n`));
    await expect(fetchGroupKeyPublish(URL)).resolves.toBe(KEY);
  });

  it('gives a clear error when a public node does not have the key (was the atob error)', async () => {
    vi.stubGlobal(
      'fetch',
      answer(
        404,
        '{"error":1401,"message":"Data unavailable. Please try again later."}'
      )
    );
    await expect(fetchGroupKeyPublish(URL)).rejects.toThrow(
      'question:message.error.group_key_unavailable'
    );
  });

  it('never hands a page or error text on as the key, even with a 200', async () => {
    vi.stubGlobal('fetch', answer(200, '<html><body>busy</body></html>'));
    await expect(fetchGroupKeyPublish(URL)).rejects.toThrow(
      'question:message.error.group_key_unavailable'
    );
    vi.stubGlobal('fetch', answer(200, ''));
    await expect(fetchGroupKeyPublish(URL)).rejects.toThrow(
      'question:message.error.group_key_unavailable'
    );
  });

  it('gives the same error when the node cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(fetchGroupKeyPublish(URL)).rejects.toThrow(
      'question:message.error.group_key_unavailable'
    );
  });
});
