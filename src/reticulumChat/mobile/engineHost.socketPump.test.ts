import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real wire bridge behind the real engine host, with the socket event
// queue on a manual scheduler: replies against the events queued before
// them, as the engine sees them. The engine itself is not loaded.
const engine = vi.hoisted(() => ({
  bridge: undefined as any,
  manager: undefined as any,
  log: [] as string[],
}));

vi.mock('../../../electron/src/reticulum-chat', () => ({
  startReticulumChatManager: vi.fn((bridge: unknown) => {
    engine.bridge = bridge;
    return engine.manager;
  }),
  stopReticulumChatManager: vi.fn(),
  getReticulumChatManager: () => engine.manager,
}));
vi.mock('../../../electron/src/reticulum-resource-store', () => ({
  ReticulumResourceStore: class {},
}));
// Staging only for its socket sweep: the one `fs` request a test can drive.
vi.mock('./resourceStaging', () => ({
  ReticulumResourceStaging: class {
    private readonly nativeFs: (
      op: string,
      args: Record<string, unknown>
    ) => Promise<unknown>;
    constructor(nativeFs: any) {
      this.nativeFs = nativeFs;
    }
    sweepStale(): Promise<boolean> {
      return this.nativeFs('sweep', { maxAgeMs: 600_000 }).then(
        () => {
          engine.log.push('sweep-done');
          return true;
        },
        () => false
      );
    }
  },
}));

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
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const PEER = 'd'.repeat(32);
const latestSocket = () =>
  FakeSocket.instances[FakeSocket.instances.length - 1];

let host: typeof import('./engineHost');
let runs: Array<() => void>;
let pump: ReturnType<
  typeof import('./engineHost').setSocketEventScheduleForTests
>;

const send = (frame: Record<string, unknown>) =>
  latestSocket().onmessage?.({ data: JSON.stringify(frame) });
const event = (name: string, payload: Record<string, unknown>) =>
  send({ type: 'event', event: name, payload });
const chatEvent = (
  wire: Record<string, unknown>,
  frameExtra: Record<string, unknown> = {}
) =>
  send({
    type: 'event',
    event: 'reticulum_chat_message',
    payload: { wire: { t: 'RCHAT', ...wire }, peerPresenceHash: PEER },
    ...frameExtra,
  });
/** The last frame of `type` (and `action`) the worker sent to native. */
const lastSent = (type: string, action?: string) => {
  const frames = latestSocket()
    .sent.map((raw) => JSON.parse(raw))
    .filter((f) => f.type === type && (!action || f.action === action));
  return frames[frames.length - 1];
};
const runAll = () => {
  while (runs.length) runs.shift()!();
};
const microtasks = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeSocket.instances = [];
  engine.log = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(self, 'postMessage').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  engine.manager = { on: vi.fn() };
  host = await import('./engineHost');
  runs = [];
  pump = host.setSocketEventScheduleForTests((run) => runs.push(run));
  host.startEngine({ apiBase: 'http://127.0.0.1:12391' });
  host.handleMainMessage({
    t: 'bridge-socket',
    url: 'ws://127.0.0.1:1234',
    token: 'tok',
  });
  latestSocket().accept();
  event('ready', { destinationHash: 'c'.repeat(32) });
  runAll();
  expect(engine.bridge.getState()).toBe('ready');
});

