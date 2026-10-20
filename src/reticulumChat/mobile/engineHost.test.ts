import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine, resource store and wire bridge are heavy (fs/sqlite on load);
// these tests only drive the worker message router and the bridge socket.
const engine = vi.hoisted(() => ({
  manager: undefined as any,
  startOptions: [] as any[],
  dispatched: [] as Array<{ event: string; payload: any }>,
  bridge: undefined as any,
  /** The command function the host handed the bridge (sendPythonCommand). */
  sendCommand: undefined as any,
  admittedLink: false,
}));

vi.mock('../../../electron/src/reticulum-chat', () => ({
  startReticulumChatManager: vi.fn(
    (_bridge: unknown, _dbPath: unknown, options: unknown) => {
      engine.startOptions.push(options);
      return engine.manager;
    }
  ),
  stopReticulumChatManager: vi.fn(),
  getReticulumChatManager: () => engine.manager,
}));
vi.mock('../../../electron/src/reticulum-resource-store', () => ({
  ReticulumResourceStore: class {},
}));
vi.mock('./wireBridge', () => ({
  MobileReticulumBridge: class {
    private readonly listeners = new Map<
      string,
      Array<(payload: any) => void>
    >();
    constructor(sendCommand: unknown) {
      engine.bridge = this;
      engine.sendCommand = sendCommand;
    }
    on(name: string, fn: (payload: any) => void): void {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
    }
    emit(name: string, payload: unknown): void {
      for (const fn of this.listeners.get(name) ?? []) fn(payload);
    }
    hasAdmittedOverlayLink(): boolean {
      return engine.admittedLink;
    }
    markStopped(): void {}
    stagingSweeps = 0;
    sweepStagingOnce(): void {
      this.stagingSweeps += 1;
    }
    dispatchPythonEvent(event: string, payload: unknown): void {
      engine.dispatched.push({ event, payload });
    }
  },
}));
vi.mock('./resourceStaging', () => ({ ReticulumResourceStaging: class {} }));

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  /** The native server accepted the connection. */
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** The native server dropped the connection. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const latestSocket = () =>
  FakeSocket.instances[FakeSocket.instances.length - 1];

function makeManager() {
  return {
    notifyAppLifecycle: vi.fn(),
    notifyNetworkRegained: vi.fn(),
    notifyBridgeSocketReopened: vi.fn(),
  };
}

let handleMainMessage: (data: any) => void;
let startEngine: (config: unknown) => void;
let summarizeBridgeDiagnosticEvent: (event: string, payload: unknown) => string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(self, 'postMessage').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  engine.manager = makeManager();
  engine.startOptions = [];
  engine.dispatched = [];
  engine.bridge = undefined;
  engine.sendCommand = undefined;
  engine.admittedLink = false;
  const host = await import('./engineHost');
  ({ handleMainMessage, startEngine, summarizeBridgeDiagnosticEvent } = host);
  // Socket event frames are handed to the engine as they arrive here, so
  // these tests can check routing right after a frame; the queue itself is
  // covered in engineHost.socketPump.test.ts.
  host.setSocketEventScheduleForTests((run) => run());
});

