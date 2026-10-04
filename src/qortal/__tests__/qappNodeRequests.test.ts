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
// ensureAltcoinKeyPair, which the wallet reads use.

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

import {
  createSellOrder,
  getArrrSyncStatus,
  getCrossChainServerInfo,
  getForeignFee,
  getListItems,
  getServerConnectionHistory,
  getTxActivitySummary,
  getUserWallet,
  getUserWalletInfo,
  getUserWalletTransactions,
  getWalletBalance,
  sendCoin,
  setCurrentForeignServer,
  startCrossChainServer,
  updateForeignFee,
} from '../get';
import {
  getPermission,
  hasSessionPermission,
  isRunningGateway,
} from '../qortal-requests';
import {
  createEndpoint,
  ensureAltcoinKeyPair,
  getKeyPair,
  getSaveWallet,
} from '../../background/background';
import { joinNodeEndpoint } from '../../utils/nodeEndpointPath';
import { clearAllForeignKeyConsent } from '../foreignKeySessionConsent';

// ── Fixtures and helpers ─────────────────────────────────────────────────────

const SEED = 'ARRR_SEED_58';
const APP = { tabId: 'tab-1', name: 'Q-Wallets' };
const KEY_PAIR = {
  publicKey: 'QORT_PUB',
  arrrSeed58: SEED,
  ltcAddress: 'LTC_ADDR',
  ltcPublicKey: 'LTC_XPUB',
};

let nodeBase = 'http://127.0.0.1:12391';

function useNode(base: string) {
  nodeBase = base;
}

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

