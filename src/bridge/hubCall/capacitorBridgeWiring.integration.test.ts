/**
 * GO's real capacitorBridge wiring of the hosted Hub call managers
 * (HOSTED_HUB_CALLS): window.call / window.groupCall as installed by
 * installReticulumBridges(), python frames in through the Capacitor
 * `presence` listener (JSON strings, like ReticulumPlugin.kt), commands out
 * through Reticulum.presenceCommand. GO's "python" is a FakePythonNode on the
 * same in-memory network as a second device that runs the managers directly
 * (a Hub stand-in: same unmodified call.ts / group-call.ts).
 *
 * What this adds over hostedCallManagers.integration.test.ts: the CB seam
 * itself — presenceCommandWithResult correlation, fire-and-forget audio
 * frames, the python event tap, readiness, presence routes from GO's own
 * presence frames, history through window.reticulumChat, the RTC getter
 * (preference + audio surface), and that the old port stays silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteBoundId } from '../../lib/reticulum/routeBoundId';
import {
  FakePythonNetwork,
  type FakePythonNode,
} from './testing/fakePythonNetwork';
import {
  WAIT,
  disposeScenarioStacks,
  eventsOf,
  makePeer,
  registerLocal,
  runDmCallScenarioBetween,
  type Peer,
} from './testing/callScenarios';
import { TestWallet } from './testing/testWallet';
import type { HostedCallStack } from './hostedCallManagers';

vi.mock(
  'zlib',
  async () => await import('../../reticulumChat/mobile/shims/zlib')
);
vi.mock(
  'crypto',
  async () => await import('../../reticulumChat/mobile/shims/crypto')
);
vi.mock(
  '../../../electron/src/verify-worker-pool',
  async () =>
    await import('../../reticulumChat/mobile/shims/verify-worker-pool')
);
vi.mock(
  '../../../electron/src/presence',
  async () => await import('../../reticulumChat/mobile/shims/presence-slim')
);
vi.mock('../../../electron/src/logger', () => {
  const verbose = process.env.GO_CALL_TEST_LOGS === '1';
  const out = (...args: unknown[]) => {
    if (verbose) console.log(...args);
  };
  return { log: out, warn: out, error: out, debug: out, info: out };
});

/** The native side of GO: Capacitor listener + GO's python (a fake node). */
const native = vi.hoisted(() => ({
  listener: null as ((event: { frame: string }) => void) | null,
  goNode: null as unknown as {
    commandWithResult(
      action: string,
      payload: Record<string, unknown>,
      timeoutMs: number
    ): Promise<Record<string, unknown>>;
  } | null,
  /** presenceCommand actions with / without a correlation id. */
  correlated: [] as string[],
  fireAndForget: [] as string[],
  ringAddresses: [] as string[][],
  /** While set, `call_message` frames from GO's python are held here. */
  heldCallFrames: null as Array<Record<string, unknown>> | null,
}));

vi.mock('../../plugins/Reticulum', () => ({
  Reticulum: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'addListener') {
          return (_name: string, cb: (event: { frame: string }) => void) => {
            native.listener = cb;
            return Promise.resolve({ remove: () => Promise.resolve() });
          };
        }
        if (prop === 'presenceCommand') {
          // ReticulumPlugin.kt: queue for python, resolve at once. Python
          // answers `cmd-` ids only for send_group_audio (host feed()), and
          // the page ignores resp frames nobody waits for.
          return async ({
            action,
            payload,
            id,
          }: {
            action: string;
            payload?: Record<string, unknown>;
            id?: string;
          }) => {
            const node = native.goNode;
            if (!node) throw new Error('Presence bridge not started');
            if (typeof id === 'string') native.correlated.push(action);
            else native.fireAndForget.push(action);
            const resp = node.commandWithResult(action, payload ?? {}, 10_000);
            if (typeof id === 'string') {
              void resp.then((frame) =>
                native.listener?.({
                  frame: JSON.stringify({ ...frame, type: 'resp', id }),
                })
              );
            }
            return { ok: true, id };
          };
        }
        return () => Promise.resolve({});
      },
    }
  ),
}));

/**
 * While set, CB's load of the hosted stack is held (a slow chunk load on a
 * phone). Mock factories are cached across vi.resetModules(), so the gate
 * sits in the factory function, not in the module load.
 */