afterEach(() => {
  handleMainMessage({ t: 'stop' });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const connect = (token = 'tok-1') =>
  handleMainMessage({
    t: 'bridge-socket',
    url: 'ws://127.0.0.1:1234',
    token,
  });

let nextRpcCallId = 7_000;
/** One worker RPC from the page, answered by the host; resolves to its value. */
const rpcCall = async (method: string, args: unknown[] = []) => {
  const id = ++nextRpcCallId;
  handleMainMessage({ t: 'rpc', id, method, args });
  await vi.advanceTimersByTimeAsync(0);
  return (
    self.postMessage as unknown as { mock: { calls: any[][] } }
  ).mock.calls
    .map((call) => call[0])
    .find((msg: any) => msg?.t === 'rpcres' && msg.id === id)?.value;
};

describe('bridge socket reopen hook', () => {
  it('is not called on the first connect', () => {
    connect();
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
  });

  it('runs once, on open, after an unexpected close', () => {
    connect();
    latestSocket().accept();
    latestSocket().drop();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    // Waits for the socket to be usable.
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).toHaveBeenCalledTimes(1);
  });

  it('is not armed by a connect attempt that never opened', () => {
    connect();
    latestSocket().drop();
    vi.advanceTimersByTime(1_000);
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
  });

  it('is not armed by a close we started', () => {
    connect();
    latestSocket().accept();
    handleMainMessage({ t: 'stop' });
    connect();
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
  });

  it('is disarmed by a stop that follows an unexpected close', () => {
    connect();
    latestSocket().accept();
    latestSocket().drop();
    handleMainMessage({ t: 'stop' });
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
    connect();
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
  });

  it('gives the staging sweep its chance each time the socket opens', () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    connect();
    expect(engine.bridge.stagingSweeps).toBe(0);
    latestSocket().accept();
    expect(engine.bridge.stagingSweeps).toBe(1);
  });

  it('runs once when the endpoint changes under an open socket', () => {
    connect('tok-1');
    latestSocket().accept();
    connect('tok-2');
    expect(FakeSocket.instances).toHaveLength(2);
    expect(latestSocket().url).toContain('tok-2');
    expect(engine.manager.notifyBridgeSocketReopened).not.toHaveBeenCalled();
    latestSocket().accept();
    expect(engine.manager.notifyBridgeSocketReopened).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle and network routing', () => {
  it('forwards only foreground and background edges', () => {
    handleMainMessage({ t: 'lifecycle', state: 'background' });
    handleMainMessage({ t: 'lifecycle', state: 'foreground' });
    handleMainMessage({ t: 'lifecycle', state: 'visible' });
    handleMainMessage({ t: 'lifecycle' });
    expect(engine.manager.notifyAppLifecycle.mock.calls).toEqual([
      ['background'],
      ['foreground'],
    ]);
  });

  it('forwards network regain', () => {
    handleMainMessage({ t: 'network-regained' });
    expect(engine.manager.notifyNetworkRegained).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the engine lacks the hooks or is not running', () => {
    engine.manager = {};
    expect(() => {
      handleMainMessage({ t: 'lifecycle', state: 'background' });
      handleMainMessage({ t: 'network-regained' });
    }).not.toThrow();
    engine.manager = undefined;
    expect(() => {
      handleMainMessage({ t: 'lifecycle', state: 'foreground' });
      handleMainMessage({ t: 'network-regained' });
    }).not.toThrow();
  });

  it('contains a hook that throws or rejects', async () => {
    engine.manager = {
      notifyAppLifecycle: () => {
        throw new Error('boom');
      },
      notifyNetworkRegained: () => Promise.reject(new Error('later')),
    };
    expect(() => {
      handleMainMessage({ t: 'lifecycle', state: 'background' });
      handleMainMessage({ t: 'network-regained' });
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('relay profile routing', () => {
  it('switches group control relaying for full and leaf only', () => {
    engine.manager = { setRelayGroupControl: vi.fn() };
    handleMainMessage({ t: 'relay-profile', profile: 'full' });
    handleMainMessage({ t: 'relay-profile', profile: 'leaf' });
    handleMainMessage({ t: 'relay-profile', profile: 'desktop' });
    handleMainMessage({ t: 'relay-profile' });
    expect(engine.manager.setRelayGroupControl.mock.calls).toEqual([
      [true],
      [false],
    ]);
  });

  it('tolerates an engine without the switch', () => {
    engine.manager = {};
    expect(() =>
      handleMainMessage({ t: 'relay-profile', profile: 'full' })
    ).not.toThrow();
  });
});

describe('own outbox forwarding', () => {
  type Listener = (payload: unknown) => void;

  function makeEmittingManager(initial?: unknown) {
    const listeners = new Map<string, Listener[]>();
    return {
      on: vi.fn((name: string, fn: Listener) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      }),
      emit(name: string, payload: unknown) {
        for (const fn of listeners.get(name) ?? []) fn(payload);
      },
      ...(initial === undefined
        ? {}
        : { getOwnOutboxState: vi.fn(() => initial) }),
    };
  }

  const outboxPosts = () =>
    (self.postMessage as unknown as { mock: { calls: any[][] } }).mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.t === 'own-outbox');

  it('posts the starting state and each change', () => {
    const manager = makeEmittingManager({
      pending: true,
      pendingCount: 2,
      uncopiedCount: 1,
    });
    engine.manager = manager;
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    manager.emit('ownOutboxState', {
      pending: false,
      pendingCount: 0,
      uncopiedCount: 0,
    });
    expect(outboxPosts()).toEqual([
      { t: 'own-outbox', pending: true, pendingCount: 2, uncopiedCount: 1 },
      { t: 'own-outbox', pending: false, pendingCount: 0, uncopiedCount: 0 },
    ]);
  });

  it('normalises odd payloads and skips an engine without a getter', () => {
    const manager = makeEmittingManager();
    engine.manager = manager;
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    manager.emit('ownOutboxState', null);
    manager.emit('ownOutboxState', { pending: 'yes', pendingCount: 'x' });
    expect(outboxPosts()).toEqual([
      { t: 'own-outbox', pending: false, pendingCount: 0, uncopiedCount: 0 },
    ]);
  });
});

describe('provider auth timing stamps', () => {
  const startWithSocket = () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    connect();
    latestSocket().accept();
  };
  const sendFrame = (frame: Record<string, unknown>) =>
    latestSocket().onmessage?.({ data: JSON.stringify(frame) });
  const frame = (event: string, payload: Record<string, unknown>) => ({
    type: 'event',
    event,
    _queuedAtMs: 1_000,
    _writeAtMs: 1_040,
    payload,
  });

  it('copies the bridge stamps onto auth and auth_ended only', () => {
    startWithSocket();
    vi.setSystemTime(5_000);
    sendFrame(
      frame('reticulum_chat_resource', { status: 'auth', transferId: 't1' })
    );
    sendFrame(
      frame('reticulum_resource', { status: 'auth_ended', transferId: 't2' })
    );
    sendFrame(
      frame('reticulum_chat_resource', { status: 'sent', transferId: 't3' })
    );
    sendFrame(
      frame('reticulum_chat_message', { status: 'auth', transferId: 't4' })
    );
    expect(engine.dispatched).toEqual([
      {
        event: 'reticulum_chat_resource',
        payload: {
          status: 'auth',
          transferId: 't1',
          _pyQueuedAtMs: 1_000,
          _pyWriteAtMs: 1_040,
          _workerRecvAtMs: 5_000,
        },
      },
      {
        event: 'reticulum_resource',
        payload: {
          status: 'auth_ended',
          transferId: 't2',
          _pyQueuedAtMs: 1_000,
          _pyWriteAtMs: 1_040,
          _workerRecvAtMs: 5_000,
        },
      },
      {
        event: 'reticulum_chat_resource',
        payload: { status: 'sent', transferId: 't3' },
      },
      {
        event: 'reticulum_chat_message',
        payload: { status: 'auth', transferId: 't4' },
      },
    ]);
  });

  it('copies only finite stamps', () => {
    startWithSocket();
    vi.setSystemTime(7_000);
    sendFrame({
      type: 'event',
      event: 'reticulum_chat_resource',
      _queuedAtMs: 'soon',
      payload: { status: 'auth', transferId: 't5' },
    });
    expect(engine.dispatched).toEqual([
      {
        event: 'reticulum_chat_resource',
        payload: { status: 'auth', transferId: 't5', _workerRecvAtMs: 7_000 },
      },
    ]);
  });

  it('asks the engine for the one-time premature-sent repair', () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    expect(engine.startOptions).toHaveLength(1);
    expect(engine.startOptions[0]).toMatchObject({
      repairPrematureDmSentOnce: true,
    });
  });

  it('answers own-address membership from the group list first', () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    expect(engine.startOptions[0]).toMatchObject({
      ownMembershipLocalFirst: true,
      trackOwnPostDelivery: true,
    });
  });

  it('times Python events from their stamps for Copy diagnostics', async () => {
    startWithSocket();
    vi.setSystemTime(5_000);
    sendFrame(frame('reticulum_chat_message', {}));
    // No write stamp: nothing to measure.
    sendFrame({ type: 'event', event: 'reticulum_chat_message', payload: {} });
    const health = await rpcCall('debug:sync-health', [{ sentAt: 4_990 }]);
    expect(health.bridgeEvents.toWorker).toMatchObject({ n: 1, max: 3_960 });
    expect(health.bridgeEvents.toWorkerRecent).toMatchObject({ n: 1 });
    expect(health.bridgeEvents.pythonQueue).toMatchObject({ n: 1, max: 40 });
    expect(health.rpcQueueMs).toBe(10);
    // Routing to the engine is unchanged.
    expect(engine.dispatched).toHaveLength(2);
  });

  it('turns on own post delivery tracking and forwards its proofs', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    engine.manager = {
      on: vi.fn((name: string, fn: (payload: unknown) => void) => {
        listeners.set(name, fn);
      }),
    };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    expect(engine.startOptions[0]).toMatchObject({
      trackOwnPostDelivery: true,
    });
    const payload = {
      updates: [
        {
          eventId: 'event-1',
          scope: 'group',
          groupId: 7,
          channelId: 'general',
          memberAt: 1_000,
        },
      ],
    };
    expect(listeners.has('ownPostDelivery')).toBe(true);
    listeners.get('ownPostDelivery')!(payload);
    expect(self.postMessage).toHaveBeenCalledWith({
      t: 'evt',
      channel: 'reticulumChat:ownPostDelivery',
      payload,
    });
  });
});

describe('overlay usability and subscription replays', () => {
  function makeGroupManager(initialGroups: number[] = []) {
    const subscribed = new Set(initialGroups);
    return {
      on: vi.fn(),
      notifyOverlayHealthChanged: vi.fn(),
      reannounceSubscriptions: vi.fn(),
      getSubscriptions: vi.fn(() => [...subscribed].sort((a, b) => a - b)),
      subscribeGroup: vi.fn((groupId: number) => {
        subscribed.add(groupId);
      }),
    };
  }

  const start = (manager: ReturnType<typeof makeGroupManager>) => {
    engine.manager = manager;
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
  };
  const engineHealth = () =>
    (engine.startOptions[0].hasGoodOverlayHealth as () => boolean)();
  const setAdmittedLink = (available: boolean) => {
    engine.admittedLink = available;
    engine.bridge.emit('overlay-availability', { available });
  };
  let rpcId = 0;
  const openChat = (groupId: number) =>
    handleMainMessage({
      t: 'rpc',
      id: ++rpcId,
      method: 'subscribeGroup',
      args: [groupId],
    });

  it('stays unhealthy on a presence snapshot alone, and recovers on the first admitted link', () => {
    const m = makeGroupManager([5]);
    start(m);
    // Saved endpoints make the main thread's snapshot "healthy" at once.
    handleMainMessage({
      t: 'presence-state',
      healthy: true,
      peers: [{ destinationHash: 'a'.repeat(32), lastSeen: 1 }],
      leases: [],
    });
    vi.advanceTimersByTime(5_000);
    expect(engineHealth()).toBe(false);
    expect(m.notifyOverlayHealthChanged).not.toHaveBeenCalled();
    expect(m.reannounceSubscriptions).not.toHaveBeenCalled();

    setAdmittedLink(true);
    expect(engineHealth()).toBe(true);
    vi.advanceTimersByTime(0);
    expect(m.notifyOverlayHealthChanged).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(1_500);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(1);

    setAdmittedLink(false);
    expect(engineHealth()).toBe(false);
  });

  it('does not replay every subscription when an already subscribed chat opens', () => {
    const m = makeGroupManager([5]);
    start(m);
    setAdmittedLink(true);
    vi.advanceTimersByTime(2_000);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(1);

    openChat(5);
    vi.advanceTimersByTime(2_000);
    openChat(5);
    vi.advanceTimersByTime(2_000);
    expect(m.subscribeGroup).toHaveBeenCalledTimes(2);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(1);

    // A newly joined group still gets the full replay.
    openChat(6);
    vi.advanceTimersByTime(2_000);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('lets one chat open replay after a link flap skipped the recovery replay', () => {
    const m = makeGroupManager([5]);
    start(m);
    setAdmittedLink(true);
    vi.advanceTimersByTime(2_000);
    setAdmittedLink(false);
    setAdmittedLink(true);
    vi.advanceTimersByTime(2_000);
    // Recovery replays are at least 30 s apart.
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(1);

    openChat(5);
    vi.advanceTimersByTime(2_000);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(2);
    openChat(5);
    vi.advanceTimersByTime(2_000);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('replays on a membership change, not when the same groups are re-applied', () => {
    const m = {
      ...makeGroupManager([5]),
      setLocalGroupMemberships: vi.fn(),
    };
    start(m);
    setAdmittedLink(true);
    vi.advanceTimersByTime(2_000);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(1);
    const applyMemberships = (groups: Array<{ groupId: number }>) => {
      handleMainMessage({
        t: 'rpc',
        id: ++rpcId,
        method: 'setLocalGroupMemberships',
        args: [groups],
      });
      vi.advanceTimersByTime(2_000);
    };

    // The first list since start counts as a change.
    applyMemberships([{ groupId: 5 }]);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(2);
    applyMemberships([{ groupId: 5 }]);
    applyMemberships([{ groupId: 5 }]);
    expect(m.setLocalGroupMemberships).toHaveBeenCalledTimes(3);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(2);

    applyMemberships([{ groupId: 6 }, { groupId: 5 }]);
    expect(m.reannounceSubscriptions).toHaveBeenCalledTimes(3);
  });

  it('sends no replay while no link is admitted', () => {
    const m = makeGroupManager([5]);
    start(m);
    openChat(5);
    openChat(6);
    vi.advanceTimersByTime(5_000);
    expect(m.subscribeGroup).toHaveBeenCalledTimes(2);
    expect(m.reannounceSubscriptions).not.toHaveBeenCalled();
  });
});

const OWN = 'QfdpbaGasRtFSYyFu73xsnghgXHcRYrLTP';
const OTHER = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';

describe('membership validator diagnostics', () => {
  it('counts own-address requests and merges the engine own-membership counters', async () => {
    engine.manager = {
      on: vi.fn(),
      localGroupAddresses: new Map([[7, OWN]]),
      getLocalDmAddresses: () => [OWN],
      getDeliveryCounters: () => ({
        ownMembershipLocalAnswer: 5,
        ownMembershipBootWaitTimeout: 1,
      }),
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const rows = (JSON.parse(String(init.body)) as string[]).map((a) => ({
        address: a,
        isMember: true,
        isAdmin: false,
      }));
      return { ok: true, status: 200, json: async () => rows };
    });
    vi.stubGlobal('fetch', fetchMock);
    // The boot config already says whether a key is set: no config hold.
    startEngine({ apiBase: 'http://127.0.0.1:12391', apiKeyConfigured: false });
    const validate = engine.startOptions[0].validateGroupMember as (
      groupId: number,
      address: string
    ) => Promise<boolean | null>;
    const ownCheck = validate(7, OWN);
    await vi.advanceTimersByTimeAsync(15);
    await expect(ownCheck).resolves.toBe(true);
    const otherCheck = validate(7, OTHER);
    await vi.advanceTimersByTimeAsync(15);
    await expect(otherCheck).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 2,
      unavailableCount: 0,
      ownCount: 1,
      ownUnavailableCount: 0,
      ownListAnswers: 5,
      ownBootWaits: 0,
      ownBootWaitTimeouts: 1,
      ownCoreDenied: 0,
      maxInFlight: 1,
    });
    expect(Array.isArray(snapshot.validator.recentNetworkMs)).toBe(true);
  });

  it('counts concurrent checks and keeps going without engine counters', async () => {
    engine.manager = { on: vi.fn() };
    const answers: Array<() => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((resolve) => {
            answers.push(() =>
              resolve({
                ok: true,
                status: 200,
                json: async () => [
                  {
                    address: JSON.parse(String(init.body))[0],
                    isMember: false,
                    isAdmin: false,
                  },
                ],
              })
            );
          })
      )
    );
    startEngine({ apiBase: 'http://127.0.0.1:12391', apiKeyConfigured: false });
    const validate = engine.startOptions[0].validateGroupMember;
    // Three groups: three requests, one per group.
    const checks = [validate(7, OWN), validate(8, OWN), validate(9, OTHER)];
    await vi.advanceTimersByTimeAsync(15);
    for (const answer of answers) answer();
    await expect(Promise.all(checks)).resolves.toEqual([false, false, false]);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 3,
      ownCount: 0,
      maxInFlight: 3,
      ownListAnswers: 0,
    });
  });
});

