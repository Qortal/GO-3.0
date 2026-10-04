import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Same factories as the other get.ts tests (see ./common.ts), plus
// resolveRecipient, and an i18n stub that keeps the parameters so the dialog
// text can be checked.

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
  multiPaymentWithPrivateData,
  payAppFeeAfterPublish,
  sendCoin,
  transferAssetRequest,
} from '../get';
import { isRunningGateway } from '../qortal-requests';
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
import { getNameInfo } from '../../encryption/encryption';
import {
  encryptDataGroup,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { publishData } from '../../qdn/publish/publish';
import { isValidBase64WithDecode } from '../../utils/decode';
import { executeEvent } from '../../utils/events';

// ── Fixtures and helpers ─────────────────────────────────────────────────────

const ALICE = 'QAliceAddress000000000000000000001';
const BOB = 'QBobAddress00000000000000000000002';
const FEE = '0.01000000';

/** Answers every permission prompt and records its payload. */
function answerPrompts(accepted: boolean) {
  const payloads: Record<string, any>[] = [];
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    payloads.push(event.data.payload);
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
  return payloads;
}

function stubBalance(balance: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => balance,
    text: async () => String(balance),
    clone: () => ({
      json: async () => balance,
      text: async () => String(balance),
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
      : value === 'bob'
        ? { address: BOB, name: 'Bob' }
        : { address: String(value), name: '' }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── SEND_COIN (QORT) ─────────────────────────────────────────────────────────

describe('SEND_COIN QORT (GO-19, GO-20)', () => {
  it('shows name, full address and the normalised amount, and pays that address with the shown fee', async () => {
    stubBalance(100);
    const payloads = answerPrompts(true);
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, data: { signature: 'SIG' } },
      validApi: null,
    });

    await expect(
      sendCoin({ coin: 'QORT', amount: '1.50', recipient: 'alice' }, false)
    ).resolves.toEqual({ signature: 'SIG' });

    expect(resolveRecipient).toHaveBeenCalledWith('alice');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].text2).toContain('Alice');
    expect(payloads[0].text2).toContain(ALICE);
    expect(payloads[0].highlightedText).toBe('1.5 QORT');
    expect(payloads[0].fee).toBe(FEE);
    expect(sendCoinFunc).toHaveBeenCalledWith(
      { amount: 1.5, password: null, receiver: ALICE, approvedFee: FEE },
      true
    );
  });

  it.each(['1e3', '0x10', 'Infinity', '-1', '1.123456789'])(
    'refuses the amount %j before asking',
    async (amount) => {
      stubBalance(100);
      const payloads = answerPrompts(true);
      await expect(
        sendCoin({ coin: 'QORT', amount, recipient: 'alice' }, false)
      ).rejects.toThrow('core:message.error.invalid_amount');
      expect(payloads).toHaveLength(0);
      expect(sendCoinFunc).not.toHaveBeenCalled();
    }
  );

  it('resolves the name before asking, so an unknown name never reaches a dialog', async () => {
    stubBalance(100);
    const payloads = answerPrompts(true);
    vi.mocked(resolveRecipient).mockRejectedValueOnce(
      new Error('name does not exist')
    );
    await expect(
      sendCoin({ coin: 'QORT', amount: 1, recipient: 'nobody' }, false)
    ).rejects.toThrow('name does not exist');
    expect(payloads).toHaveLength(0);
    expect(sendCoinFunc).not.toHaveBeenCalled();
  });
});

// ── SEND_COIN (foreign coins) ────────────────────────────────────────────────

describe('SEND_COIN foreign coins (GO-20)', () => {
  it.each(['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'ARRR'])(
    '%s refuses amounts that are not plain decimals before asking',
    async (coin) => {
      const payloads = answerPrompts(true);
      for (const amount of ['0x10', '1e3', 'Infinity', '-1', '1.123456789']) {
        await expect(
          sendCoin({ coin, amount, recipient: 'some-address' }, false)
        ).rejects.toThrow('core:message.error.invalid_amount');
      }
      expect(payloads).toHaveLength(0);
    }
  );

  it.each([0.0000001, '0.0000001', ' 0.00000010 '])(
    'shows %j ARRR as a plain decimal, not "1e-7"',
    async (amount) => {
      const payloads = answerPrompts(false);
      await expect(
        sendCoin({ coin: 'ARRR', amount, recipient: 'zs1recipient' }, false)
      ).rejects.toThrow('question:message.generic.user_declined_request');
      expect(payloads).toHaveLength(1);
      expect(payloads[0].highlightedText).toBe('0.0000001 ARRR');
    }
  );
});

// ── App fee after a publish ──────────────────────────────────────────────────

describe('payAppFeeAfterPublish', () => {
  const payment = { amount: 1, receiver: 'appdev', approvedFee: FEE };

  it('pays the approved fee and says nothing when it goes through', async () => {
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, data: {} },
      validApi: null,
    });
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(sendCoinFunc).toHaveBeenCalledWith(payment, true);
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('tells the user when the fee payment is refused, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    vi.mocked(sendCoinFunc).mockRejectedValue(new Error('fee above approved'));
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(executeEvent).toHaveBeenCalledWith(
      'openGlobalSnackBar',
      expect.objectContaining({
        type: 'error',
        message:
          'question:message.error.app_fee_not_sent {"error":"fee above approved"}',
      })
    );
  });
});