const chunkGate = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  /**
   * Runs right after the managers subscribe and start, in the same task:
   * frames pushed here land before CB's replay of the buffered ones.
   */
  afterCreate: null as (() => void) | null,
}));
vi.mock('./hostedCallManagers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./hostedCallManagers')>();
  return {
    ...mod,
    createHostedCallManagers: (
      deps: Parameters<typeof mod.createHostedCallManagers>[0]
    ) =>
      chunkGate.wait
        ? chunkGate.wait.then(() => {
            const stack = mod.createHostedCallManagers(deps);
            chunkGate.afterCreate?.();
            return stack;
          })
        : mod.createHostedCallManagers(deps),
  };
});

vi.mock('../nativeCallSession', () => ({
  setNativeRingAddresses: async (addresses: string[]) => {
    native.ringAddresses.push([...addresses]);
  },
}));

const GO_DEST = 'c0'.repeat(16);
const GO_RK = Buffer.from(new Uint8Array(64).fill(0x33)).toString('base64');

type Bridge = typeof import('../capacitorBridge');

function pushFrame(frame: Record<string, unknown>): void {
  if (native.heldCallFrames && frame.event === 'call_message') {
    native.heldCallFrames.push(frame);
    return;
  }
  native.listener?.({ frame: JSON.stringify(frame) });
}

/** Delivers the held `call_message` frames now, in order, and stops holding. */
function releaseHeldCallFrames(): void {
  const held = native.heldCallFrames ?? [];
  native.heldCallFrames = null;
  for (const frame of held) pushFrame(frame);
}

/** GO learns a peer device the way it does on a phone: a presence frame. */
function presenceFrom(peer: Peer): void {
  pushFrame({
    type: 'event',
    event: 'presence_message',
    payload: {
      route: { destinationHash: peer.dest },
      envelope: {
        type: 'PRESENCE_ANNOUNCE',
        payload: {
          address: peer.wallet.address,
          sessionId: `session-${peer.name}`,
          status: 'online',
        },
      },
    },
  });
}

type GoDevice = {
  bridge: Bridge;
  peer: Peer;
  node: FakePythonNode;
  history: Array<Record<string, unknown>>;
};

async function installGo(
  network: FakePythonNetwork,
  options: {
    audioSurface?: boolean;
    preference?: 'webrtc' | 'reticulum';
    /** Wait for the managers to load after `ready` (default true). */
    waitForStack?: boolean;
  } = {}
): Promise<GoDevice> {
  vi.resetModules();
  const { Capacitor } = await import('@capacitor/core');
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  try {
    localStorage.removeItem('go.calls.transport');
    if (options.preference) {
      localStorage.setItem('go.calls.transport', options.preference);
    }
  } catch {
    /* jsdom storage */
  }
  if (options.audioSurface !== false) {
    // Stand-ins for mobileAudioSurface (needs WebCodecs) and WebRTC.
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      class {};
    window.audioSurface = {
      isReady: async () => true,
      ensureReady: async () => ({ success: true }),
      sendCommand: async () => ({ ok: true }),
      onEvent: () => () => {},
      getWindowRole: async () => 'mobile-main',
    };
  }
  const node = network.addNode(GO_DEST);
  native.goNode = node as unknown as typeof native.goNode;
  node.onEvent((frame) => pushFrame(frame as Record<string, unknown>));
  const history: Array<Record<string, unknown>> = [];
  (window as unknown as { reticulumChat: unknown }).reticulumChat = {
    recordDirectCallHistory: async (update: Record<string, unknown>) => {
      history.push(update);
      return { success: true };
    },
  };

  const bridge = (await import('../capacitorBridge')) as Bridge;
  bridge.installReticulumBridges();
  void bridge.ensureReticulumBridgeStarted().catch(() => {});
  await vi.waitFor(() => expect(native.listener).not.toBeNull(), WAIT);
  pushFrame({
    type: 'event',
    event: 'ready',
    payload: { destinationHash: GO_DEST, identityPublicKeyBase64: GO_RK },
  });
  // The managers load at `ready`, before any page code asks.
  if (options.waitForStack !== false) {
    await vi.waitFor(
      () => expect(bridge.getHostedHubCallStack()).not.toBeNull(),
      WAIT
    );
  }

  const wallet = new TestWallet(0x61);
  const callEvents: Peer['callEvents'] = [];
  const gcallEvents: Peer['gcallEvents'] = [];
  window.call!.onEvent((event, payload) => callEvents.push({ event, payload }));
  window.groupCall!.onEvent((event, payload) =>
    gcallEvents.push({ event, payload })
  );
  const stack = {
    call: window.call,
    groupCall: window.groupCall,
    get bridge() {
      return bridge.getHostedHubCallStack()!.bridge;
    },
    hasActiveDirectVoiceRoom: () =>
      bridge.getHostedHubCallStack()!.hasActiveDirectVoiceRoom(),
    isRelayingAudio: (roomId?: string) => bridge.isGoCallRelayingAudio(roomId),
    dispose: () => {},
  } as unknown as HostedCallStack;
  const peer: Peer = {
    name: 'go',
    wallet,
    node,
    dest: GO_DEST,
    stack,
    endpoints: new Map(),
    history: history as unknown as Peer['history'],
    callEvents,
    gcallEvents,
  };
  return { bridge, peer, node, history };
}