describe('membership validator batching', () => {
  /** Distinct valid-looking test addresses (Core is mocked). */
  const addr = (i: number) => `QBatchAuthor${String(i).padStart(22, '0')}`;
  type Call = {
    url: string;
    body: string[];
    answer: (status?: number) => void;
  };
  /** Lets the promise chains behind an answer run (no timers move). */
  const settle = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  };
  const groupsAsked = (calls: Call[]) =>
    calls.map((call) => call.url.split('/')[5]);

  /** A fetch whose answers the test releases; rows say member for everyone. */
  function heldFetch() {
    const calls: Call[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(
      (url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const body = JSON.parse(String(init.body)) as string[];
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          init.signal?.addEventListener('abort', () => {
            inFlight -= 1;
            reject(new DOMException('aborted', 'AbortError'));
          });
          let answered = false;
          calls.push({
            url,
            body,
            answer: (status = 200) => {
              if (answered) return;
              answered = true;
              inFlight -= 1;
              resolve({
                ok: status >= 200 && status < 300,
                status,
                json: async () =>
                  body.map((address) => ({
                    address,
                    isMember: true,
                    isAdmin: false,
                  })),
              });
            },
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    return { calls, fetchMock, maxInFlight: () => maxInFlight };
  }

  const start = (config: Record<string, unknown> = {}) => {
    engine.manager = { on: vi.fn() };
    startEngine({
      apiBase: 'http://127.0.0.1:12391',
      apiKeyConfigured: false,
      ...config,
    });
    return engine.startOptions[0].validateGroupMember as (
      groupId: number,
      address: string
    ) => Promise<boolean | null>;
  };

  it('sends 30 concurrent checks for one group as one request', async () => {
    const held = heldFetch();
    const validate = start();
    const checks = Array.from({ length: 30 }, (_, i) => validate(7, addr(i)));
    // Repeats while the first ones are out share their request.
    checks.push(validate(7, addr(0)), validate(7, addr(29)));
    await vi.advanceTimersByTimeAsync(15);
    expect(held.fetchMock).toHaveBeenCalledTimes(1);
    expect(held.calls[0].url).toBe(
      'http://127.0.0.1:12391/groups/members/7/validate'
    );
    expect(held.calls[0].body).toEqual(
      Array.from({ length: 30 }, (_, i) => addr(i))
    );
    held.calls[0].answer();
    await expect(Promise.all(checks)).resolves.toEqual(
      new Array(32).fill(true)
    );
    // Cached per address afterwards.
    await expect(validate(7, addr(3))).resolves.toBe(true);
    expect(held.fetchMock).toHaveBeenCalledTimes(1);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 30,
      unavailableCount: 0,
      requestCount: 1,
      maxBatchSize: 30,
      maxInFlight: 1,
    });
  });

  it('keeps at most 3 requests out and merges checks that arrive meanwhile', async () => {
    const held = heldFetch();
    const validate = start();
    const checks: Array<Promise<boolean | null>> = [];
    for (let group = 1; group <= 6; group += 1) {
      checks.push(validate(group, addr(group)));
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(groupsAsked(held.calls)).toEqual(['1', '2', '3']);
    // Group 1's request is out: these wait for it and then go together.
    checks.push(validate(1, addr(100)), validate(1, addr(101)));
    await vi.advanceTimersByTimeAsync(50);
    expect(held.calls).toHaveLength(3);
    held.calls[0].answer();
    await settle();
    // The freed slot goes to the oldest waiting group, not the latecomers.
    expect(groupsAsked(held.calls)).toEqual(['1', '2', '3', '4']);
    for (const i of [1, 2, 3]) {
      held.calls[i].answer();
      await settle();
    }
    expect(groupsAsked(held.calls)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '1',
    ]);
    expect(held.calls[6].body).toEqual([addr(100), addr(101)]);
    for (const call of held.calls) call.answer();
    await expect(Promise.all(checks)).resolves.toEqual(new Array(8).fill(true));
    expect(held.maxInFlight()).toBe(3);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 8,
      requestCount: 7,
      maxInFlight: 3,
    });
  });

  it('asks again at once when a worker stall cut the request', async () => {
    const held = heldFetch();
    const validate = start();
    const check = validate(7, OTHER);
    await vi.advanceTimersByTimeAsync(15);
    expect(held.calls).toHaveLength(1);
    // The worker freezes for 400 s; Core's answer would have come in time.
    vi.setSystemTime(Date.now() + 400_000);
    await vi.advanceTimersByTimeAsync(12_000);
    // The late abort timer re-arms once (grace), then aborts.
    await vi.advanceTimersByTimeAsync(1_500);
    await settle();
    expect(held.calls).toHaveLength(2);
    expect(held.calls[1].body).toEqual([OTHER]);
    held.calls[1].answer();
    await expect(check).resolves.toBe(true);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 1,
      unavailableCount: 0,
      requestCount: 2,
      timedOutCount: 1,
      gracedCount: 1,
      failByReason: { stall_abort: 1 },
    });
    expect(snapshot.validator.recentFailures).toEqual([
      expect.objectContaining({ reason: 'stall_abort', addresses: 1 }),
    ]);
    // The follow-up answered: no fault line for the boot buffer.
    const { getRecentLogs } = await import('./shims/logger');
    expect(
      getRecentLogs().filter((l) => l.includes('membership_fetch_failed'))
    ).toEqual([]);
  });

  it('sends nothing before the main thread pushes the node, and then to that node', async () => {
    const held = heldFetch();
    // Boot base before getApiKey answered: the public node.
    const validate = start({
      apiBase: 'https://ext-node.qortal.link',
      apiKeyConfigured: null,
    });
    const check = validate(7, OTHER);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(held.fetchMock).not.toHaveBeenCalled();
    handleMainMessage({
      t: 'config',
      config: { apiBase: 'http://127.0.0.1:12391', apiKeyConfigured: true },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(held.calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:12391/groups/members/7/validate',
    ]);
    held.calls[0].answer();
    await expect(check).resolves.toBe(true);
  });

  it('stops holding checks 3 s after boot when no config arrives', async () => {
    const held = heldFetch();
    const validate = start({ apiKeyConfigured: null });
    const check = validate(7, OTHER);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(held.fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(held.fetchMock).toHaveBeenCalledTimes(1);
    held.calls[0].answer();
    await expect(check).resolves.toBe(true);
  });

  it('splits a list Core refused with 400 into single requests', async () => {
    const bad = 'not-an-address';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as string[];
      if (body.includes(bad)) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 102, message: 'invalid address' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          body.map((address) => ({ address, isMember: true, isAdmin: false })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const validate = start();
    const checks = [validate(7, OWN), validate(7, bad), validate(7, OTHER)];
    await vi.advanceTimersByTimeAsync(15);
    await expect(Promise.all(checks)).resolves.toEqual([true, null, true]);
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)))
    ).toEqual([[OWN, bad, OTHER], [OWN], [bad], [OTHER]]);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 2,
      unavailableCount: 1,
      requestCount: 4,
      failByReason: { 'http:400': 2 },
    });
    // One fault line, for the address that stayed unknown, not for the
    // list the singles answered.
    const { getRecentLogs } = await import('./shims/logger');
    const lines = getRecentLogs().filter((l) =>
      l.includes('membership_fetch_failed')
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/reason=http:400 host=\S+ addresses=1$/);
  });

  it('stops a split when the node itself fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return { ok: false, status: 400, json: async () => ({}) };
        }
        throw new TypeError('Failed to fetch');
      })
    );
    const validate = start();
    const checks = [validate(7, OWN), validate(7, OTHER), validate(7, addr(1))];
    await vi.advanceTimersByTimeAsync(15);
    await expect(Promise.all(checks)).resolves.toEqual([null, null, null]);
    expect(call).toBe(2);
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      okCount: 0,
      unavailableCount: 3,
      failByReason: { 'http:400': 1, network: 1, split_stopped: 1 },
    });
  });

  it('answers unknown at once when the queue is full', async () => {
    const held = heldFetch();
    // Held by the boot config wait: nothing leaves the queue.
    const validate = start({ apiKeyConfigured: null });
    const checks: Array<Promise<boolean | null>> = [];
    for (let i = 0; i < 512; i += 1) {
      checks.push(validate(1 + (i % 20), addr(i)));
    }
    await expect(validate(99, addr(9_999))).resolves.toBeNull();
    expect(held.fetchMock).not.toHaveBeenCalled();
    const snapshot = await rpcCall('debug:diagnostics');
    expect(snapshot.validator).toMatchObject({
      unavailableCount: 1,
      failByReason: { queue_full: 1 },
    });
    handleMainMessage({ t: 'config', config: { apiKeyConfigured: false } });
    await vi.advanceTimersByTimeAsync(15);
    for (let round = 0; round < 30; round += 1) {
      for (const pending of held.calls) pending.answer();
      await settle();
    }
    expect(held.calls).toHaveLength(20);
    expect(held.maxInFlight()).toBe(3);
    await expect(Promise.all(checks)).resolves.toEqual(
      new Array(512).fill(true)
    );
  });
});

