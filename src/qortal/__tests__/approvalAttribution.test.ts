import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// GO-28: every Q-App approval names the app from GO's appInfo (sent next to
// the payload, never inside it), carries the requester's deadline, and
// value-moving requests need the "I have read this request" tick.

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Same factories as ./paymentRequests.test.ts.

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
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      const params = { ...(options || {}) };
      delete params.postProcess;
      return Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;
    },
  },
}));
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buyNameRequest,
  createSellOrder,
  deployAt,
  multiPaymentWithPrivateData,
  publishMultipleQDNResources,
  publishQDNResource,
  sellNameRequest,
  sendCoin,
  signForeignFees,
  signTransaction,
  transferAssetRequest,
} from '../get';
import { hasSessionPermission, isRunningGateway } from '../qortal-requests';
import {
  createEndpoint,
  getAssetBalanceInfo,
  getAssetInfo,
  getBalanceInfo,
  getFee,
  getKeyPair,
  getPublicKey,
  getSaveWallet,
  resolveRecipient,
  sendCoin as sendCoinFunc,
  sendQortFee,
  transferAsset,
} from '../../background/background';
import { getAllUserNames, getNameInfo } from '../../encryption/encryption';
import {
  encryptDataGroup,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { publishData } from '../../qdn/publish/publish';
import { isValidBase64WithDecode } from '../../utils/decode';

// ── Fixtures and helpers ─────────────────────────────────────────────────────

const ALICE = 'QAliceAddress000000000000000000001';
const FEE = '0.01000000';
const APP_INFO = { name: 'Q-Wallets', service: 'APP', tabId: 'tab-1' };

/** Answers every permission prompt and records the whole request message. */
function answerPrompts(accepted: boolean) {
  const messages: Record<string, any>[] = [];
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    messages.push(event.data);
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
  return messages;
}

function stubBalance(balance: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => balance,
      text: async () => String(balance),
      clone: () => ({
        json: async () => balance,
        text: async () => String(balance),
      }),
    }))
  );
}

