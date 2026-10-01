import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The App-level DM registration hook clears with `[]` on the lock screen.
// That must not boot the engine worker (and with it the Python bridge).
vi.mock('../../bridge/capacitorBridge', () => ({
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
  /** A message from the worker, as the browser delivers it. */
  send(data: unknown): void {
    this.onmessage?.({ data, currentTarget: this } as unknown as MessageEvent);
  }
}

type IndexModule = typeof import('./index');
let mod: IndexModule;
let portPosts: any[];

const api = () => (window as any).reticulumChat;
const dmRpcs = () =>
  portPosts.filter((m) => m?.t === 'rpc' && m.method === 'setLocalDmAddresses');

/** Answer every RPC posted so far with success. */
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

/** Let the engine report ready, then answer the RPCs that waited for it. */
async function bootAndAnswer(worker: FakeWorker): Promise<void> {
  worker.send({ t: 'engine-ready' });
  await vi.advanceTimersByTimeAsync(200);
  await answerRpcs(worker);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  portPosts = [];
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

describe('setLocalDmAddresses before the engine runs', () => {
  it('clears without booting the engine', async () => {
    await expect(api().setLocalDmAddresses([])).resolves.toEqual({
      success: true,
    });
    expect(FakeWorker.instances).toHaveLength(0);
    // Diagnostics are read-only and never start the engine.
    const diagnostics = await mod.getMobileReticulumChatDiagnostics();
    expect(diagnostics.readiness.state).toBe('idle');
    expect(diagnostics.workerAlive).toBe(false);
  });

  it('boots the engine to register an address', async () => {
    const pending = api().setLocalDmAddresses(['Qowner']);
    expect(FakeWorker.instances).toHaveLength(1);
    await bootAndAnswer(FakeWorker.instances[0]);
    await expect(pending).resolves.toEqual({ success: true });
    expect(dmRpcs().map((m) => m.args)).toEqual([[['Qowner']]]);
  });

  it('still clears a running engine (logout)', async () => {
    const registered = api().setLocalDmAddresses(['Qowner']);
    const worker = FakeWorker.instances[0];
    await bootAndAnswer(worker);
    await registered;

    const cleared = api().setLocalDmAddresses([]);
    await answerRpcs(worker);
    await expect(cleared).resolves.toEqual({ success: true });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(dmRpcs().map((m) => m.args)).toEqual([[['Qowner']], [[]]]);
  });

  it('does not restart a stopped engine to clear it', async () => {
    const registered = api().setLocalDmAddresses(['Qowner']);
    await bootAndAnswer(FakeWorker.instances[0]);
    await registered;
    mod.stopMobileReticulumChat();

    await expect(api().setLocalDmAddresses([])).resolves.toEqual({
      success: true,
    });
    expect(FakeWorker.instances).toHaveLength(1);
  });
});

// Back from the unlock screen (and a removed wallet) runs the logout cleanup
// before anyone has logged in.
describe('clearLocalAccountState before the engine runs', () => {
  const clearRpcs = () =>
    portPosts.filter(
      (m) => m?.t === 'rpc' && m.method === 'clearLocalAccountState'
    );

  it('clears without booting the engine', async () => {
    await expect(api().clearLocalAccountState()).resolves.toEqual({
      success: true,
    });
    expect(FakeWorker.instances).toHaveLength(0);
    const diagnostics = await mod.getMobileReticulumChatDiagnostics();
    expect(diagnostics.readiness.state).toBe('idle');
  });

  it('still clears a running engine (logout)', async () => {
    const registered = api().setLocalDmAddresses(['Qowner']);
    const worker = FakeWorker.instances[0];
    await bootAndAnswer(worker);
    await registered;

    const cleared = api().clearLocalAccountState();
    await answerRpcs(worker);
    await expect(cleared).resolves.toEqual({ success: true });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(clearRpcs()).toHaveLength(1);
  });

  it('does not restart a stopped engine to clear it', async () => {
    const registered = api().setLocalDmAddresses(['Qowner']);
    await bootAndAnswer(FakeWorker.instances[0]);
    await registered;
    mod.stopMobileReticulumChat();

    await expect(api().clearLocalAccountState()).resolves.toEqual({
      success: true,
    });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(clearRpcs()).toHaveLength(0);
  });
});