describe('worker->native accounting', () => {
  const startWithSocket = () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    connect();
    latestSocket().accept();
  };
  const sendFrame = (frame: Record<string, unknown>) =>
    latestSocket().onmessage?.({ data: JSON.stringify(frame) });

  it('counts a reply after its timeout as late, not as a round trip', async () => {
    startWithSocket();
    const p = engine
      .sendCommand('prepare_reticulum_resource_session', {}, 1_000)
      .catch((e: Error) => e);
    expect(JSON.parse(latestSocket().sent[0])).toMatchObject({
      type: 'cmd',
      id: 'w-1',
      action: 'prepare_reticulum_resource_session',
    });
    vi.advanceTimersByTime(6_000);
    expect((await p).message).toMatch(
      /worker->native request timed out: prepare_reticulum_resource_session/
    );
    sendFrame({ type: 'resp', id: 'w-1', ok: true });
    // The main thread's own command replies are not ours.
    sendFrame({ type: 'resp', id: 'cmd-abc', ok: true });
    let health = await rpcCall('debug:sync-health', [{ sentAt: Date.now() }]);
    expect(health.native).toMatchObject({
      pending: 0,
      timeouts: 1,
      lateReplies: 1,
      unmatchedReplies: 0,
      lostOnClose: 0,
      rtt: null,
    });
    expect(health.native.byLabel[0]).toMatchObject({
      label: 'prepare_reticulum_resource_session',
      timeouts: 1,
      late: 1,
    });

    const answered = engine.sendCommand('send_reticulum_chat', {}, 1_000);
    vi.advanceTimersByTime(200);
    sendFrame({ type: 'resp', id: 'w-2', ok: true });
    await expect(answered).resolves.toMatchObject({ id: 'w-2', ok: true });
    health = await rpcCall('debug:sync-health', [{ sentAt: Date.now() }]);
    expect(health.native.rtt).toMatchObject({ n: 1, max: 200 });

    const waiting = engine
      .sendCommand('send_reticulum_chat', {}, 1_000)
      .catch((e: Error) => e);
    vi.advanceTimersByTime(300);
    health = await rpcCall('debug:sync-health', [{ sentAt: Date.now() }]);
    expect(health.native.pending).toBe(1);
    expect(health.native.oldestPending).toEqual([
      { label: 'send_reticulum_chat', count: 1, oldestMs: 300 },
    ]);
    latestSocket().drop();
    expect((await waiting).message).toBe('bridge socket closed');
    health = await rpcCall('debug:sync-health', [{ sentAt: Date.now() }]);
    expect(health.native).toMatchObject({ pending: 0, lostOnClose: 1 });
    expect(health.native.rtt.n).toBe(1);
  });

  it('accounts main-thread relay requests and their late replies', async () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    const posted = () =>
      (self.postMessage as unknown as { mock: { calls: any[][] } }).mock.calls
        .map((call) => call[0])
        .filter((msg: any) => msg?.t === 'cmd');
    const late = engine
      .sendCommand('send_reticulum_chat', {}, 1_000)
      .catch((e: Error) => e);
    const lateId = posted()[0].id;
    vi.advanceTimersByTime(6_000);
    expect((await late).message).toMatch(
      /worker->main request timed out: send_reticulum_chat/
    );
    handleMainMessage({ t: 'cmdres', id: lateId, frame: { ok: true } });
    const quick = engine.sendCommand('ensure_peer_identity', {}, 1_000);
    const quickId = posted()[1].id;
    vi.advanceTimersByTime(50);
    handleMainMessage({ t: 'cmdres', id: quickId, frame: { ok: true } });
    await expect(quick).resolves.toEqual({ ok: true });
    // A reply for an id that never existed.
    handleMainMessage({ t: 'nativefsres', id: 999, result: {} });
    const health = await rpcCall('debug:sync-health', [{ sentAt: 1 }]);
    expect(health.native).toMatchObject({
      timeouts: 1,
      lateReplies: 1,
      unmatchedReplies: 1,
    });
    expect(health.native.rtt).toMatchObject({ n: 1, max: 50 });
  });
});

