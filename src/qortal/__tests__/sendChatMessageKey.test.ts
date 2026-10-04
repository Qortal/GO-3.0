import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// Q-App SEND_CHAT_MESSAGE to a recipient encrypts the message to the public
// key the node returns. The key must derive the recipient address (GO-30).
// Same factories as the other get.ts tests (see ./common.ts), but with the
// real SHA-256 and utils, which the address check needs.

vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () => ({
  ...(await import('./common')).backgroundFactory(),
  ensureAltcoinKeyPair: vi.fn(),
  resolveRecipient: vi.fn(),
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
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

import Base58Untyped from '../../encryption/Base58';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import { PublicKeyMismatchError } from '../../encryption/addressKeyCheck';
import { sendChatMessage } from '../get';
import { isRunningGateway } from '../qortal-requests';
import {
  createEndpoint,
  getBalanceInfo,
  getKeyPair,
  performPowTask,
  signChatFunc,
} from '../../background/background';
import { createTransaction } from '../../transactions/transactions';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function account(fill: number) {
  const bytes = new Uint8Array(32).fill(fill);
  return {
    publicKey: Base58.encode(bytes) as string,
    address: String(publicKeyToAddress(bytes)),
  };
}

const alice = account(21);
const mallory = account(22);

function answerPrompts(accepted: boolean) {
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: event.data.requestId,
          result: { accepted },
        },
        origin: window.location.origin,
        source: window,
      })
    );
  };
  window.addEventListener('message', listener);
  onTestFinished(() => window.removeEventListener('message', listener));
}

/** The node answers /addresses/publickey/<address> with `key` as text. */
function stubPublicKey(key: string) {
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    headers: { get: () => 'text/plain; charset=UTF-8' },
    text: async () => key,
    json: async () => key,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const keyPairBytes = Base58.encode(new Uint8Array(32).fill(1)) as string;

beforeEach(() => {
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: keyPairBytes,
    publicKey: keyPairBytes,
  });
  vi.mocked(createTransaction).mockReturnValue({
    chatBytes: new Uint8Array(4),
  });
  vi.mocked(performPowTask).mockResolvedValue({
    nonce: 1,
    chatBytesArray: new Uint8Array(4),
  });
  vi.mocked(signChatFunc).mockResolvedValue({ signature: 'CHAT_SIG' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SEND_CHAT_MESSAGE to a recipient (GO-30)', () => {
  const request = {
    recipient: alice.address,
    message: 'hello',
  };

  it("encrypts to the recipient's own key", async () => {
    answerPrompts(true);
    const fetchMock = stubPublicKey(alice.publicKey);
    await expect(
      sendChatMessage(request, false, { name: 'TestApp' })
    ).resolves.toEqual({ signature: 'CHAT_SIG' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:12391/addresses/publickey/${alice.address}`
    );
    expect(createTransaction).toHaveBeenCalledWith(
      18,
      expect.anything(),
      expect.objectContaining({
        recipient: alice.address,
        recipientPublicKey: alice.publicKey,
      })
    );
  });

  it('refuses a key the node substituted before encrypting or sending', async () => {
    answerPrompts(true);
    stubPublicKey(mallory.publicKey);
    await expect(
      sendChatMessage(request, false, { name: 'TestApp' })
    ).rejects.toThrow(PublicKeyMismatchError);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(performPowTask).not.toHaveBeenCalled();
    expect(signChatFunc).not.toHaveBeenCalled();
  });
});
