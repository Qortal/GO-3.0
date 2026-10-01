import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine, resource store and wire bridge are heavy (fs/sqlite on load);
// these tests only drive the worker message router and the bridge socket.
const engine = vi.hoisted(() => ({ manager: undefined as any }));

vi.mock('../../../electron/src/reticulum-chat', () => ({
  startReticulumChatManager: vi.fn(() => engine.manager),
  stopReticulumChatManager: vi.fn(),
  getReticulumChatManager: () => engine.manager,
}));
vi.mock('../../../electron/src/reticulum-resource-store', () => ({
  ReticulumResourceStore: class {},
}));
vi.mock('./wireBridge', () => ({
  MobileReticulumBridge: class {
    on(): void {}
    markStopped(): void {}
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
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
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

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(self, 'postMessage').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  engine.manager = makeManager();
  ({ handleMainMessage, startEngine } = await import('./engineHost'));
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