/** A node that answers every request, recording URL and body. */
function stubNode(
  respond: (url: string) => unknown = (url) =>
    url.includes('/syncstatus') ? 'Synchronized' : '0'
) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const body = respond(url);
    return {
      ok: true,
      json: async () => body,
      text: async () => String(body),
      clone: () => ({
        json: async () => body,
        text: async () => String(body),
      }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urlsOf = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.map(([url]) => String(url));

const seedRequests = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.filter(([, init]) =>
    String(init?.body ?? '').includes(SEED)
  );

beforeEach(() => {
  // Run as the Android app, where a node on 127.0.0.1 gets the key warning.
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
  };
  useNode('http://127.0.0.1:12391');
  clearAllForeignKeyConsent();
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(getPermission).mockResolvedValue(undefined);
  vi.mocked(hasSessionPermission).mockReturnValue(false);
  vi.mocked(createEndpoint).mockImplementation(async (path: string) =>
    joinNodeEndpoint(nodeBase, path)
  );
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'QmyAddress' });
  vi.mocked(getKeyPair).mockResolvedValue(KEY_PAIR);
  vi.mocked(ensureAltcoinKeyPair).mockResolvedValue(KEY_PAIR);
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── GO-07: Q-App strings in node paths ──────────────────────────────────────

describe('Q-App values in node paths', () => {
  it.each([
    [{ coin: '../admin/apikey/generate?x=', type: 'feekb' }],
    [{ coin: 'ltc', type: '../../admin/apikey/generate' }],
    [{ coin: 'ltc', type: '../tradebot' }],
    [{ coin: 'ltc', type: '%2e%2e/tradebot' }],
  ])('GET_FOREIGN_FEE refuses %j without contacting the node', async (data) => {
    const fetchMock = stubNode();
    await expect(getForeignFee(data)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_FOREIGN_FEE still reads the fee for a supported coin', async () => {
    const fetchMock = stubNode(() => 1000);
    await expect(getForeignFee({ coin: 'LTC', type: 'feekb' })).resolves.toBe(
      1000
    );
    expect(urlsOf(fetchMock)).toEqual([
      'http://127.0.0.1:12391/crosschain/ltc/feekb',
    ]);
  });

  it('UPDATE_FOREIGN_FEE refuses a bad type before asking the user', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);
    await expect(
      updateForeignFee(
        { coin: 'LTC', type: '../../admin/stop', value: 1 },
        false,
        APP
      )
    ).rejects.toThrow('question:message.error.invalid_type');
    expect(payloads).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('UPDATE_FOREIGN_FEE posts to the matching update endpoint', async () => {
    const fetchMock = stubNode(() => 1200);
    answerPrompts(true);
    await updateForeignFee(
      { coin: 'doge', type: 'feerequired', value: 1200 },
      false,
      APP
    );
    expect(urlsOf(fetchMock)).toEqual([
      'http://127.0.0.1:12391/crosschain/doge/updatefeerequired',
    ]);
  });

  it.each([
    ['GET_CROSSCHAIN_SERVER_INFO', () => getCrossChainServerInfo],
    ['GET_SERVER_CONNECTION_HISTORY', () => getServerConnectionHistory],
  ])('%s refuses an unknown coin', async (_action, handler) => {
    const fetchMock = stubNode();
    await expect(
      handler()({ coin: 'tradebot/../../admin/apikey' })
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('START_CROSSCHAIN_SERVER refuses an unknown coin', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode();
    await expect(
      startCrossChainServer({ coin: '../admin/restart' }, false, {
        tabId: 1,
        name: APP.name,
      })
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SET_CURRENT_FOREIGN_SERVER refuses an unknown coin before asking', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);
    await expect(
      setCurrentForeignServer(
        { coin: '../tradebot', host: 'h', port: 1, type: 'SSL' },
        false,
        APP
      )
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(payloads).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_LIST_ITEMS refuses a traversal list name before asking', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);
    await expect(
      getListItems({ list_name: '../../admin/apikey/generate' }, APP, false)
    ).rejects.toThrow('question:message.error.invalid_list_name');
    expect(payloads).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_LIST_ITEMS encodes a normal list name', async () => {
    const fetchMock = stubNode(() => ['alice']);
    answerPrompts(true);
    await expect(
      getListItems({ list_name: 'followedNames_q-tube' }, APP, false)
    ).resolves.toEqual(['alice']);
    expect(urlsOf(fetchMock)).toEqual([
      'http://127.0.0.1:12391/lists/followedNames_q-tube',
    ]);
  });
});

describe('GET_TX_ACTIVITY_SUMMARY', () => {
  it('runs without a prompt for an authenticated app', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode(() => []);
    const payloads = answerPrompts(true);

    await getTxActivitySummary({ coin: 'LITECOIN' }, false, APP);

    expect(payloads).toHaveLength(0);
    expect(urlsOf(fetchMock)).toEqual([
      'http://127.0.0.1:12391/crosschain/txactivity?foreignBlockchain=LITECOIN',
    ]);
  });

  it('asks to authenticate an app that has not, and stops if declined', async () => {
    const fetchMock = stubNode(() => []);
    const payloads = answerPrompts(false);

    await expect(
      getTxActivitySummary({ coin: 'LTC' }, false, APP)
    ).rejects.toThrow();

    expect(payloads[0]).toMatchObject({
      text1: 'question:permission.authenticate',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses query injection through the coin', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode();
    await expect(
      getTxActivitySummary({ coin: 'LITECOIN&x=1' }, false, APP)
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── GO-34 / GO-06 / N-07: ARRR seed egress ──────────────────────────────────

describe('ARRR seed egress', () => {
  it('GET_ARRR_SYNC_STATUS asks with the private-key warning before sending the seed', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);

    await expect(getArrrSyncStatus({}, false, APP)).resolves.toBe(
      'Synchronized'
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      text1: 'question:permission.arrr_wallet_access',
      text4: 'question:permission.foreign_key_local_warning',
      confirmCheckbox: true,
    });
    expect(seedRequests(fetchMock)).toHaveLength(1);
  });

  it('GET_ARRR_SYNC_STATUS sends nothing when the user declines', async () => {
    const fetchMock = stubNode();
    answerPrompts(false);

    await expect(getArrrSyncStatus({}, false, APP)).rejects.toThrow(
      'question:message.generic.user_declined_request'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_ARRR_SYNC_STATUS is refused on a public node without a prompt', async () => {
    useNode('https://ext-node.qortal.link');
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);

    await expect(getArrrSyncStatus({}, false, APP)).rejects.toThrow(
      'question:message.error.foreign_key_public_node'
    );
    expect(payloads).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('one consent covers later ARRR reads in the same tab', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);

    await getArrrSyncStatus({}, false, APP);
    await getArrrSyncStatus({}, false, APP);
    await getWalletBalance({ coin: 'ARRR' }, false, false, APP);

    expect(payloads).toHaveLength(1);
    expect(seedRequests(fetchMock).length).toBeGreaterThanOrEqual(3);
  });

  it('asks again in another tab', async () => {
    stubNode();
    const payloads = answerPrompts(true);

    await getArrrSyncStatus({}, false, APP);
    await getArrrSyncStatus({}, false, { ...APP, tabId: 'tab-2' });

    expect(payloads).toHaveLength(2);
  });

  it.each([
    [
      'another port on 127.0.0.1',
      'http://127.0.0.1:12391',
      'http://127.0.0.1:22391',
    ],
    [
      'https after http on the same Tailscale host',
      'http://mynode.tail1234.ts.net:12391',
      'https://mynode.tail1234.ts.net:12391',
    ],
  ])('asks again after a switch to %s', async (_label, first, second) => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(true);

    useNode(first);
    await getArrrSyncStatus({}, false, APP);
    useNode(second);
    await getArrrSyncStatus({}, false, APP);

    expect(payloads).toHaveLength(2);
    const seedUrls = seedRequests(fetchMock).map(([url]) => String(url));
    expect(seedUrls[0].startsWith(`${first}/`)).toBe(true);
    expect(seedUrls[1].startsWith(`${second}/`)).toBe(true);
  });

  it('keeps the consent when the same node is used again', async () => {
    stubNode();
    const payloads = answerPrompts(true);

    await getArrrSyncStatus({}, false, APP);
    useNode('http://127.0.0.1:12391');
    await getArrrSyncStatus({}, false, APP);

    expect(payloads).toHaveLength(1);
  });

  it('GET_WALLET_BALANCE for ARRR ignores the authenticate grant and the "always" box', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    vi.mocked(getPermission).mockResolvedValue(true);
    const fetchMock = stubNode(() => 'Synchronized');
    const payloads = answerPrompts(false);

    await expect(
      getWalletBalance({ coin: 'ARRR' }, false, false, APP)
    ).rejects.toThrow('question:message.generic.user_declined_request');

    expect(payloads[0]).toMatchObject({ confirmCheckbox: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_WALLET_BALANCE for LTC keeps the authenticate grant', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    stubNode(() => '150000000');
    const payloads = answerPrompts(false);

    await expect(
      getWalletBalance({ coin: 'LTC' }, false, false, APP)
    ).resolves.toBe('1.50000000');
    expect(payloads).toHaveLength(0);
  });

  it('GET_USER_WALLET for ARRR asks with the warning before any seed request', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode((url) =>
      url.includes('/syncstatus') ? 'Synchronized' : 'zs1address'
    );
    const payloads = answerPrompts(false);

    await expect(getUserWallet({ coin: 'ARRR' }, false, APP)).rejects.toThrow(
      'question:message.generic.user_declined_request'
    );
    expect(payloads[0]).toMatchObject({
      text4: 'question:permission.foreign_key_local_warning',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_USER_WALLET_INFO refuses PIRATECHAIN like ARRR', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode();

    await expect(
      getUserWalletInfo({ coin: 'PIRATECHAIN' }, false, APP)
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_USER_WALLET_TRANSACTIONS for PIRATECHAIN needs the ARRR consent', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode();
    const payloads = answerPrompts(false);

    await expect(
      getUserWalletTransactions({ coin: 'PIRATECHAIN' }, false, APP)
    ).rejects.toThrow('question:message.generic.user_declined_request');
    expect(payloads[0]).toMatchObject({ confirmCheckbox: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET_USER_WALLET_TRANSACTIONS uses the Core path for a chain name', async () => {
    vi.mocked(hasSessionPermission).mockReturnValue(true);
    const fetchMock = stubNode(() => []);
    answerPrompts(true);

    await getUserWalletTransactions({ coin: 'LITECOIN' }, false, APP);

    expect(urlsOf(fetchMock)).toEqual([
      'http://127.0.0.1:12391/crosschain/ltc/wallettransactions',
    ]);
  });

  it('SEND_COIN for ARRR checks the balance only after the user accepts', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(false);

    await expect(
      sendCoin({ coin: 'ARRR', amount: 1, recipient: 'zs1recipient' }, false)
    ).rejects.toThrow('question:message.generic.user_declined_request');

    expect(payloads[0]).toMatchObject({
      text4: 'question:permission.foreign_key_local_warning',
      confirmCheckbox: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SEND_COIN for ARRR still refuses more than the balance after accept', async () => {
    const fetchMock = stubNode((url) =>
      url.includes('/syncstatus') ? 'Synchronized' : '50000000'
    );
    answerPrompts(true);

    await expect(
      sendCoin({ coin: 'ARRR', amount: 1, recipient: 'zs1recipient' }, false)
    ).rejects.toThrow('question:message.error.insufficient_funds');
    expect(urlsOf(fetchMock).some((url) => url.endsWith('/arrr/send'))).toBe(
      false
    );
  });

  it('CREATE_TRADE_SELL_ORDER for ARRR warns and looks up the address only after accept', async () => {
    const fetchMock = stubNode();
    const payloads = answerPrompts(false);

    await expect(
      createSellOrder(
        { qortAmount: 1, foreignBlockchain: 'PIRATECHAIN', foreignAmount: 2 },
        false
      )
    ).rejects.toThrow('question:message.generic.user_declined_request');

    expect(payloads[0]).toMatchObject({
      text1: 'question:permission.sell_order',
      text4: 'question:permission.foreign_key_local_warning',
      confirmCheckbox: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CREATE_TRADE_SELL_ORDER for LTC shows no key warning', async () => {
    stubNode();
    const payloads = answerPrompts(false);

    await expect(
      createSellOrder(
        { qortAmount: 1, foreignBlockchain: 'LITECOIN', foreignAmount: 2 },
        false
      )
    ).rejects.toThrow();
    // No key warning, but still the value tick every sell order needs
    // (GO-28).
    expect(payloads[0]).not.toHaveProperty('confirmCheckboxLabel');
    expect(payloads[0]).not.toHaveProperty('text4');
    expect(payloads[0].confirmCheckbox).toBe(true);
  });
});
