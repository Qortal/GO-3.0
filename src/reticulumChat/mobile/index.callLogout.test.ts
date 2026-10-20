import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

// The logout boundary for GO's hosted call managers: App's
// cleanupReticulumAccountBeforeLogout calls
// window.reticulumChat.clearLocalAccountState, and desktop clears the call
// managers at that same IPC (setup.ts reticulumChat:clearLocalAccountState).
// On GO the managers live in the page (src/bridge/hubCall), so index.ts must
// call clearHostedHubCallAccountState() there, engine running or not.
const calls = vi.hoisted(() => ({
  clearHostedHubCallAccountState: null as unknown as Mock<() => void>,
  /** clearLocalAccountState RPCs already posted when the call managers were cleared. */
  clearRpcsAtCallClear: [] as number[],
}));

vi.mock('../../bridge/capacitorBridge', () => ({
  clearHostedHubCallAccountState: () => calls.clearHostedHubCallAccountState(),
  ensureReticulumBridgeStarted: () => new Promise(() => {}),
  getAppLifecycleState: () => 'foreground',
  getRelayProfile: () => 'leaf',
  getReticulumChatPresenceSnapshot: () => ({
    peers: [],
    leases: [],
    healthy: false,
  }),
  isCapacitor: () => true,
  presenceCommandWithResult: () => new Promise(() => {}),
  registerPythonEventTap: () => () => {},
  reportOwnOutboxPending: () => {},
  subscribeAppLifecycle: () => () => {},
  subscribeDeviceNetworkRegained: () => () => {},
  subscribeRelayProfile: () => () => {},
}));
vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://127.0.0.1:1' }));
vi.mock('../../plugins/Reticulum', () => ({ Reticulum: {} }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(): void {}
  terminate(): void {}
  send(data: unknown): void {
    this.onmessage?.({ data, currentTarget: this } as unknown as MessageEvent);
  }
}

type IndexModule = typeof import('./index');
let mod: IndexModule;
let portPosts: any[];

const api = () => (window as any).reticulumChat;
const clearRpcs = () =>
  portPosts.filter(
    (m) => m?.t === 'rpc' && m.method === 'clearLocalAccountState'
  );

async function answerRpcs(worker: FakeWorker): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  for (const msg of portPosts.filter((m) => m?.t === 'rpc')) {
    worker.send({
      t: 'rpcres',
      id: msg.id,
      ok: true,
      value: { success: true },
    });
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  portPosts = [];
  calls.clearRpcsAtCallClear = [];
  calls.clearHostedHubCallAccountState = vi.fn(() => {
    calls.clearRpcsAtCallClear.push(clearRpcs().length);
  });
  vi.spyOn(MessagePort.prototype, 'postMessage').mockImplementation(
    (msg: unknown) => {
      portPosts.push(msg);
    }
  );
  vi.stubGlobal('Worker', FakeWorker);
  (window as any).sendMessage = vi.fn(() => new Promise(() => {}));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mod = await import('./index');
  mod.installMobileReticulumChat();
});

afterEach(() => {
  mod.stopMobileReticulumChat();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (window as any).reticulumChat;
});

describe('clearLocalAccountState clears the hosted call managers', () => {
  it('before the engine runs (no worker boot)', async () => {
    await expect(api().clearLocalAccountState()).resolves.toEqual({
      success: true,
    });
    expect(calls.clearHostedHubCallAccountState).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('while the engine runs, before the engine RPC is posted (desktop order)', async () => {
    const registered = api().setLocalDmAddresses(['Qowner']);
    const worker = FakeWorker.instances[0];
    worker.send({ t: 'engine-ready' });
    await vi.advanceTimersByTimeAsync(200);
    await answerRpcs(worker);
    await registered;
    expect(calls.clearHostedHubCallAccountState).not.toHaveBeenCalled();

    const cleared = api().clearLocalAccountState();
    await answerRpcs(worker);
    await expect(cleared).resolves.toEqual({ success: true });
    expect(calls.clearHostedHubCallAccountState).toHaveBeenCalledTimes(1);
    expect(calls.clearRpcsAtCallClear).toEqual([0]);
    expect(clearRpcs()).toHaveLength(1);
  });

  it('a failing call clear never blocks the logout and is logged', async () => {
    calls.clearHostedHubCallAccountState = vi.fn(() => {
      throw new Error('boom');
    });
    await expect(api().clearLocalAccountState()).resolves.toEqual({
      success: true,
    });
    expect(console.warn).toHaveBeenCalledWith(
      '[MobileChat] clearing call account state failed',
      expect.any(Error)
    );
  });
});