afterEach(() => {
  host.handleMainMessage({ t: 'stop' });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('replies settle before queued events', () => {
  it('settles a reply behind 500 event frames at once; the events follow in order, 8 ms at a time', async () => {
    const seen: number[] = [];
    let perf = 0;
    engine.bridge.on('reticulum-chat-message', (wire: any) => {
      perf += 1;
      seen.push(wire.x);
    });
    const known = engine.bridge.ensurePeerIdentityKnown(PEER);
    const cmd = lastSent('cmd', 'ensure_peer_identity');
    for (let i = 0; i < 500; i += 1) {
      chatEvent({ k: 'event_notice_v3', g: 5, x: i });
    }
    send({ type: 'resp', id: cmd.id, ok: true, payload: { source: 'known' } });
    await expect(known).resolves.toBe(true);
    expect(seen).toHaveLength(0);
    expect(pump.depth).toBe(500);
    // One slice is at most 8 ms of engine work before the next reply can run.
    vi.spyOn(performance, 'now').mockImplementation(() => perf);
    runs.shift()!();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(8);
    runAll();
    expect(seen).toEqual([...Array(500).keys()]);
    expect(pump.stats()).toMatchObject({ depth: 0, staleGossipDropped: 0 });
  });

  it('keeps a session ready that was queued before the prepare reply', async () => {
    const session = engine.bridge.ensureReticulumResourceSessionDetailed({
      peerPresenceHash: PEER,
      reticulumIdentityPublicKeyBase64: 'k',
      resourceType: 'reticulum_chat_event',
      logicalResourceType: 'reticulum_chat_author_range',
    });
    const cmd = lastSent('cmd', 'prepare_reticulum_resource_session');
    event('reticulum_resource_session', {
      status: 'ready',
      peerPresenceHash: PEER,
      lane: 'bulk',
      linkId: 'L1',
    });
    send({
      type: 'resp',
      id: cmd.id,
      ok: true,
      payload: { linkId: 'L1', lane: 'bulk', status: 'pending' },
    });
    let settled = false;
    void session.then(() => {
      settled = true;
    });
    await microtasks();
    // The reply ran first; the session waits for its queued `ready`.
    expect(settled).toBe(false);
    runAll();
    await expect(session).resolves.toEqual({ ok: true });
  });

  it('does not let an older link settle a session whose reply overtook it', async () => {
    const session = engine.bridge.ensureReticulumResourceSessionDetailed({
      peerPresenceHash: PEER,
      reticulumIdentityPublicKeyBase64: 'k',
      resourceType: 'reticulum_chat_event',
      logicalResourceType: 'reticulum_chat_author_range',
    });
    const cmd = lastSent('cmd', 'prepare_reticulum_resource_session');
    event('reticulum_resource_session', {
      status: 'ready',
      peerPresenceHash: PEER,
      lane: 'bulk',
      linkId: 'L0',
    });
    event('reticulum_resource_session', {
      status: 'failed',
      peerPresenceHash: PEER,
      lane: 'bulk',
      linkId: 'L1',
      reason: 'link_closed',
    });
    send({
      type: 'resp',
      id: cmd.id,
      ok: true,
      payload: { linkId: 'L1', lane: 'bulk', status: 'pending' },
    });
    await microtasks();
    runAll();
    await expect(session).resolves.toMatchObject({
      ok: false,
      reason: 'send-command-failed',
      error: 'link_closed',
    });
  });

  it('gives an accept its reply first, then the transfer statuses in order', async () => {
    const order: string[] = [];
    engine.bridge.on('reticulum-chat-resource', (p: any) =>
      order.push(`${p.transferId}:${p.status}`)
    );
    const accepted = engine.bridge
      .acceptReticulumChatResourceDetailed({ transferId: 'T1', linkId: 'L1' })
      .then((r: { ok: boolean }) => order.push(`accept:${r.ok}`));
    const cmd = lastSent('cmd', 'accept_reticulum_chat_resource');
    event('reticulum_chat_resource', { status: 'progress', transferId: 'T1' });
    event('reticulum_chat_resource', { status: 'received', transferId: 'T1' });
    event('reticulum_chat_resource', { status: 'progress', transferId: 'T2' });
    send({ type: 'resp', id: cmd.id, ok: true });
    await accepted;
    expect(order).toEqual(['accept:true']);
    runAll();
    expect(order).toEqual([
      'accept:true',
      'T1:progress',
      'T1:received',
      'T2:progress',
    ]);
  });

  it('settles a staging reply (fsres) before the events queued ahead of it', async () => {
    const seen: number[] = [];
    engine.bridge.on('reticulum-chat-message', (wire: any) =>
      seen.push(wire.x)
    );
    // The socket's open ran the staging sweep: one fs request is waiting.
    const fsRequest = lastSent('fs');
    expect(fsRequest).toMatchObject({ op: 'sweep' });
    for (let i = 0; i < 300; i += 1) {
      chatEvent({ k: 'event_notice_v3', g: 5, x: i });
    }
    send({ type: 'fsres', id: fsRequest.id, result: {} });
    await microtasks();
    expect(engine.log).toEqual(['sweep-done']);
    expect(seen).toHaveLength(0);
    runAll();
    expect(seen).toEqual([...Array(300).keys()]);
  });
});

describe('stale gossip on the way to the engine', () => {
  it('drops stale typing, never group_sub, and shows both in sync-health', async () => {
    const kinds: string[] = [];
    engine.bridge.on('reticulum-chat-message', (wire: any) =>
      kinds.push(wire.k)
    );
    const now = Date.now();
    chatEvent({ k: 'typing', g: 5, a: 'Q1', ts: now - 60_000, active: true });
    chatEvent(
      { k: 'group_sub', groups: [5], ts: now - 600_000 },
      { _queuedAtMs: now - 600_000 }
    );
    chatEvent({ k: 'typing', g: 5, a: 'Q1', ts: now, active: true });
    runAll();
    expect(kinds).toEqual(['group_sub', 'typing']);
    const id = 9_001;
    host.handleMainMessage({
      t: 'rpc',
      id,
      method: 'debug:sync-health',
      args: [{}],
    });
    await vi.advanceTimersByTimeAsync(0);
    const health = (
      self.postMessage as unknown as { mock: { calls: any[][] } }
    ).mock.calls
      .map((call) => call[0])
      .find((msg: any) => msg?.t === 'rpcres' && msg.id === id)?.value;
    expect(health.io.socketQueue).toMatchObject({
      depth: 0,
      oldestAgeMs: null,
      staleGossipDropped: 1,
      staleGossipByKind: { typing: 1 },
    });
  });

  it('throws away what is still queued when the engine stops', () => {
    const seen: unknown[] = [];
    engine.bridge.on('reticulum-chat-message', (wire: unknown) =>
      seen.push(wire)
    );
    for (let i = 0; i < 5; i += 1) chatEvent({ k: 'event_notice_v3', g: 5 });
    host.handleMainMessage({ t: 'stop' });
    runAll();
    expect(seen).toHaveLength(0);
    expect(pump.stats().cleared).toBe(5);
  });
});

describe('late replies to timed-out sends', () => {
  const wire = { t: 'RCHAT', k: 'relay_query', g: 5, q: { ids: ['e1'] } };

  it('tells the engine when a timed-out send got a late ok', async () => {
    const lateOk = vi.fn();
    engine.bridge.on('reticulum-late-send-ok', lateOk);
    const sent = engine.bridge.sendReticulumChatDetailed(PEER, wire);
    const cmd = lastSent('cmd', 'send_reticulum_chat');
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(sent).resolves.toMatchObject({
      ok: false,
      reason: 'bridge-timeout',
    });
    send({ type: 'resp', id: cmd.id, ok: true });
    await microtasks();
    expect(lateOk).toHaveBeenCalledTimes(1);
    expect(lateOk).toHaveBeenCalledWith({
      action: 'send_reticulum_chat',
      payload: { peerPresenceHash: PEER, message: wire },
    });
  });

  it('says nothing for a late failure, a reply that never comes, or other commands', async () => {
    const lateOk = vi.fn();
    engine.bridge.on('reticulum-late-send-ok', lateOk);
    const failed = engine.bridge.fanoutReticulumChatDetailed([wire], [PEER]);
    const failedCmd = lastSent('cmd', 'fanout_reticulum_chat');
    const ensure = engine.bridge.ensurePeerIdentityKnown(PEER);
    const ensureCmd = lastSent('cmd', 'ensure_peer_identity');
    const lost = engine.bridge.sendReticulumChatDetailed(PEER, wire);
    await vi.advanceTimersByTimeAsync(25_000);
    await failed;
    await ensure;
    await lost;
    send({ type: 'resp', id: failedCmd.id, ok: false, payload: {} });
    send({ type: 'resp', id: ensureCmd.id, ok: true });
    // The socket closes: the third reply can no longer come.
    latestSocket().drop();
    await microtasks();
    expect(lateOk).not.toHaveBeenCalled();
  });

  it('reports a late ok for a fanout with its excludes', async () => {
    const lateOk = vi.fn();
    engine.bridge.on('reticulum-late-send-ok', lateOk);
    const sent = engine.bridge.fanoutReticulumChatDetailed([wire], [PEER]);
    const cmd = lastSent('cmd', 'fanout_reticulum_chat');
    await vi.advanceTimersByTimeAsync(25_000);
    await sent;
    send({ type: 'resp', id: cmd.id, ok: true });
    await microtasks();
    expect(lateOk).toHaveBeenCalledWith({
      action: 'fanout_reticulum_chat',
      payload: { messages: [wire], excludePeerPresenceHashes: [PEER] },
    });
  });
});
