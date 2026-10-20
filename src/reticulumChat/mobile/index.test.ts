import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the main-thread host against a fake worker: only the background
// sync plumbing (own outbox, relay profile) is under test here.
const bridge = vi.hoisted(() => ({
  relayProfile: 'leaf' as 'full' | 'leaf',
  lifecycle: 'foreground' as 'foreground' | 'background',
  relayListeners: [] as Array<(profile: 'full' | 'leaf') => void>,
  reportOwnOutboxPending: (() => {}) as (pending: boolean) => void,
  /** The main-thread Python event relay registered by the host. */
  tap: null as null | ((frame: Record<string, unknown>) => void),
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
  registerPythonEventTap: (tap: (frame: Record<string, unknown>) => void) => {
    bridge.tap = tap;
    return () => {};
  },
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
// GrapheneOS's WebView JIT flag as NativeBcrypt.runtimeInfo reports it.
const native = vi.hoisted(() => ({ jitRestricted: null as boolean | null }));
vi.mock('../../utils/nativeBcrypt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/nativeBcrypt')>()),
  getNativeBcryptRuntimeInfo: async () => ({
    debuggable: false,
    poolSize: 2,
    cores: 4,
    probeMs: 3,
    webViewJitRestricted: native.jitRestricted,
  }),
}));
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
  native.jitRestricted = null;
  bridge.relayProfile = 'leaf';
  bridge.lifecycle = 'foreground';
  bridge.relayListeners = [];
  bridge.tap = null;
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
  vi.spyOn(console, 'info').mockImplementation(() => {});
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

describe('RPCs across an engine stop', () => {
  it('rejects the ones the stopped worker never answered once it is terminated', async () => {
    const worker = await startWorker();
    const api = (window as any).reticulumChat;
    const answered = api.getSubscriptions();
    const unanswered = api.getDirectHistory('Qa', 'Qb', 50);
    unanswered.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const rpcs = portPosts.filter((m) => m?.t === 'rpc');
    const idOf = (method: string) => rpcs.find((m) => m.method === method).id;
    mod.stopMobileReticulumChat();
    // The stopping worker may still answer during its grace.
    worker.send({
      t: 'rpcres',
      id: idOf('getSubscriptions'),
      ok: true,
      value: ['7'],
    });
    await expect(answered).resolves.toEqual(['7']);
    let settled = false;
    unanswered
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(unanswered).rejects.toThrow('Reticulum chat engine stopped');
  });
});