/** A desktop-like peer (managers without CB) that knows GO, and vice versa. */
function hubPeer(network: FakePythonNetwork, go: GoDevice): Peer {
  const hub = makePeer(network, 'hub', 0x62, 0xd1);
  hub.endpoints.set(go.peer.wallet.address, [
    { destinationHash: GO_DEST, lastSeen: Date.now() },
  ]);
  presenceFrom(hub);
  return hub;
}

describe('capacitorBridge wiring of the hosted Hub call managers', () => {
  let goDevice: GoDevice | null = null;

  beforeEach(() => {
    native.listener = null;
    native.goNode = null;
    native.correlated = [];
    native.fireAndForget = [];
    native.ringAddresses = [];
    native.heldCallFrames = null;
    chunkGate.wait = null;
    chunkGate.afterCreate = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    goDevice?.bridge.getHostedHubCallStack()?.dispose();
    goDevice = null;
    disposeScenarioStacks();
    delete (window as { audioSurface?: unknown }).audioSurface;
    delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
    vi.restoreAllMocks();
  });

  it('GO calls a Hub: Hub-exact DM call end to end through the bridge (RTC signal, hangup over the link, history)', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network);
    const hub = hubPeer(network, goDevice);
    await registerLocal(goDevice.peer);
    await registerLocal(hub);
    expect(native.ringAddresses).toContainEqual([goDevice.peer.wallet.address]);
    expect(typeof window.groupCall!.sendRtcSignal).toBe('function');

    await runDmCallScenarioBetween(goDevice.peer, hub);

    // The hand-written port never answered a frame: no legacy link-open,
    // no legacy GJ floods besides the managers' own (one join each).
    const gjFloods = goDevice.node
      .commandsOf('fanout_group_call')
      .flatMap((c) => c.payload.messages as Array<Record<string, unknown>>)
      .filter((m) => m.t === 'GJ');
    expect(gjFloods).toHaveLength(1);
    // Voice and link-control frames are fire-and-forget (Kotlin's UUID id:
    // no resp frame per frame); the call commands whose result matters are
    // correlated (`cmd-` ids, presenceCommandWithResult).
    expect(native.fireAndForget).toContain('send_group_audio');
    expect(native.correlated).not.toContain('send_group_audio');
    for (const action of [
      'fanout_call',
      'send_call',
      'fanout_group_call',
      'send_group_audio_link_control',
    ]) {
      expect(native.correlated).toContain(action);
      expect(native.fireAndForget).not.toContain(action);
    }
    // History reached the chat engine RPC.
    expect(goDevice.history.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('voice hot path: one JSON.parse and no log line per inbound frame, one uncorrelated command per outbound frame', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network);
    const go = goDevice.peer;
    const hub = hubPeer(network, goDevice);
    await registerLocal(go);
    await registerLocal(hub);
    // Remember the last media frame python handed the page.
    let lastMediaFrame = '';
    const deliver = native.listener!;
    native.listener = (event) => {
      if (
        event.frame.includes('"group_audio_packet"') &&
        !event.frame.includes(btoa('QGCCTL1\0').slice(0, 8))
      ) {
        lastMediaFrame = event.frame;
      }
      deliver(event);
    };
    const N = 500;
    const timings: Record<string, number> = {};
    await runDmCallScenarioBetween(go, hub, {
      whileConnected: async ({ roomId }) => {
        expect(lastMediaFrame).not.toBe('');
        // ── inbound: python frame → gcall:audio, as fast as frames come
        const audioBefore = eventsOf(go.gcallEvents, 'gcall:audio').length;
        const parse = vi.spyOn(JSON, 'parse');
        const log = console.log as unknown as ReturnType<typeof vi.fn>;
        const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
        const logsBefore = log.mock.calls.length + warn.mock.calls.length;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) native.listener!({ frame: lastMediaFrame });
        timings.inboundMsPerFrame = (performance.now() - t0) / N;
        expect(parse).toHaveBeenCalledTimes(N);
        parse.mockRestore();
        expect(eventsOf(go.gcallEvents, 'gcall:audio').length).toBe(
          audioBefore + N
        );
        expect(log.mock.calls.length + warn.mock.calls.length).toBe(logsBefore);
        // ── outbound: window.groupCall.sendAudio → presenceCommand
        const sentBefore = native.fireAndForget.filter(
          (a) => a === 'send_group_audio'
        ).length;
        const correlatedBefore = native.correlated.length;
        const frame = new Uint8Array(90).fill(7);
        const t1 = performance.now();
        const results = await Promise.all(
          Array.from({ length: N }, () =>
            window.groupCall!.sendAudio(roomId, hub.wallet.address, frame, {
              rendererSendAtWallMs: Date.now(),
            })
          )
        );
        await vi.waitFor(
          () =>
            expect(
              native.fireAndForget.filter((a) => a === 'send_group_audio')
                .length - sentBefore
            ).toBe(N),
          WAIT
        );
        timings.outboundMsPerFrame = (performance.now() - t1) / N;
        expect(results.every((r) => r.success)).toBe(true);
        expect(native.correlated.length).toBe(correlatedBefore);
      },
    });
    // Node numbers, for the handoff only (a phone is several times slower).
    process.stdout.write(
      `[hot path] inbound ${timings.inboundMsPerFrame.toFixed(3)} ms/frame, outbound ${timings.outboundMsPerFrame.toFixed(3)} ms/frame (N=${N})\n`
    );
  }, 60_000);

  it('a Hub calls GO: same flow with GO answering (CA pinned to the Hub)', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network);
    const hub = hubPeer(network, goDevice);
    await registerLocal(goDevice.peer);
    await registerLocal(hub);
    await runDmCallScenarioBetween(hub, goDevice.peer);
    expect(
      goDevice.node
        .commandsOf('send_call')
        .filter((c) => (c.payload.message as { t?: string }).t === 'CA')
        .every((c) => c.payload.peerPresenceHash === hub.dest)
    ).toBe(true);
  }, 60_000);

  it('decline on GO reaches the Hub with its reason (reason-signed + legacy CX)', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network);
    const go = goDevice.peer;
    const hub = hubPeer(network, goDevice);
    await registerLocal(go);
    await registerLocal(hub);
    const chatId = `direct:${[hub.wallet.address, go.wallet.address].sort().join(':')}`;
    const callId = createRouteBoundId('call', hub.dest)!;
    const ts = Date.now();
    expect(
      await hub.stack.call.initiate(
        go.wallet.address,
        chatId,
        hub.wallet.address,
        hub.wallet.sign({
          type: 'CALL_REQUEST',
          callId,
          chatId,
          fromAddress: hub.wallet.address,
          fromPublicKey: hub.wallet.publicKey,
          timestamp: ts,
        }),
        hub.wallet.publicKey,
        callId,
        ts
      )
    ).toEqual({ success: true, callId });
    await vi.waitFor(
      () =>
        expect(eventsOf(go.callEvents, 'call:incoming')).toEqual([
          { callId, fromAddress: hub.wallet.address, chatId },
        ]),
      WAIT
    );
    const rejectTs = Date.now();
    expect(
      await window.call!.reject(
        callId,
        'not_friend',
        go.wallet.sign({ type: 'CALL_REJECT', callId, timestamp: rejectTs }),
        go.wallet.publicKey,
        rejectTs,
        go.wallet.sign({
          type: 'CALL_REJECT',
          callId,
          timestamp: rejectTs,
          reason: 'not_friend',
        })
      )
    ).toEqual({ success: true });
    await vi.waitFor(
      () =>
        expect(eventsOf(hub.callEvents, 'call:rejected')).toEqual([
          // Hub 3.0.3 keeps not_friend / media unavailable and shows any
          // other reason as a plain decline ('rejected').
          { callId, reason: 'not_friend' },
        ]),
      WAIT
    );
    const cx = goDevice.node
      .commandsOf('send_call')
      .filter((c) => (c.payload.message as { t?: string }).t === 'CX');
    expect(cx).toHaveLength(2);
    expect(cx.every((c) => c.payload.peerPresenceHash === hub.dest)).toBe(true);
  }, 60_000);

  it('"Private calls" and a missing audio surface hide sendRtcSignal (DM and group runtime)', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network, { preference: 'reticulum' });
    expect(window.groupCall!.sendRtcSignal).toBeUndefined();
    const prefs = await import('../callTransportPreference');
    prefs.setCallTransportPreference('webrtc');
    expect(typeof window.groupCall!.sendRtcSignal).toBe('function');
    prefs.setCallTransportPreference('reticulum');
    expect(window.groupCall!.sendRtcSignal).toBeUndefined();
    prefs.setCallTransportPreference('webrtc');
    // No audio surface able to run start-direct-voice-rtc: hidden.
    const surface = window.audioSurface;
    delete (window as { audioSurface?: unknown }).audioSurface;
    expect(window.groupCall!.sendRtcSignal).toBeUndefined();
    window.audioSurface = surface;
    expect(typeof window.groupCall!.sendRtcSignal).toBe('function');
  });

  it('a CALL_REQUEST that arrives while the managers are still loading rings once they are up', async () => {
    const network = new FakePythonNetwork();
    // The Hub stand-in builds its managers directly: before GO's load is held.
    const hub = makePeer(network, 'hub', 0x62, 0xd1);
    hub.endpoints.set(new TestWallet(0x61).address, [
      { destinationHash: GO_DEST, lastSeen: Date.now() },
    ]);
    await registerLocal(hub);
    let openGate!: () => void;
    chunkGate.wait = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    try {
      goDevice = await installGo(network, { waitForStack: false });
      const go = goDevice.peer;
      presenceFrom(hub);
      const chatId = `direct:${[hub.wallet.address, go.wallet.address].sort().join(':')}`;
      const callId = createRouteBoundId('call', hub.dest)!;
      const ts = Date.now();
      expect(
        await hub.stack.call.initiate(
          go.wallet.address,
          chatId,
          hub.wallet.address,
          hub.wallet.sign({
            type: 'CALL_REQUEST',
            callId,
            chatId,
            fromAddress: hub.wallet.address,
            fromPublicKey: hub.wallet.publicKey,
            timestamp: ts,
          }),
          hub.wallet.publicKey,
          callId,
          ts
        )
      ).toEqual({ success: true, callId });
      // The CR reached GO's page while nothing was listening for it yet.
      await new Promise((r) => setTimeout(r, 50));
      expect(goDevice.bridge.getHostedHubCallStack()).toBeNull();
      // Track E's relaying probe falls back while nothing is loaded.
      expect(window.groupCall!.isRelayingAudio!('gcall-qortal-659')).toBeNull();
      openGate();
      await vi.waitFor(
        () => expect(goDevice!.bridge.getHostedHubCallStack()).not.toBeNull(),
        WAIT
      );
      // useVoiceCall registers the account; the held, verified CR rings.
      await window.call!.setLocalAddresses([go.wallet.address]);
      await vi.waitFor(
        () =>
          expect(eventsOf(go.callEvents, 'call:incoming')).toContainEqual({
            callId,
            fromAddress: hub.wallet.address,
            chatId,
          }),
        WAIT
      );
    } finally {
      chunkGate.wait = null;
      openGate?.();
    }
  });

  /** GO with its managers' chunk held and a Hub CALL_REQUEST buffered by CB. */
  async function goWithBufferedCallRequest(): Promise<{
    go: Peer;
    hub: Peer;
    callId: string;
    openGate: () => void;
  }> {
    const network = new FakePythonNetwork();
    const hub = makePeer(network, 'hub', 0x62, 0xd1);
    hub.endpoints.set(new TestWallet(0x61).address, [
      { destinationHash: GO_DEST, lastSeen: Date.now() },
    ]);
    await registerLocal(hub);
    let openGate!: () => void;
    chunkGate.wait = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    goDevice = await installGo(network, { waitForStack: false });
    const go = goDevice.peer;
    presenceFrom(hub);
    const chatId = `direct:${[hub.wallet.address, go.wallet.address].sort().join(':')}`;
    const callId = createRouteBoundId('call', hub.dest)!;
    const ts = Date.now();
    expect(
      await hub.stack.call.initiate(
        go.wallet.address,
        chatId,
        hub.wallet.address,
        hub.wallet.sign({
          type: 'CALL_REQUEST',
          callId,
          chatId,
          fromAddress: hub.wallet.address,
          fromPublicKey: hub.wallet.publicKey,
          timestamp: ts,
        }),
        hub.wallet.publicKey,
        callId,
        ts
      )
    ).toEqual({ success: true, callId });
    await new Promise((r) => setTimeout(r, 50));
    expect(goDevice.bridge.getHostedHubCallStack()).toBeNull();
    return { go, hub, callId, openGate };
  }

  it('a cancel that arrives between the managers subscribing and the replay still ends the buffered call', async () => {
    const { go, hub, callId, openGate } = await goWithBufferedCallRequest();
    try {
      // The caller gives up at once; its CH (pinned + overlay copy) reaches
      // GO's page right after the managers subscribed, before CB replays
      // the buffered CR.
      native.heldCallFrames = [];
      const hangupTs = Date.now();
      await hub.stack.call.hangup(
        callId,
        hub.wallet.sign({ type: 'CALL_HANGUP', callId, timestamp: hangupTs }),
        hub.wallet.publicKey,
        hangupTs
      );
      await vi.waitFor(
        () => expect(native.heldCallFrames!.length).toBeGreaterThan(0),
        WAIT
      );
      await new Promise((r) => setTimeout(r, 50));
      chunkGate.afterCreate = releaseHeldCallFrames;
      // useVoiceCall registers the account while the chunk loads.
      const registered = window.call!.setLocalAddresses([go.wallet.address]);
      openGate();
      await registered;
      await vi.waitFor(
        () =>
          expect(eventsOf(go.callEvents, 'call:hangup')).toContainEqual({
            callId,
          }),
        WAIT
      );
      // CR first (it rang), then the CH ended it: nothing keeps ringing.
      expect(
        go.callEvents
          .filter(
            (e) => e.event === 'call:incoming' || e.event === 'call:hangup'
          )
          .map((e) => e.event)
      ).toEqual(['call:incoming', 'call:hangup']);
    } finally {
      chunkGate.wait = null;
      openGate();
    }
  });

  it.each(['while the chunk loads', 'between subscribe and replay'] as const)(
    'logout %s drops the buffered CALL_REQUEST (no ring after the next login)',
    async (moment) => {
      const { go, openGate } = await goWithBufferedCallRequest();
      try {
        const logout = () => goDevice!.bridge.clearHostedHubCallAccountState();
        if (moment === 'while the chunk loads') logout();
        else chunkGate.afterCreate = logout;
        openGate();
        await vi.waitFor(
          () => expect(goDevice!.bridge.getHostedHubCallStack()).not.toBeNull(),
          WAIT
        );
        // The same account logs back in well within the CR's 30 s.
        await window.call!.setLocalAddresses([go.wallet.address]);
        await new Promise((r) => setTimeout(r, 300));
        expect(eventsOf(go.callEvents, 'call:incoming')).toEqual([]);
      } finally {
        chunkGate.wait = null;
        openGate();
      }
    }
  );

  it('installs the WebRTC privacy guard and clears call state at logout', async () => {
    const network = new FakePythonNetwork();
    goDevice = await installGo(network);
    const privacy = await import('../webrtcPrivacy');
    expect(privacy.isWebRtcPrivacyGuardInstalled()).toBe(true);
    // The relaying probe answers synchronously once loaded (no room: false).
    expect(window.groupCall!.isRelayingAudio!('gcall-qortal-659')).toBe(false);
    expect(goDevice.bridge.getGoCallDiagnostics()).toMatchObject({
      port: 'hosted-hub-managers',
      loaded: true,
      rtcSignalExposed: true,
      hardenedGcSignatureCache: true,
    });
    const go = goDevice.peer;
    const hub = hubPeer(network, goDevice);
    await registerLocal(go);
    await registerLocal(hub);
    const stack = goDevice.bridge.getHostedHubCallStack()!;
    const clear = vi.spyOn(stack, 'clearLocalAccountState');
    goDevice.bridge.clearHostedHubCallAccountState();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(native.ringAddresses[native.ringAddresses.length - 1]).toEqual([]);
    // After logout an incoming call for the old account does not ring.
    const chatId = `direct:${[hub.wallet.address, go.wallet.address].sort().join(':')}`;
    const callId = createRouteBoundId('call', hub.dest)!;
    const ts = Date.now();
    await hub.stack.call.initiate(
      go.wallet.address,
      chatId,
      hub.wallet.address,
      hub.wallet.sign({
        type: 'CALL_REQUEST',
        callId,
        chatId,
        fromAddress: hub.wallet.address,
        fromPublicKey: hub.wallet.publicKey,
        timestamp: ts,
      }),
      hub.wallet.publicKey,
      callId,
      ts
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(eventsOf(go.callEvents, 'call:incoming')).toEqual([]);
  });
});
