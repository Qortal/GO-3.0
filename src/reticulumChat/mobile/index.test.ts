import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the main-thread host against a fake worker: only the background
// sync plumbing (own outbox, relay profile) is under test here.
const bridge = vi.hoisted(() => ({
  relayProfile: 'leaf' as 'full' | 'leaf',
  lifecycle: 'foreground' as 'foreground' | 'background',
  relayListeners: [] as Array<(profile: 'full' | 'leaf') => void>,
  reportOwnOutboxPending: (() => {}) as (pending: boolean) => void,
}));

vi.mock('../../bridge/capacitorBridge', () => ({
  ensureReticulumBridgeStarted: () => new Promise(() => {}),
  getAppLifecycleState: () => bridge.lifecycle,
  getRelayProfile: () => bridge.relayProfile,
  getReticulumChatPresenceSnapshot: () => ({
    peers: [],
    leases: [],
    healthy: false,
  }),
  isCapacitor: () => true,
  presenceCommandWithResult: () => new Promise(() => {}),
  registerPythonEventTap: () => () => {},
  reportOwnOutboxPending: (pending: boolean) =>
    bridge.reportOwnOutboxPending(pending),
  subscribeAppLifecycle: () => () => {},
  subscribeDeviceNetworkRegained: () => () => {},
  subscribeRelayProfile: (listener: (profile: 'full' | 'leaf') => void) => {
    bridge.relayListeners.push(listener);
    return () => {};
  },
}));
vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://127.0.0.1:1' }));
vi.mock('../../plugins/Reticulum', () => ({ Reticulum: {} }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: any[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {}
  /** A message from the worker, as the browser delivers it. */
  send(data: unknown): void {
    this.onmessage?.({ data, currentTarget: this } as unknown as MessageEvent);
  }
}

type IndexModule = typeof import('./index');
let mod: IndexModule;
let reported: boolean[];
let portPosts: any[];

async function startWorker(): Promise<FakeWorker> {
  const api = (window as any).reticulumChat;
  void api.getReadinessStatus();
  const worker = FakeWorker.instances[FakeWorker.instances.length - 1];
  worker.send({ t: 'engine-ready' });
  await vi.advanceTimersByTimeAsync(200);
  return worker;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  bridge.relayProfile = 'leaf';
  bridge.lifecycle = 'foreground';
  bridge.relayListeners = [];
  reported = [];
  bridge.reportOwnOutboxPending = (pending) => reported.push(pending);
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

describe('own outbox forwarding', () => {
  it('reports the running engine outbox to the native keep-alive', async () => {
    const worker = await startWorker();
    worker.send({ t: 'own-outbox', pending: true, pendingCount: 1 });
    worker.send({ t: 'own-outbox', pending: false, pendingCount: 0 });
    expect(reported).toEqual([true, false]);
  });

  it('clears the flag on stop and ignores the stopping worker', async () => {
    const worker = await startWorker();
    worker.send({ t: 'own-outbox', pending: true });
    mod.stopMobileReticulumChat();
    worker.send({ t: 'own-outbox', pending: true });
    expect(reported).toEqual([true, false]);
  });
});

describe('relay profile forwarding', () => {
  it('re-sends a full profile after boot on the RPC port', async () => {
    bridge.relayProfile = 'full';
    const worker = await startWorker();
    expect(worker.posted.some((m) => m?.t === 'boot')).toBe(true);
    // Same channel as later changes, so a newer profile cannot overtake it.
    expect(worker.posted.some((m) => m?.t === 'relay-profile')).toBe(false);
    bridge.relayListeners[0]('leaf');
    expect(portPosts.filter((m) => m?.t === 'relay-profile')).toEqual([
      { t: 'relay-profile', profile: 'full' },
      { t: 'relay-profile', profile: 'leaf' },
    ]);
  });

  it('does not send a leaf profile at boot', async () => {
    const worker = await startWorker();
    expect(worker.posted.some((m) => m?.t === 'relay-profile')).toBe(false);
    expect(portPosts.some((m) => m?.t === 'relay-profile')).toBe(false);
  });

  it('forwards profile changes over the RPC port', async () => {
    await startWorker();
    expect(bridge.relayListeners).toHaveLength(1);
    bridge.relayListeners[0]('full');
    bridge.relayListeners[0]('leaf');
    expect(portPosts.filter((m) => m?.t === 'relay-profile')).toEqual([
      { t: 'relay-profile', profile: 'full' },
      { t: 'relay-profile', profile: 'leaf' },
    ]);
  });
});

describe('app lifecycle at boot', () => {
  it('tells a new engine the current state once, on the RPC port', async () => {
    const worker = await startWorker();
    expect(worker.posted.some((m) => m?.t === 'lifecycle')).toBe(false);
    expect(portPosts.filter((m) => m?.t === 'lifecycle')).toEqual([
      { t: 'lifecycle', state: 'foreground' },
    ]);
  });

  it('reports a background boot as background', async () => {
    bridge.lifecycle = 'background';
    await startWorker();
    expect(portPosts.filter((m) => m?.t === 'lifecycle')).toEqual([
      { t: 'lifecycle', state: 'background' },
    ]);
  });

  it('tells a restarted engine the state again', async () => {
    await startWorker();
    mod.stopMobileReticulumChat();
    await startWorker();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(portPosts.filter((m) => m?.t === 'lifecycle')).toHaveLength(2);
  });
});
