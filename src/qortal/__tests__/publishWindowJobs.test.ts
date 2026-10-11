import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// GO's publish window follows a Q-App's publish from the moment it is
// approved: each resource's progress, what went through and what failed,
// and nothing at all for GO's own publishes.

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Same factories as ./approvalAttribution.test.ts.

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
import { publishMultipleQDNResources, publishQDNResource } from '../get';
import { hasSessionPermission, isRunningGateway } from '../qortal-requests';
import {
  createEndpoint,
  getBalanceInfo,
  getFee,
  getKeyPair,
} from '../../background/background';
import { getAllUserNames, getNameInfo } from '../../encryption/encryption';
import { publishData } from '../../qdn/publish/publish';
import {
  getPublishWindowSnapshot,
  resetPublishWindowForTests,
} from '../../qdn/publish/publishJobs';
import { GO_INTERNAL_APP_INFO } from '../../utils/qappApproval';

const APP_INFO = { name: 'Q-Share', service: 'APP', tabId: 'tab-1' };
const MB = 1024 * 1024;
const bigFile = () =>
  new File([new Uint8Array(12 * MB)], 'holiday.mp4', { type: 'video/mp4' });

/** Accepts the approval prompt, as the person would. */
function acceptPrompts() {
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: event.data.requestId,
          result: { accepted: true },
        },
        origin: window.location.origin,
        source: window,
      })
    );
  };
  window.addEventListener('message', listener);
  onTestFinished(() => window.removeEventListener('message', listener));
}

/** publishData as the node would run it, reporting each stage. */
function publishesFine() {
  vi.mocked(publishData).mockImplementation(async (args: any) => {
    args.onProgress?.({ stage: 'uploading', sentChunks: 0, totalChunks: 3 });
    args.onProgress?.({ stage: 'uploading', sentChunks: 3, totalChunks: 3 });
    args.onProgress?.({ stage: 'processing' });
    args.onProgress?.({ stage: 'published' });
    return { signature: 'SIG' };
  });
}

beforeEach(() => {
  resetPublishWindowForTests();
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(hasSessionPermission).mockReturnValue(true);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: 'PRIV',
    publicKey: 'PUB',
  });
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: '0.01' });
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  vi.mocked(getNameInfo).mockResolvedValue('myname');
  vi.mocked(getAllUserNames).mockResolvedValue(['myname']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('true', { status: 200 }))
  );
});

afterEach(() => {
  resetPublishWindowForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('publish window jobs from Q-App requests', () => {
  it('follows a multi-resource publish through to the end', async () => {
    publishesFine();
    await publishMultipleQDNResources(
      {
        resources: [{ service: 'VIDEO', identifier: 'v1', file: bigFile() }],
      },
      null,
      false,
      APP_INFO
    );
    const [job] = getPublishWindowSnapshot().jobs;
    expect(job).toMatchObject({
      tabId: 'tab-1',
      appName: 'Q-Share',
      shown: true,
      outcome: 'published',
    });
    expect(job.rows).toEqual([
      expect.objectContaining({
        label: 'holiday.mp4',
        bytes: 12 * MB,
        state: 'published',
        totalChunks: 3,
      }),
    ]);
    // GO's own window hears of it; the Q-App's own messages are unchanged.
    expect(vi.mocked(publishData).mock.calls[0][0]).toMatchObject({
      appInfo: APP_INFO,
    });
  }, 10_000);

  it('marks the resource that failed, with its reason', async () => {
    vi.mocked(publishData).mockRejectedValue(new Error('Not enough QORT'));
    const result = await publishMultipleQDNResources(
      {
        resources: [{ service: 'VIDEO', identifier: 'v1', file: bigFile() }],
      },
      null,
      false,
      APP_INFO
    );
    expect(result.error.unsuccessfulPublishes).toHaveLength(1);
    const [job] = getPublishWindowSnapshot().jobs;
    expect(job.outcome).toBe('failed');
    expect(job.rows[0]).toMatchObject({
      state: 'failed',
      error: 'Not enough QORT',
    });
  }, 10_000);

  it('follows a single-resource publish too', async () => {
    publishesFine();
    await publishQDNResource(
      { service: 'VIDEO', name: 'myname', identifier: 'v1', file: bigFile() },
      null,
      false,
      APP_INFO
    );
    const [job] = getPublishWindowSnapshot().jobs;
    expect(job).toMatchObject({ outcome: 'published', shown: true });
    expect(job.rows[0]).toMatchObject({
      label: 'holiday.mp4',
      state: 'published',
    });
  });

  it('lists nothing for GO’s own publishes', async () => {
    publishesFine();
    acceptPrompts();
    await publishMultipleQDNResources(
      {
        resources: [{ service: 'IMAGE', identifier: 'i1', file: bigFile() }],
      },
      null,
      true,
      GO_INTERNAL_APP_INFO
    );
    expect(getPublishWindowSnapshot().jobs).toHaveLength(0);
  }, 10_000);
});