beforeEach(() => {
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'QmyAddress' });
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: 'PRIV',
    publicKey: 'PUB',
  });
  vi.mocked(sendQortFee).mockResolvedValue(FEE as unknown as number);
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  vi.mocked(getAssetBalanceInfo).mockResolvedValue(100);
  vi.mocked(getAssetInfo).mockResolvedValue({ name: 'TESTASSET' });
  vi.mocked(resolveRecipient).mockImplementation(async (value: unknown) =>
    value === 'alice'
      ? { address: ALICE, name: 'Alice' }
      : { address: String(value), name: '' }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('approval attribution (GO-28)', () => {
  it('sends the asking app from appInfo next to the payload, with a deadline', async () => {
    stubBalance(100);
    const messages = answerPrompts(false);
    const before = Date.now();

    await expect(
      sendCoin(
        { coin: 'QORT', amount: '1', recipient: 'alice' },
        false,
        APP_INFO
      )
    ).rejects.toThrow();

    expect(messages).toHaveLength(1);
    // Name and service only: the tab id stays inside GO.
    expect(messages[0].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
    expect(messages[0].payload.appName).toBeUndefined();
    expect(messages[0].payload.sourceLabel).toBeUndefined();
    expect(messages[0].expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(messages[0].expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(sendCoinFunc).not.toHaveBeenCalled();
  });

  it("marks GO's own requests, and only when GO says so", async () => {
    stubBalance(100);
    const messages = answerPrompts(false);
    await expect(
      sendCoin({ coin: 'QORT', amount: '1', recipient: 'alice' }, false, {
        name: 'Qortal GO',
        service: null,
        internal: true,
      })
    ).rejects.toThrow();
    await expect(
      sendCoin({ coin: 'QORT', amount: '1', recipient: 'alice' }, false, {
        ...APP_INFO,
        internal: 'yes',
      })
    ).rejects.toThrow();
    expect(messages[0].appInfo).toEqual({
      name: 'Qortal GO',
      service: null,
      internal: true,
    });
    expect(messages[1].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
  });

  it('sends no app when the router did not say which app asked', async () => {
    stubBalance(100);
    const messages = answerPrompts(false);
    await expect(
      sendCoin({ coin: 'QORT', amount: '1', recipient: 'alice' }, false)
    ).rejects.toThrow();
    expect(messages[0].appInfo).toBeNull();
  });

  it('never takes the app from the Q-App request data', async () => {
    stubBalance(100);
    const messages = answerPrompts(false);
    await expect(
      sendCoin(
        {
          coin: 'QORT',
          amount: '1',
          recipient: 'alice',
          appName: 'Q-Wallets',
          sourceLabel: 'Q-Wallets',
          appInfo: { name: 'Q-Wallets', service: 'APP' },
        },
        false,
        { name: 'Evil-App', service: 'APP', tabId: 'tab-2' }
      )
    ).rejects.toThrow();
    expect(messages[0].appInfo).toEqual({ name: 'Evil-App', service: 'APP' });
    expect(messages[0].payload.appName).toBeUndefined();
    expect(messages[0].payload.sourceLabel).toBeUndefined();
  });
});

describe('value-moving approvals need the tick (GO-28)', () => {
  it('QORT SEND_COIN', async () => {
    stubBalance(100);
    const messages = answerPrompts(false);
    await expect(
      sendCoin(
        { coin: 'QORT', amount: '1', recipient: 'alice' },
        false,
        APP_INFO
      )
    ).rejects.toThrow();
    expect(messages[0].payload.confirmCheckbox).toBe(true);
  });

  it('foreign SEND_COIN, also with the node on this device', async () => {
    const messages = answerPrompts(false);
    await expect(
      sendCoin(
        { coin: 'ARRR', amount: '0.5', recipient: 'zs1recipient' },
        false,
        APP_INFO
      )
    ).rejects.toThrow('question:message.generic.user_declined_request');
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.confirmCheckbox).toBe(true);
    expect(messages[0].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
  });

  it('TRANSFER_ASSET', async () => {
    const messages = answerPrompts(false);
    await expect(
      transferAssetRequest(
        { amount: '2', assetId: '5', recipient: 'alice' },
        false,
        APP_INFO
      )
    ).rejects.toThrow();
    expect(messages[0].payload.confirmCheckbox).toBe(true);
    expect(messages[0].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
    expect(transferAsset).not.toHaveBeenCalled();
  });

  it('MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA', async () => {
    vi.mocked(getNameInfo).mockResolvedValue('myname');
    vi.mocked(isValidBase64WithDecode).mockReturnValue(true);
    vi.mocked(getPublicKey).mockResolvedValue('RECIPIENT_PUBLIC_KEY');
    vi.mocked(objectToBase64).mockResolvedValue('BASE64');
    vi.mocked(encryptDataGroup).mockReturnValue('ENCRYPTED');
    vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
    const messages = answerPrompts(false);
    await expect(
      multiPaymentWithPrivateData(
        {
          assetId: 0,
          payments: [
            {
              recipient: 'alice',
              amount: 1,
              arbitraryTxs: [
                {
                  service: 'DOCUMENT_PRIVATE',
                  identifier: 'a',
                  base64: 'QQ==',
                },
              ],
            },
          ],
        },
        false,
        APP_INFO
      )
    ).rejects.toThrow();
    expect(messages[0].payload.confirmCheckbox).toBe(true);
    expect(messages[0].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
    expect(transferAsset).not.toHaveBeenCalled();
  });
});

describe('signing and other value-moving approvals need the tick (GO-28)', () => {
  /** The single prompt shown, after the request was declined. */
  async function promptOf(run: () => Promise<unknown>) {
    const messages = answerPrompts(false);
    await expect(run()).rejects.toThrow();
    expect(messages).toHaveLength(1);
    expect(messages[0].appInfo).toEqual({ name: 'Q-Wallets', service: 'APP' });
    return messages[0].payload;
  }

  beforeEach(() => {
    vi.mocked(hasSessionPermission).mockReturnValue(false);
  });

  it('SIGN_TRANSACTION', async () => {
    stubBalance({ type: 'PAYMENT', amount: '1' });
    const payload = await promptOf(() =>
      signTransaction({ unsignedBytes: 'BYTES' }, false, APP_INFO)
    );
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('BUY_NAME', async () => {
    stubBalance({ isForSale: true, owner: ALICE, salePrice: '5' });
    const payload = await promptOf(() =>
      buyNameRequest({ nameForSale: 'goodname' }, false, APP_INFO)
    );
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('SELL_NAME (the Q-App sets the price)', async () => {
    stubBalance({ name: 'myname', isForSale: false });
    const payload = await promptOf(() =>
      sellNameRequest(
        { nameForSale: 'myname', salePrice: '0.00000001' },
        false,
        APP_INFO
      )
    );
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('DEPLOY_AT', async () => {
    const payload = await promptOf(() =>
      deployAt(
        {
          name: 'at',
          description: 'an AT',
          tags: 'x',
          creationBytes: 'BYTES',
          amount: 5,
          assetId: 0,
          type: 'x',
        },
        false,
        APP_INFO
      )
    );
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('CREATE_TRADE_SELL_ORDER for a coin other than ARRR', async () => {
    stubBalance(0);
    const payload = await promptOf(() =>
      createSellOrder(
        { qortAmount: 1, foreignBlockchain: 'LITECOIN', foreignAmount: 2 },
        false,
        APP_INFO
      )
    );
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('SIGN_FOREIGN_FEES', async () => {
    const payload = await promptOf(() => signForeignFees({}, APP_INFO, false));
    expect(payload.confirmCheckbox).toBe(true);
  });

  it('PUBLISH_QDN_RESOURCE with an app fee, and not without one', async () => {
    const data = {
      service: 'DOCUMENT',
      data64: 'QQ==',
      name: 'myname',
    };
    const withFee = await promptOf(() =>
      publishQDNResource(
        { ...data, appFee: 1, appFeeRecipient: ALICE },
        null,
        false,
        APP_INFO
      )
    );
    expect(withFee.confirmCheckbox).toBe(true);
    expect(withFee.checkbox1).toMatchObject({ value: true });

    const withoutFee = await promptOf(() =>
      publishQDNResource({ ...data }, null, false, APP_INFO)
    );
    expect(withoutFee).not.toHaveProperty('confirmCheckbox');
  });

  it('PUBLISH_MULTIPLE_QDN_RESOURCES with an app fee', async () => {
    vi.mocked(getNameInfo).mockResolvedValue('myname');
    vi.mocked(getAllUserNames).mockResolvedValue(['myname']);
    const payload = await promptOf(() =>
      publishMultipleQDNResources(
        {
          resources: [{ service: 'DOCUMENT', identifier: 'a', data64: 'QQ==' }],
          appFee: 1,
          appFeeRecipient: ALICE,
        },
        null,
        false,
        APP_INFO
      )
    );
    expect(payload.confirmCheckbox).toBe(true);
  });
});