describe('RPC budget', () => {
  async function timesOutAfter(): Promise<number> {
    await startWorker();
    const api = (window as any).reticulumChat;
    let failedAt = 0;
    const startedAt = Date.now();
    api.getSubscriptions().catch(() => {
      failedAt = Date.now();
    });
    for (let i = 0; i < 100 && !failedAt; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    return failedAt - startedAt;
  }

  it('is 45 s on a WebView with JIT', async () => {
    native.jitRestricted = false;
    expect(await timesOutAfter()).toBe(45_000);
  });

  it('is 90 s when GrapheneOS reports the WebView JIT off for GO', async () => {
    native.jitRestricted = true;
    expect(await timesOutAfter()).toBe(90_000);
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

describe('own post delivery events', () => {
  it('fills the page store from the first proof on, without starting the engine', async () => {
    // Same module registry as the index import (reset per test).
    const store = await import('../ownPostDeliveryStore');
    // Installing the API listens already, but boots no worker for it.
    expect(FakeWorker.instances).toHaveLength(0);

    // A proof before any delivery glyph has mounted.
    const worker = await startWorker();
    worker.send({
      t: 'evt',
      channel: 'reticulumChat:ownPostDelivery',
      payload: {
        updates: [
          { eventId: 'post-1', scope: 'group', groupId: 7, memberAt: 5 },
        ],
      },
    });
    expect(store.getOwnPostDelivery('post-1')).toEqual({ memberAt: 5 });
  });

  it('hands the engine event to onOwnPostDelivery subscribers', async () => {
    const worker = await startWorker();
    const seen: unknown[] = [];
    const off = (window as any).reticulumChat.onOwnPostDelivery(
      (payload: unknown) => seen.push(payload)
    );
    const payload = {
      updates: [
        { eventId: 'post-1', scope: 'group', groupId: 7, memberAt: 1 },
        {
          eventId: 'saved-1',
          scope: 'self_dm',
          conversationId: 'c1',
          ownDeviceAt: 2,
        },
      ],
    };
    worker.send({
      t: 'evt',
      channel: 'reticulumChat:ownPostDelivery',
      payload,
    });
    expect(seen).toEqual([payload]);
    off();
    worker.send({
      t: 'evt',
      channel: 'reticulumChat:ownPostDelivery',
      payload,
    });
    expect(seen).toHaveLength(1);
  });
});

describe('Copy diagnostics', () => {
  const rpcPosts = () => portPosts.filter((m) => m?.t === 'rpc');
  const VALUES: Record<string, unknown> = {
    'debug:logs': ['2026-10-11T10:00:00.000Z log x'],
    'debug:diagnostics': {
      apiHost: '127.0.0.1:12391',
      apiScheme: 'http',
      apiKeyConfigured: false,
      validator: { okCount: 1, unavailableCount: 0 },
      resourceSessions: null,
      bootFaultLogs: ['warn y'],
    },
    'debug:membership-probe': {
      host: '127.0.0.1:12391',
      groupId: 7,
      status: 200,
      ok: true,
      isMember: true,
      error: null,
      ms: 5,
    },
    'debug:sync-health': { at: 1 },
  };

  /** Answer every RPC posted so far; `fail` names methods that error. */
  async function answerRpcs(
    worker: FakeWorker,
    fail: Record<string, string> = {}
  ): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    for (const msg of rpcPosts()) {
      if (fail[msg.method]) {
        worker.send({
          t: 'rpcres',
          id: msg.id,
          ok: false,
          error: fail[msg.method],
        });
      } else {
        worker.send({
          t: 'rpcres',
          id: msg.id,
          ok: true,
          value: VALUES[msg.method],
        });
      }
    }
  }

  it('asks for sync health with the time it was sent and passes it through', async () => {
    const worker = await startWorker();
    const pending = mod.getMobileReticulumChatDiagnostics();
    await vi.advanceTimersByTimeAsync(0);
    const request = rpcPosts().find((m) => m.method === 'debug:sync-health');
    expect(typeof request?.args[0].sentAt).toBe('number');
    await answerRpcs(worker);
    const diagnostics = await pending;
    expect(diagnostics.syncHealth).toEqual({ at: 1 });
    expect(diagnostics.syncHealthError).toBeUndefined();
    expect(diagnostics.validator).toEqual({ okCount: 1, unavailableCount: 0 });
    expect(diagnostics.engineLogs).toEqual(['2026-10-11T10:00:00.000Z log x']);
  });

  it('reports a failed sync-health request and keeps the rest', async () => {
    const worker = await startWorker();
    const pending = mod.getMobileReticulumChatDiagnostics();
    await answerRpcs(worker, { 'debug:sync-health': 'x' });
    const diagnostics = await pending;
    expect(diagnostics.syncHealth).toBeNull();
    expect(diagnostics.syncHealthError).toBe('x');
    expect(diagnostics.validator).toEqual({ okCount: 1, unavailableCount: 0 });
    expect(diagnostics.engineBootFaults).toEqual(['warn y']);
    expect(diagnostics.membershipProbe).toMatchObject({ ok: true });
    expect(diagnostics.apiHost).toBe('127.0.0.1:12391');
  });

  it('reports a timed-out sync-health request by its error', async () => {
    const worker = await startWorker();
    const pending = mod.getMobileReticulumChatDiagnostics();
    await vi.advanceTimersByTimeAsync(0);
    // Every other diagnostics RPC answers; sync health never does.
    for (const msg of rpcPosts()) {
      if (msg.method === 'debug:sync-health') continue;
      worker.send({
        t: 'rpcres',
        id: msg.id,
        ok: true,
        value: VALUES[msg.method],
      });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    const diagnostics = await pending;
    expect(diagnostics.syncHealth).toBeNull();
    expect(diagnostics.syncHealthError).toBe(
      'reticulumChat:debug:sync-health timed out'
    );
    expect(diagnostics.membershipProbe).toMatchObject({ ok: true });
  });

  it('sends no RPC while the engine is not ready', async () => {
    const diagnostics = await mod.getMobileReticulumChatDiagnostics();
    expect(rpcPosts()).toEqual([]);
    expect(diagnostics).toMatchObject({
      syncHealth: null,
      bridgeTraffic: [],
      oldestRpc: null,
    });
    expect(diagnostics.syncHealthError).toBeUndefined();
  });

  it('keeps the last three bridge traffic summaries', async () => {
    const worker = await startWorker();
    for (let i = 1; i <= 4; i++) {
      worker.send({
        t: 'bridge-traffic',
        seconds: 60 + i,
        commands: [['send_reticulum_chat', 3]],
        events: [],
        resourceBytes: [],
      });
    }
    expect(console.info).toHaveBeenLastCalledWith(
      '[MobileChat] bridge_traffic 64s out{ send_reticulum_chat=3 } in{  } resource_bytes{  }'
    );
    const pending = mod.getMobileReticulumChatDiagnostics();
    await answerRpcs(worker);
    const { bridgeTraffic } = await pending;
    expect(bridgeTraffic).toEqual([
      'bridge_traffic 62s out{ send_reticulum_chat=3 } in{  } resource_bytes{  }',
      'bridge_traffic 63s out{ send_reticulum_chat=3 } in{  } resource_bytes{  }',
      'bridge_traffic 64s out{ send_reticulum_chat=3 } in{  } resource_bytes{  }',
    ]);
  });

  it('names the oldest page RPC still waiting, not the diagnostics ones', async () => {
    const worker = await startWorker();
    const api = (window as any).reticulumChat;
    void api.getDirectHistory('Qa', 'Qb', 50).catch(() => {});
    await vi.advanceTimersByTimeAsync(4_100);
    void api.getSubscriptions().catch(() => {});
    const pending = mod.getMobileReticulumChatDiagnostics();
    await vi.advanceTimersByTimeAsync(0);
    for (const msg of rpcPosts()) {
      if (!String(msg.method).startsWith('debug:')) continue;
      worker.send({
        t: 'rpcres',
        id: msg.id,
        ok: true,
        value: VALUES[msg.method],
      });
    }
    const diagnostics = await pending;
    expect(diagnostics.pendingRpcCount).toBe(2);
    expect(diagnostics.oldestRpc).toEqual({
      method: 'getDirectHistory',
      ageMs: 4_100,
    });
  });
});

describe('Python stall watchdog relay', () => {
  it('forwards the summary fields only', async () => {
    const worker = await startWorker();
    expect(bridge.tap).toBeTypeOf('function');
    bridge.tap!({
      event: 'bridge_stall_diagnostic',
      payload: {
        executorStalled: true,
        threadCount: 63,
        stacks: { t1: 'TRACE' },
        threads: [{ name: 'x' }],
        detail: { big: true },
      },
    });
    bridge.tap!({ event: 'presence_snapshot', payload: {} });
    expect(worker.posted.filter((m) => m?.t === 'pyevent')).toEqual([
      {
        t: 'pyevent',
        event: 'bridge_stall_diagnostic',
        payload: { executorStalled: true, threadCount: 63 },
      },
    ]);
  });

  it('leaves them to the worker socket when it has one', async () => {
    const worker = await startWorker();
    worker.send({ t: 'direct-bridge', connected: true });
    bridge.tap!({ event: 'bridge_thread_population', payload: {} });
    expect(worker.posted.filter((m) => m?.t === 'pyevent')).toEqual([]);
  });
});

describe('resource blob URLs', () => {
  it('reads a file once for callers that miss the cache together', async () => {
    const worker = await startWorker();
    const created: string[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:test/${created.length + 1}`;
      created.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    try {
      const resources = (window as any).reticulumResources;
      // A reply thumbnail and its picture row mount in the same moment.
      const first = resources.getUrl('hash-1');
      const second = resources.getUrl('hash-1');
      await vi.advanceTimersByTimeAsync(0);
      const reads = portPosts.filter(
        (m) => m?.t === 'rpc' && m.method === 'resource:bytes'
      );
      expect(reads).toHaveLength(1);
      worker.send({
        t: 'rpcres',
        id: reads[0].id,
        ok: true,
        value: {
          success: true,
          bytes: new Uint8Array([1, 2, 3]),
          manifest: { mimeType: 'image/png' },
        },
      });
      const [a, b] = await Promise.all([first, second]);
      expect(a).toEqual({
        success: true,
        url: 'blob:test/1',
        manifest: { mimeType: 'image/png' },
      });
      expect(b).toEqual(a);
      expect(created).toEqual(['blob:test/1']);

      // A failed read is not remembered: the next call asks again.
      const third = resources.getUrl('hash-2');
      await vi.advanceTimersByTimeAsync(0);
      const failed = portPosts.filter(
        (m) => m?.t === 'rpc' && m.method === 'resource:bytes'
      );
      expect(failed).toHaveLength(2);
      worker.send({
        t: 'rpcres',
        id: failed[1].id,
        ok: true,
        value: { success: false, error: 'missing' },
      });
      await expect(third).resolves.toEqual({
        success: false,
        error: 'missing',
      });
      const fourth = resources.getUrl('hash-2');
      await vi.advanceTimersByTimeAsync(0);
      expect(
        portPosts.filter((m) => m?.t === 'rpc' && m.method === 'resource:bytes')
      ).toHaveLength(3);
      void fourth.catch(() => {});
    } finally {
      URL.createObjectURL = original;
    }
  });
});