describe('debug:sync-health', () => {
  it('returns the engine diagnostics, top counters and log counts', async () => {
    vi.setSystemTime(100_000);
    const scanner = { runsSinceBoot: 3 };
    const digestQueues = { repair: { queued: 2 } };
    const queues = { historyServeQueue: 4, relayGroupControl: false };
    engine.manager = {
      on: vi.fn(),
      getAuthorGapScannerDiagnostics: vi.fn(() => scanner),
      getDigestQueueDiagnostics: vi.fn(() => digestQueues),
      getEngineQueueDiagnostics: vi.fn(() => queues),
      getDeliveryCounters: () => ({
        providerAuthEnded: 2,
        ownMembershipLocalAnswer: 9,
        neverHappened: 0,
        odd: 'x',
      }),
    };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    vi.setSystemTime(100_500);
    const health = await rpcCall('debug:sync-health', [
      { sentAt: Date.now() - 50 },
    ]);
    expect(health).toMatchObject({
      at: 100_500,
      rpcQueueMs: 50,
      workerStartedAt: 100_000,
      loop: { installed: false, lag: null },
      native: { pending: 0, timeouts: 0 },
      serving: null,
      engine: { scanner, digestQueues, queues },
      log: { bootFaultOverflow: 0 },
    });
    expect(Object.entries(health.engine.counters)).toEqual([
      ['ownMembershipLocalAnswer', 9],
      ['providerAuthEnded', 2],
    ]);
    expect(Array.isArray(health.log.keyCounts)).toBe(true);
    expect(health.engineError).toBeUndefined();
  });

  it('keeps the top 40 counters and reports a sent time it cannot read as null', async () => {
    const counters: Record<string, number> = {};
    for (let i = 1; i <= 45; i++) counters[`k${i}`] = i;
    engine.manager = { on: vi.fn(), getDeliveryCounters: () => counters };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    const health = await rpcCall('debug:sync-health', [{ sentAt: 'soon' }]);
    expect(health.rpcQueueMs).toBeNull();
    const keys = Object.keys(health.engine.counters);
    expect(keys).toHaveLength(40);
    expect(keys[0]).toBe('k45');
    expect(keys).not.toContain('k5');
    // An older engine without the new getters: their parts are null.
    expect(health.engine).toMatchObject({
      scanner: null,
      digestQueues: null,
      queues: null,
    });
    expect(await rpcCall('debug:sync-health')).toMatchObject({
      rpcQueueMs: null,
    });
  });

  it('reports the first failing getter and still fills the others', async () => {
    engine.manager = {
      on: vi.fn(),
      getAuthorGapScannerDiagnostics: () => {
        throw new Error('boom at https://node.example/x?apiKey=SECRET');
      },
      getDigestQueueDiagnostics: () => {
        throw new Error('second');
      },
      getEngineQueueDiagnostics: () => ({ historyServeQueue: 1 }),
      getDeliveryCounters: () => ({ a: 1 }),
    };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    const health = await rpcCall('debug:sync-health', [{ sentAt: 1 }]);
    expect(health.engineError).toBe(
      'getAuthorGapScannerDiagnostics: boom at <url>'
    );
    expect(health.engine).toEqual({
      scanner: null,
      digestQueues: null,
      queues: { historyServeQueue: 1 },
      counters: { a: 1 },
    });
  });

  it('says engine null when no manager runs, and passes the bridge serving stats', async () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    const serving = { byType: {}, waiting: 2 };
    engine.bridge.getServingStats = vi.fn(() => serving);
    expect((await rpcCall('debug:sync-health')).serving).toEqual(serving);
    engine.bridge.getServingStats = () => {
      throw new Error('nope');
    };
    expect((await rpcCall('debug:sync-health')).serving).toBeNull();
    engine.manager = undefined;
    const health = await rpcCall('debug:sync-health');
    expect(health.engine).toBeNull();
    expect(health.engineError).toBeUndefined();
  });
});