// ── TRANSFER_ASSET ───────────────────────────────────────────────────────────

describe('TRANSFER_ASSET (GO-19, GO-20)', () => {
  it('shows asset, recipient and the normalised amount, and transfers to that address with the shown fee', async () => {
    const payloads = answerPrompts(true);
    vi.mocked(transferAsset).mockResolvedValue({ signature: 'SIG' });

    await expect(
      transferAssetRequest(
        { amount: '2.50', assetId: '5', recipient: 'alice' },
        false
      )
    ).resolves.toEqual({ signature: 'SIG' });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].text2).toContain('TESTASSET');
    expect(payloads[0].text2).toContain('"id":"5"');
    expect(payloads[0].text3).toContain('Alice');
    expect(payloads[0].text3).toContain(ALICE);
    expect(payloads[0].highlightedText).toContain('"quantity":"2.5"');
    expect(transferAsset).toHaveBeenCalledWith({
      amount: 2.5,
      recipient: ALICE,
      assetId: 5,
      approvedFee: FEE,
    });
  });

  it.each([
    [{ amount: '0x10', assetId: 0, recipient: 'alice' }],
    [{ amount: '1e3', assetId: 0, recipient: 'alice' }],
    [{ amount: 1, assetId: 'abc', recipient: 'alice' }],
    [{ amount: 1, assetId: 1.5, recipient: 'alice' }],
    [{ amount: 1, assetId: -1, recipient: 'alice' }],
  ])('refuses %j before asking', async (data) => {
    const payloads = answerPrompts(true);
    await expect(transferAssetRequest(data, false)).rejects.toThrow();
    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });
});

// ── MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA ───────────────────────────────────

describe('MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA (N-24)', () => {
  const request = {
    assetId: 0,
    payments: [
      {
        recipient: 'alice',
        amount: 1,
        arbitraryTxs: [
          { service: 'DOCUMENT_PRIVATE', identifier: 'a', base64: 'QQ==' },
        ],
      },
      {
        recipient: 'bob',
        amount: '2.25',
        arbitraryTxs: [
          { service: 'DOCUMENT_PRIVATE', identifier: 'b', base64: 'Qg==' },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(getNameInfo).mockResolvedValue('myname');
    vi.mocked(isValidBase64WithDecode).mockReturnValue(true);
    vi.mocked(getPublicKey).mockResolvedValue('RECIPIENT_PUBLIC_KEY');
    vi.mocked(objectToBase64).mockResolvedValue('BASE64');
    vi.mocked(encryptDataGroup).mockReturnValue('ENCRYPTED');
    vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
  });

  it('shows each recipient as name and address with normalised amounts', async () => {
    const payloads = answerPrompts(true);
    vi.mocked(transferAsset)
      .mockResolvedValueOnce({ signature: 'PAY_1' })
      .mockResolvedValueOnce({ signature: 'PAY_2' });

    await expect(multiPaymentWithPrivateData(request, false)).resolves.toEqual([
      'PAY_1',
      'PUBLISH_SIG',
      'PAY_2',
      'PUBLISH_SIG',
    ]);

    const details = payloads[0].details;
    expect(details.payments).toHaveLength(2);
    expect(details.payments[0].recipientAddress).toContain('Alice');
    expect(details.payments[0].recipientAddress).toContain(ALICE);
    expect(details.payments[1].amount).toBe('2.25');
    expect(payloads[0].highlightedText).toContain('"amount":"3.25"');
    expect(transferAsset).toHaveBeenNthCalledWith(1, {
      amount: 1,
      assetId: 0,
      recipient: ALICE,
      approvedFee: FEE,
    });
    expect(transferAsset).toHaveBeenNthCalledWith(2, {
      amount: 2.25,
      assetId: 0,
      recipient: BOB,
      approvedFee: FEE,
    });
  });

  it('calls each transfer once, with no automatic re-signing, and reports a partial result', async () => {
    answerPrompts(true);
    vi.mocked(transferAsset)
      .mockResolvedValueOnce({ signature: 'PAY_1' })
      .mockRejectedValueOnce(new Error('node unreachable'));

    await expect(multiPaymentWithPrivateData(request, false)).rejects.toThrow(
      'question:message.error.payments_partially_sent {"sent":1,"total":2,"error":"node unreachable"}'
    );
    expect(transferAsset).toHaveBeenCalledTimes(2);
  });

  it('passes the first failure through when nothing was sent', async () => {
    answerPrompts(true);
    vi.mocked(transferAsset).mockRejectedValueOnce(new Error('NO_BALANCE'));

    await expect(multiPaymentWithPrivateData(request, false)).rejects.toThrow(
      'NO_BALANCE'
    );
    expect(transferAsset).toHaveBeenCalledTimes(1);
    expect(publishData).not.toHaveBeenCalled();
  });

  it('refuses a text asset id before asking', async () => {
    const payloads = answerPrompts(true);
    await expect(
      multiPaymentWithPrivateData({ ...request, assetId: 'abc' }, false)
    ).rejects.toThrow('question:message.error.invalid_asset_id');
    expect(payloads).toHaveLength(0);
  });
});
