import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { UnsafeNodeEndpointError } from '../../utils/nodeEndpointPath';

// Loads the real background.ts (src/test/setup.ts mocks it for every other
// test) with storage and its heaviest imports replaced, so the URL that
// createEndpoint builds and the result createBuyOrderTx hands a Q-App can be
// checked end to end.

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    if (key in storage.values) return storage.values[key];
    throw new Error(`No ${key} in storage`);
  }),
  storeData: vi.fn(async () => undefined),
  removeKeysAndLogout: vi.fn(async () => undefined),
}));
vi.mock('../../qortal/qortal-requests.ts', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../background-cases', () => ({}));
vi.mock('../../chatComputePow.worker.js?worker', () => ({
  default: class {},
}));

type Background = typeof import('../background');
let bg: Background;

const NODE = 'http://127.0.0.1:12391';
const KEY = 'k3y with/space+plus';
const ENCODED_KEY = encodeURIComponent(KEY);
const LTC_PRIVATE_KEY = 'LTC_PRIVATE_KEY_FOR_TEST';

function useNode(url: string, apikey?: unknown) {
  storage.values.apiKey = { url, apikey };
}

function stubTradeNode(result: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => result,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  bg = await vi.importActual<Background>('../background');
});

beforeEach(() => {
  storage.values = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createEndpoint', () => {
  it('adds the API key with "?" to a path without a query', async () => {
    useNode(NODE, KEY);
    await expect(bg.createEndpoint('/admin/status')).resolves.toBe(
      `${NODE}/admin/status?apiKey=${ENCODED_KEY}`
    );
  });

  it('adds the API key with "&" to a path that has a query', async () => {
    useNode(NODE, KEY);
    await expect(
      bg.createEndpoint('/crosschain/txactivity?foreignBlockchain=LITECOIN')
    ).resolves.toBe(
      `${NODE}/crosschain/txactivity?foreignBlockchain=LITECOIN&apiKey=${ENCODED_KEY}`
    );
  });

  it('trims the key and leaves it out when it is empty', async () => {
    useNode(NODE, '  abc  ');
    await expect(bg.createEndpoint('/a')).resolves.toBe(`${NODE}/a?apiKey=abc`);

    useNode(NODE, '   ');
    await expect(bg.createEndpoint('/a')).resolves.toBe(`${NODE}/a`);

    useNode(NODE, undefined);
    await expect(bg.createEndpoint('/a?b=1')).resolves.toBe(`${NODE}/a?b=1`);
  });

  it('keeps a base path prefix in front of the endpoint', async () => {
    useNode('https://host.example/qortal', 'abc');
    await expect(bg.createEndpoint('/admin/info')).resolves.toBe(
      'https://host.example/qortal/admin/info?apiKey=abc'
    );
  });

  it('uses the public gateway with no key when no node is set', async () => {
    await expect(bg.createEndpoint('/addresses/balance/Q1')).resolves.toBe(
      `${bg.groupApi}/addresses/balance/Q1`
    );
  });

  it('uses a custom API base as given, with no key', async () => {
    useNode(NODE, KEY);
    await expect(
      bg.createEndpoint('/admin/status', 'https://other.example')
    ).resolves.toBe('https://other.example/admin/status');
  });

  it.each([
    '/crosschain/%2e%2e/admin/apikey/generate',
    '/crosschain/../admin/apikey/generate',
    '/lists/..;/admin/apikey/generate',
    '/crosschain/%u002e%u002e/admin/stop',
    '/lists/x#?b=1',
    'admin/status',
  ])('refuses %s before the key is added', async (endpoint) => {
    useNode(NODE, KEY);
    await expect(bg.createEndpoint(endpoint)).rejects.toThrow(
      UnsafeNodeEndpointError
    );
  });

  it.each([[''], ['https://ext-node.qortal.link']])(
    'refuses a traversal on every base (custom API %j)',
    async (customApi) => {
      await expect(
        bg.createEndpoint('/crosschain/%2e%2e/tradebot', customApi || undefined)
      ).rejects.toThrow(UnsafeNodeEndpointError);
    }
  );
});

describe('createBuyOrderTx on the user’s own node (GO-33)', () => {
  const order = {
    crosschainAtInfo: [{ qortalAtAddress: 'AT_ADDRESS_1' }],
    isGateway: false,
    foreignBlockchain: 'LITECOIN',
  };

  beforeEach(() => {
    useNode(NODE, KEY);
    storage.values.walletInfo = { address0: 'QmyAddress' };
    storage.values.keyPair = { ltcPrivateKey: LTC_PRIVATE_KEY };
  });

  it('still sends the buy order to the tradebot with the API key', async () => {
    const fetchMock = stubTradeNode(true);

    await bg.createBuyOrderTx(order);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${NODE}/crosschain/tradebot/respondmultiple?apiKey=${ENCODED_KEY}`
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      addresses: ['AT_ADDRESS_1'],
      foreignKey: LTC_PRIVATE_KEY,
      receivingAddress: 'QmyAddress',
    });
  });

  it.each([
    ['accepted', true, true],
    ['refused by the node', false, 'ERROR'],
  ])(
    'returns only the node origin when the order is %s',
    async (_label, nodeResult, callResponse) => {
      stubTradeNode(nodeResult);

      const result = await bg.createBuyOrderTx(order);

      expect(result.callResponse).toBe(callResponse);
      expect(result.extra.node).toBe(NODE);
      expect(result.extra.atAddresses).toEqual(['AT_ADDRESS_1']);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('apiKey');
      expect(serialized).not.toContain(ENCODED_KEY);
      expect(serialized).not.toContain(LTC_PRIVATE_KEY);
    }
  );

  it('returns only the node origin for a PIRATECHAIN order too', async () => {
    storage.values.keyPair = { arrrSeed58: 'ARRR_SEED_FOR_TEST' };
    // The test runs outside Capacitor, where a node on 127.0.0.1 is the
    // user's own Core, so the ARRR seed may go to it.
    const fetchMock = stubTradeNode(true);

    const result = await bg.createBuyOrderTx({
      ...order,
      foreignBlockchain: 'PIRATECHAIN',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${NODE}/crosschain/tradebot/respond?apiKey=${ENCODED_KEY}`
    );
    expect(result.extra.node).toBe(NODE);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });
});