describe('Python stall watchdog events', () => {
  const startWithSocket = () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    connect();
    latestSocket().accept();
  };
  const sendFrame = (frame: Record<string, unknown>) =>
    latestSocket().onmessage?.({ data: JSON.stringify(frame) });

  it('logs one summary line through the engine logger and keeps the stacks out', async () => {
    const { getRecentLogs, getBootFaultLogs } = await import('./shims/logger');
    startWithSocket();
    sendFrame({
      type: 'event',
      event: 'bridge_stall_diagnostic',
      _writeAtMs: 1,
      payload: {
        executorStalled: true,
        executorIdleSeconds: 21.3,
        cmdQueueDepth: 40,
        cmdQueueMax: 256,
        threadCount: 63,
        stuckLanes: [
          {
            lane: 'control-send',
            task: 'cmd:send_reticulum_chat',
            seconds: 31.2,
            queueDepth: 12,
          },
        ],
        stacks: { t1: 'TRACE' },
      },
    });
    expect(engine.dispatched).toEqual([]);
    const lines = getRecentLogs().filter((l) =>
      l.includes('bridge_stall_diagnostic')
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /warn \[MobileChat\] bridge_stall_diagnostic executor_stalled=true executor_idle_s=21.3 cmd_q=40\/256 threads=63 stuck=control-send:cmd:send_reticulum_chat:31.2s:q12$/
    );
    expect(lines[0]).not.toContain('TRACE');
    // A fault line, so it is kept from boot on.
    expect(
      getBootFaultLogs().some((l) => l.includes('bridge_stall_diagnostic'))
    ).toBe(true);
    // The stacks still go to the console for remote devtools.
    expect(console.warn).toHaveBeenCalledWith(
      '[MobileChat] bridge_stall_diagnostic thread=t1\nTRACE'
    );
  });

  it('logs relayed watchdog events and does not hand them to the engine', async () => {
    const { getRecentLogs } = await import('./shims/logger');
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    handleMainMessage({
      t: 'pyevent',
      event: 'bridge_thread_population',
      payload: { threadCount: 63, totalCpuTicks: 120 },
    });
    expect(engine.dispatched).toEqual([]);
    expect(
      getRecentLogs().some((l) =>
        /warn \[MobileChat\] bridge_thread_population threads=63 cpu_total=120 cpu_top= groups_top=$/.test(
          l
        )
      )
    ).toBe(true);
  });

  it('summarizes each watchdog event in one line', () => {
    expect(
      summarizeBridgeDiagnosticEvent('bridge_executor_recovered', {
        error: 'RuntimeError:\n  executor   died',
      })
    ).toBe('error=RuntimeError: executor died');
    expect(
      summarizeBridgeDiagnosticEvent('bridge_thread_population', {
        threadCount: 63.4,
        totalCpuTicks: 1200,
        cpuTicksByGroup: [
          { name: 'rns', ticks: 800 },
          { name: 'bridge', ticks: 400 },
        ],
        groups: [{ name: 'Thread', count: 40 }],
      })
    ).toBe(
      'threads=63 cpu_total=1200 cpu_top=rns:800,bridge:400 groups_top=Thread:40'
    );
    expect(
      summarizeBridgeDiagnosticEvent('bridge_stall_diagnostic', {
        executorStalled: false,
        stuckLanes: Array.from({ length: 8 }, (_, i) => ({
          lane: `l${i}`,
          task: 'x'.repeat(60),
          seconds: 2,
        })),
      }).split(',')
    ).toHaveLength(6);
    // Lane task names keep their kind, never the ids some names carry.
    expect(
      summarizeBridgeDiagnosticEvent('bridge_stall_diagnostic', {
        stuckLanes: [
          { lane: 'a', task: 'overlay-open:announce:1a2b3c4d', seconds: 1 },
          { lane: 'b', task: 'rns-packet:data:0f1e2d3c4b5a6978', seconds: 1 },
          { lane: 'c', task: 'presence:4f3a2b1c9d8e:deadbeef', seconds: 1 },
          { lane: 'd', task: 'audio-send:9a8b7c6d5e4f', seconds: 1 },
          { lane: 'e', task: '1a2b3c4d5e6f:cmd', seconds: 1 },
          { lane: 'f', task: 'land-state-forward-3', seconds: 1 },
        ],
      })
    ).toBe(
      'executor_stalled=false executor_idle_s=0 cmd_q=0/0 threads=0 stuck=' +
        'a:overlay-open:announce:1s:q0,b:rns-packet:data:1s:q0,' +
        'c:presence:1s:q0,d:audio-send:1s:q0,e:task:cmd:1s:q0,' +
        'f:land-state-forward-3:1s:q0'
    );
    expect(
      summarizeBridgeDiagnosticEvent('bridge_stall_diagnostic', null)
    ).toBe(
      'executor_stalled=false executor_idle_s=0 cmd_q=0/0 threads=0 stuck=none'
    );
    expect(
      summarizeBridgeDiagnosticEvent('bridge_executor_recovered', {})
    ).toBe('error=');
    // Values an exception can carry never reach the line.
    const scrubbed = (error: string) =>
      summarizeBridgeDiagnosticEvent('bridge_executor_recovered', { error });
    expect(
      scrubbed("b'\\x8a\\x1f\\xc3\\x07\\x99\\x10\\xab\\xcd\\xef\\x01\\x23'")
    ).toBe('error=<bytes>');
    expect(scrubbed('\\x8a\\x1f\\xc3 at offset 3')).toBe(
      'error=<bytes> at offset 3'
    );
    expect(scrubbed("'NoneType' object has no attribute 'dest_hash'")).toBe(
      "error='NoneType' object has no attribute 'dest_hash'"
    );
    expect(scrubbed("'QgK7m4Wq1zYb2XcVdEfGhJkLmNoPqRsTu1' left")).toBe(
      "error='…' left"
    );
    expect(scrubbed('peer 8a1fc30799 missing, said "hello there"')).toBe(
      'error=peer <hex> missing, said "…"'
    );
    expect(scrubbed('lost Qabcdefghijkmnopqrstuvwxyz12345 at 1760184000')).toBe(
      'error=lost <address> at <n>'
    );
    expect(
      summarizeBridgeDiagnosticEvent('bridge_thread_population', 'x')
    ).toBe('threads=0 cpu_total=0 cpu_top= groups_top=');
  });
});

describe('debug:sync-health diagnostics additions', () => {
  it('adds channels, database, focus counters, RPC time and log folding', async () => {
    const channels = { subscribedGroups: 1, groups: [{ groupId: 694 }] };
    const db = { sizeBytes: 4_096, events: 3, searchRows: 2, countedAt: 1 };
    engine.manager = {
      on: vi.fn(),
      getDeliveryCounters: () => ({
        membershipDeferred: 4,
        membershipNullFromBackoff: 0,
        providerAuthSkipped_live_event_entry: 2,
        localImportFailure: 1,
        unrelated: 9,
      }),
      getChannelMetadataDiagnostics: vi.fn(() => channels),
      getStorageDiagnostics: vi.fn(() => db),
    };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    await rpcCall('debug:logs');
    const health = await rpcCall('debug:sync-health', [{ sentAt: 1 }]);
    expect(health.engine.channels).toEqual(channels);
    expect(health.engine.db).toEqual(db);
    expect(health.engine.focusCounters).toEqual({
      membershipDeferred: 4,
      providerAuthSkipped_live_event_entry: 2,
      localImportFailure: 1,
    });
    expect(health.log.bootFaultRepeatsFolded).toBe(0);
    // The RPC before this one was timed.
    expect(health.io.rpc.methods.map((m: any) => m.method)).toContain(
      'debug:logs'
    );
    // No OPFS sync handles under jsdom: the probe says so.
    expect(health.io.flush.installed).toBe(false);
    // The node fs module has no handle pool: no storage line.
    expect(health.storage).toBeNull();
    expect(health.pythonCpuStacks).toBeNull();
  });

  it('reports a getter that throws and leaves the others filled', async () => {
    engine.manager = {
      on: vi.fn(),
      getDeliveryCounters: () => ({}),
      getChannelMetadataDiagnostics: () => {
        throw new Error('channels broke');
      },
      getStorageDiagnostics: () => ({ sizeBytes: 1 }),
    };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    const health = await rpcCall('debug:sync-health');
    expect(health.engineError).toBe(
      'getChannelMetadataDiagnostics: channels broke'
    );
    expect(health.engine.channels).toBeNull();
    expect(health.engine.db).toEqual({ sizeBytes: 1 });
    expect(health.engine.focusCounters).toBeUndefined();
  });

  it('reads the fs shim pool stats when the worker has them', async () => {
    const stats = { files: 3, spares: 4 };
    vi.resetModules();
    vi.doMock('fs', async (importOriginal) => ({
      ...(await importOriginal<typeof import('fs')>()),
      getMobileFsStats: () => stats,
    }));
    try {
      const host = await import('./engineHost');
      engine.manager = { on: vi.fn() };
      host.startEngine({ apiBase: 'http://127.0.0.1:12391' });
      const id = ++nextRpcCallId;
      host.handleMainMessage({ t: 'rpc', id, method: 'debug:sync-health' });
      await vi.advanceTimersByTimeAsync(0);
      const reply = (
        self.postMessage as unknown as { mock: { calls: any[][] } }
      ).mock.calls
        .map((call) => call[0])
        .find((msg) => msg?.t === 'rpcres' && msg.id === id);
      expect(reply.value.storage).toEqual(stats);
      host.handleMainMessage({ t: 'stop' });
    } finally {
      vi.doUnmock('fs');
    }
  });

  it('keeps the top frames of Python CPU samples, never code or paths', async () => {
    engine.manager = { on: vi.fn() };
    startEngine({ apiBase: 'http://127.0.0.1:12391' });
    connect();
    latestSocket().accept();
    latestSocket().onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: 'bridge_thread_population',
        payload: {
          threadCount: 63,
          totalCpuTicks: 340,
          cpuTicksByGroup: [{ name: 'Thread (__job)', ticks: 210 }],
          stacks: {
            'Thread (__job)':
              '  File "/data/user/0/app/files/chaquopy/RNS/Transport.py", line 1, in loop\n    secret = 1\n',
            'Thread (__job)#cpu1':
              '  File "/data/user/0/app/files/chaquopy/RNS/Transport.py", line 1234, in inbound\n    peer_hash = "QRj9ttCJoCmV4kb9GxSHP75ZQWWi7LqPQG"\n  File "/data/user/0/app/files/chaquopy/RNS/Packet.py", line 88, in unpack\n    x = 1\n',
          },
        },
      }),
    });
    const health = await rpcCall('debug:sync-health');
    expect(health.pythonCpuStacks).toMatchObject({
      totalCpuTicks: 340,
      cpuTicksByGroup: [{ name: 'Thread (__job)', ticks: 210 }],
      samples: [
        {
          group: 'Thread (__job)',
          frames: ['unpack (Packet.py:88)', 'inbound (Transport.py:1234)'],
        },
      ],
    });
    const text = JSON.stringify(health.pythonCpuStacks);
    expect(text).not.toContain('/data/');
    expect(text).not.toContain('QRj9tt');
    expect(text).not.toContain('secret');
  });

  it('logs membership fetch failures at most once a minute per reason', async () => {
    const { getRecentLogs, getBootFaultLogs } = await import('./shims/logger');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    engine.manager = { on: vi.fn() };
    startEngine({
      apiBase: 'http://node.example.com:12391',
      apiKeyConfigured: false,
    });
    const validate = engine.startOptions[0].validateGroupMember as (
      groupId: number,
      address: string
    ) => Promise<boolean | null>;
    const lines = () =>
      getRecentLogs().filter((l) => l.includes('membership_fetch_failed'));
    await Promise.all([
      validate(7, 'QAddressA0000000000000000000000000'),
      vi.advanceTimersByTimeAsync(20),
    ]);
    await Promise.all([
      validate(8, 'QAddressB0000000000000000000000000'),
      vi.advanceTimersByTimeAsync(20),
    ]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      /warn \[MobileChat\] membership_fetch_failed reason=network host=node\.example\.com:12391 addresses=1$/
    );
    expect(
      getBootFaultLogs().some((l) => l.includes('membership_fetch_failed'))
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([
      validate(9, 'QAddressC0000000000000000000000000'),
      vi.advanceTimersByTimeAsync(20),
    ]);
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toMatch(/addresses=1 suppressed=1$/);
  });
});
