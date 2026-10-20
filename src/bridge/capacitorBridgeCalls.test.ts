import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteBoundId } from '../lib/reticulum/routeBoundId';

// GO's old hand-written window.call / window.groupCall port (kept behind
// HOSTED_HUB_CALLS=false for one release) against the native plugin, as a
// Hub 3.0.3 peer would drive it: frames in through the presence listener,
// commands out through presenceCommand.
const native = vi.hoisted(() => ({
  listener: null as ((event: { frame: string }) => void) | null,
  commands: [] as Array<{ action: string; payload: Record<string, any> }>,
  /** `payload` of python's resp frame per action (none by default). */
  respPayloads: {} as Record<string, unknown>,
}));

vi.mock('../plugins/Reticulum', () => ({
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
          return ({ action, payload, id }) => {
            native.commands.push({ action, payload });
            queueMicrotask(() =>
              native.listener?.({
                frame: JSON.stringify({
                  type: 'resp',
                  id,
                  ok: true,
                  ...(native.respPayloads[action] !== undefined
                    ? { payload: native.respPayloads[action] }
                    : {}),
                }),
              })
            );
            return Promise.resolve({});
          };
        }
        return () => Promise.resolve({});
      },
    }
  ),
}));

const nativeCall = vi.hoisted(() => ({
  ringAddresses: [] as string[][],
}));
vi.mock('./nativeCallSession', () => ({
  setNativeRingAddresses: async (addresses: string[]) => {
    nativeCall.ringAddresses.push([...addresses]);
  },
}));

const GO_HASH = 'a'.repeat(32);
const HUB_HASH = '0123456789abcdef0123456789abcdef';
const NEIGHBOR_HASH = 'c'.repeat(32);
const GO_ADDR = 'QGoAddressXXXXXXXXXXXXXXXXXXXXXXXX';
const HUB_ADDR = 'QHubAddressXXXXXXXXXXXXXXXXXXXXXXX';
const ROOM = 'dmv:0123456789abcdef01';
const CHAT = `direct:${[GO_ADDR, HUB_ADDR].sort().join(':')}`;
const RK = btoa(
  String.fromCharCode(...Array.from({ length: 64 }, (_, i) => i + 7))
);
const MAGIC = 'QGCCTL1\u0000';

function frame(event: string, payload: Record<string, unknown>): void {
  native.listener?.({
    frame: JSON.stringify({ type: 'event', event, payload }),
  });
}

function commands(action: string) {
  return native.commands.filter((c) => c.action === action);
}

function sentCallWires() {
  return commands('fanout_call').flatMap((c) => c.payload.messages);
}

function controlFrame(wire: Record<string, unknown>): string {
  return btoa(MAGIC + JSON.stringify(wire));
}

function decodeSentFrame(data: string): { magic: boolean; wire?: any } {
  const raw = atob(data);
  if (!raw.startsWith(MAGIC)) return { magic: false };
  return { magic: true, wire: JSON.parse(raw.slice(MAGIC.length)) };
}

function linkAuthSends(linkId?: string) {
  return commands('send_group_audio').filter((c) => {
    const decoded = decodeSentFrame(c.payload.data);
    return (
      decoded.magic &&
      decoded.wire?.t === 'GJ' &&
      (!linkId || c.payload.linkId === linkId)
    );
  });
}

function inboundCallRequest(callId: string, timestamp = Date.now()): void {
  frame('call_message', {
    wire: {
      t: 'CR',
      c: callId,
      a: HUB_ADDR,
      k: 'hub-pk',
      g: 'hub-sig',
      m: timestamp,
      U: GO_ADDR,
      L: 3,
      X: `x${Math.random().toString(36).slice(2)}`,
    },
    senderDestinationHash: HUB_HASH,
    peerPresenceHash: NEIGHBOR_HASH,
  });
}

let bridgeModule: typeof import('./capacitorBridge');

async function installBridge(): Promise<void> {
  vi.resetModules();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const bridge = await import('./capacitorBridge');
    bridgeModule = bridge;
    // This file covers the old hand-written port (HOSTED_HUB_CALLS off);
    // the hosted managers have hubCall/capacitorBridgeWiring.integration.test.ts.
    bridge.__setHostedHubCallsForTests(false);
    bridge.installReticulumBridges();
    // Attaches the frame listener, then waits for `ready`.
    void bridge.ensureReticulumBridgeStarted().catch(() => {});
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

describe('GO call port against a Hub 3.0.3 peer', () => {
  let callEvents: Array<[string, any]>;
  let gcEvents: Array<[string, any]>;
  let offCall: (() => unknown) | undefined;
  let offGc: (() => unknown) | undefined;

  beforeEach(async () => {
    native.listener = null;
    native.commands = [];
    native.respPayloads = {};
    nativeCall.ringAddresses = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await installBridge();
    await vi.waitFor(() => expect(native.listener).not.toBeNull(), {
      timeout: 10_000,
    });
    frame('ready', {
      destinationHash: GO_HASH,
      identityPublicKeyBase64: RK,
    });
    callEvents = [];
    gcEvents = [];
    offCall = window.call!.onEvent((e, p) => callEvents.push([e, p]));
    offGc = (window.groupCall as any).onEvent((e: string, p: unknown) =>
      gcEvents.push([e, p])
    );
    await window.call!.setLocalAddresses([GO_ADDR]);
  });

  afterEach(() => {
    offCall?.();
    offGc?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('window.call', () => {
    it('declines with the reason-signed CX first, then the legacy one', async () => {
      const callId = createRouteBoundId('call', HUB_HASH)!;
      inboundCallRequest(callId);
      expect(callEvents).toContainEqual([
        'call:incoming',
        { callId, fromAddress: HUB_ADDR, chatId: CHAT },
      ]);

      const result = await (window.call as any).reject(
        callId,
        'rejected',
        'legacy-sig',
        'go-pk',
        1234,
        'reason-sig'
      );
      expect(result).toEqual({ success: true });
      await vi.waitFor(() => expect(sentCallWires()).toHaveLength(2));
      const [withReason, legacy] = sentCallWires();
      expect(withReason).toMatchObject({
        t: 'CX',
        c: callId,
        e: 'rejected',
        g: 'reason-sig',
        k: 'go-pk',
        m: 1234,
        U: HUB_ADDR,
      });
      expect(legacy).toMatchObject({ t: 'CX', c: callId, g: 'legacy-sig' });
      expect(legacy).not.toHaveProperty('e');
      expect(withReason.X).not.toBe(legacy.X);
    });

    it('reject and hangup succeed for calls that already ended', async () => {
      expect(await (window.call as any).reject('gone', 'rejected')).toEqual({
        success: true,
      });
      expect(await window.call!.hangup('gone', 's', 'p', 1)).toEqual({
        success: true,
      });
    });

    it('ends a call nobody answered within 60 s on both sides of the UI', async () => {
      const inbound = createRouteBoundId('call', HUB_HASH)!;
      inboundCallRequest(inbound);
      const outbound = createRouteBoundId('call', GO_HASH)!;
      await window.call!.initiate(
        HUB_ADDR,
        CHAT,
        GO_ADDR,
        'sig',
        'pk',
        outbound,
        Date.now()
      );
      vi.advanceTimersByTime(59_000);
      expect(callEvents.filter(([e]) => e === 'call:hangup')).toEqual([]);
      vi.advanceTimersByTime(1_500);
      expect(callEvents).toContainEqual(['call:hangup', { callId: inbound }]);
      expect(callEvents).toContainEqual(['call:hangup', { callId: outbound }]);
      // Decline after the timeout still clears the UI.
      expect(await (window.call as any).reject(inbound, 'rejected')).toEqual({
        success: true,
      });
    });

    it('reports one call:accepted for the five repeated CALL_ACCEPTs', async () => {
      const callId = createRouteBoundId('call', GO_HASH)!;
      await window.call!.initiate(
        HUB_ADDR,
        CHAT,
        GO_ADDR,
        'sig',
        'pk',
        callId,
        Date.now()
      );
      for (let i = 0; i < 5; i += 1) {
        frame('call_message', {
          wire: {
            t: 'CA',
            c: callId,
            k: 'hub-pk',
            g: 'hub-sig',
            m: Date.now(),
          },
          senderDestinationHash: HUB_HASH,
          peerPresenceHash: NEIGHBOR_HASH,
        });
      }
      expect(callEvents.filter(([e]) => e === 'call:accepted')).toEqual([
        ['call:accepted', { callId }],
      ]);
    });

    it('drops call requests that expired while no account was signed in', async () => {
      await window.call!.setLocalAddresses([]);
      const callId = createRouteBoundId('call', HUB_HASH)!;
      inboundCallRequest(callId);
      vi.advanceTimersByTime(61_000);
      await window.call!.setLocalAddresses([GO_ADDR]);
      expect(callEvents.filter(([e]) => e === 'call:incoming')).toEqual([]);
    });

    it('hands the signed-in addresses to the native ring sniffer once per change', async () => {
      expect(nativeCall.ringAddresses).toEqual([[GO_ADDR]]);
      // useVoiceCall re-asserts every 2.5 s: no native call for that.
      await window.call!.setLocalAddresses([GO_ADDR]);
      expect(nativeCall.ringAddresses).toEqual([[GO_ADDR]]);
      // An unchanged list is re-pushed after 30 s (heals a UI's [] push).
      vi.advanceTimersByTime(31_000);
      await window.call!.setLocalAddresses([GO_ADDR]);
      expect(nativeCall.ringAddresses).toEqual([[GO_ADDR], [GO_ADDR]]);
      await window.call!.setLocalAddresses([]);
      expect(
        nativeCall.ringAddresses[nativeCall.ringAddresses.length - 1]
      ).toEqual([]);
      // Logout boundary clears it too (once).
      await window.call!.setLocalAddresses([GO_ADDR]);
      bridgeModule.clearHostedHubCallAccountState();
      expect(
        nativeCall.ringAddresses[nativeCall.ringAddresses.length - 1]
      ).toEqual([]);
      const pushes = nativeCall.ringAddresses.length;
      bridgeModule.clearHostedHubCallAccountState();
      expect(nativeCall.ringAddresses).toHaveLength(pushes);
    });

    it('rings a held call request only for what is left of the caller 60 s', async () => {
      await window.call!.setLocalAddresses([]);
      const callId = createRouteBoundId('call', HUB_HASH)!;
      inboundCallRequest(callId);
      vi.advanceTimersByTime(50_000);
      await window.call!.setLocalAddresses([GO_ADDR]);
      expect(callEvents).toContainEqual([
        'call:incoming',
        { callId, fromAddress: HUB_ADDR, chatId: CHAT },
      ]);
      vi.advanceTimersByTime(9_000);
      expect(callEvents.filter(([e]) => e === 'call:hangup')).toEqual([]);
      vi.advanceTimersByTime(1_500);
      expect(callEvents).toContainEqual(['call:hangup', { callId }]);
    });
  });

  describe('community STUN servers (window.hub)', () => {
    const urls = (): string[] =>
      (window as any).hub
        .getBootstrapIceServers()
        .map((server: { urls: string }) => server.urls);
    const announce = (host: string) =>
      frame('community_stun_endpoint', { host, port: 3478 });

    it('merges announced endpoints: newest first, deduped, at most 6', () => {
      announce('a.example');
      announce('b.example');
      expect(urls()).toEqual(['stun:b.example:3478', 'stun:a.example:3478']);
      announce('a.example');
      expect(urls()).toEqual(['stun:a.example:3478', 'stun:b.example:3478']);
      for (const host of ['c', 'd', 'e', 'f', 'g']) announce(`${host}.example`);
      expect(urls()).toEqual([
        'stun:g.example:3478',
        'stun:f.example:3478',
        'stun:e.example:3478',
        'stun:d.example:3478',
        'stun:c.example:3478',
        'stun:a.example:3478',
      ]);
      // An expired or malformed announcement changes nothing.
      frame('community_stun_endpoint', {
        host: 'old.example',
        port: 3478,
        expiresAt: 1,
      });
      frame('community_stun_endpoint', { host: 'bad.example', port: 0 });
      expect(urls()).toHaveLength(6);
      expect(urls()[0]).toBe('stun:g.example:3478');
    });

    const hub = () =>
      (window as any).hub as {
        getIceServers: () => Promise<Array<Record<string, unknown>>>;
      };
    const endpoint = (host: string, expiresAt: number) => ({
      host,
      port: 3478,
      expiresAt,
    });
    const replyWith = (endpoints: unknown[]) => {
      native.respPayloads.get_community_stun_endpoints = { endpoints };
    };

    it("python's full reply replaces the list: unannounced servers drop out, latest expiry first", async () => {
      announce('a.example');
      announce('b.example');
      vi.advanceTimersByTime(1_000);
      const now = Date.now();
      // Python lists first-seen first; a re-announce keeps its slot but
      // gets a later expiry (c below).
      replyWith([
        endpoint('old.example', now + 10 * 60_000),
        endpoint('c.example', now + 50 * 60_000),
        endpoint('d.example', now + 30 * 60_000),
      ]);
      const servers = await hub().getIceServers();
      const expected = [
        'stun:c.example:3478',
        'stun:d.example:3478',
        'stun:old.example:3478',
      ];
      expect(servers.map((server) => server.urls)).toEqual(expected);
      // RTCPeerConnection gets `{urls}` only.
      expect(servers[0]).toEqual({ urls: 'stun:c.example:3478' });
      expect(urls()).toEqual(expected);
    });

    it('keeps the 6 latest-expiring servers of a longer reply', async () => {
      const now = Date.now();
      replyWith(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
          endpoint(`h${n}.example`, now + n * 60_000)
        )
      );
      await hub().getIceServers();
      expect(urls()).toEqual(
        [8, 7, 6, 5, 4, 3].map((n) => `stun:h${n}.example:3478`)
      );
    });

    it('drops a server when its announcement expires; an empty reply keeps the live ones', async () => {
      announce('a.example');
      frame(
        'community_stun_endpoint',
        endpoint('short.example', Date.now() + 2_000)
      );
      expect(urls()).toEqual([
        'stun:short.example:3478',
        'stun:a.example:3478',
      ]);
      vi.advanceTimersByTime(3_000);
      expect(urls()).toEqual(['stun:a.example:3478']);
      replyWith([]);
      const servers = await hub().getIceServers();
      expect(servers.map((server) => server.urls)).toEqual([
        'stun:a.example:3478',
      ]);
    });

    it('keeps a server announced while the reply was on its way', async () => {
      announce('stale.example');
      vi.advanceTimersByTime(1_000);
      replyWith([endpoint('c.example', Date.now() + 60_000)]);
      const pending = hub().getIceServers();
      announce('late.example');
      await pending;
      expect(urls()).toEqual(['stun:late.example:3478', 'stun:c.example:3478']);
    });

    describe('remembered endpoints (communityStunCache)', () => {
      const CACHE_KEY = 'go.communityStun.v1';
      const STUN_PORT = 47321;
      const stunAnswering = new Set<string>();
      /** Never answers and never ends gathering: only the 1.5 s timeout. */
      const stunSilent = new Set<string>();
      let probedHosts: string[];
      let openProbes: Set<string>;

      // A one-server probe connection: answers with a srflx candidate when
      // its server is in stunAnswering, stays silent when it is in
      // stunSilent, else ends gathering empty.
      class FakeProbePc extends EventTarget {
        private readonly host: string;
        constructor(config: RTCConfiguration) {
          super();
          const url = String(config?.iceServers?.[0]?.urls ?? '');
          this.host = url.replace(/^stun:/, '').replace(/:\d+$/, '');
          probedHosts.push(this.host);
          openProbes.add(this.host);
        }
        createDataChannel() {
          return {};
        }
        async createOffer() {
          return { type: 'offer', sdp: '' };
        }
        async setLocalDescription() {
          if (stunSilent.has(this.host)) return;
          queueMicrotask(() => {
            const event = new Event('icecandidate');
            (event as unknown as { candidate: unknown }).candidate =
              stunAnswering.has(this.host)
                ? {
                    type: 'srflx',
                    candidate:
                      'candidate:1 1 udp 1686052607 198.51.100.7 40000 typ srflx raddr 0.0.0.0 rport 0',
                  }
                : null;
            this.dispatchEvent(event);
          });
        }
        close() {
          openProbes.delete(this.host);
        }
      }

      const cachedRows = (): Array<Record<string, number | string>> => {
        try {
          return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}').rows ?? [];
        } catch {
          return [];
        }
      };
      const seedCache = (
        rows: Array<{ host: string; okAt?: number; heardAt?: number }>
      ) =>
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            v: 1,
            rows: rows.map((row) => ({
              port: STUN_PORT,
              heardAt: Date.now() - 60 * 60_000,
              okAt: 0,
              failAt: 0,
              failStreak: 0,
              rttMs: 100,
              ...row,
            })),
          })
        );

      beforeEach(() => {
        probedHosts = [];
        openProbes = new Set();
        stunAnswering.clear();
        stunSilent.clear();
        localStorage.removeItem(CACHE_KEY);
        vi.stubGlobal('RTCPeerConnection', FakeProbePc);
      });
      afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem('go.calls.transport');
      });

      it('serves an endpoint after its announce lease once a probe answered, for 8 min', async () => {
        stunAnswering.add('68.83.3.62');
        frame('community_stun_endpoint', {
          host: '68.83.3.62',
          port: STUN_PORT,
          expiresAt: Date.now() + 2 * 60_000,
        });
        expect(cachedRows().map((row) => row.host)).toEqual(['68.83.3.62']);
        replyWith([]);
        const servers = await hub().getIceServers();
        expect(servers).toEqual([{ urls: 'stun:68.83.3.62:47321' }]);
        // Fewer than 6: the endpoint is probed in the background.
        await vi.waitFor(() =>
          expect(Number(cachedRows()[0]?.okAt)).toBeGreaterThan(0)
        );
        expect(probedHosts).toEqual(['68.83.3.62']);

        // The announcement expired: the live list is empty, the cache serves.
        vi.advanceTimersByTime(3 * 60_000);
        expect(urls()).toEqual(['stun:68.83.3.62:47321']);
        // 9 min after the probe it needs a new one first.
        vi.advanceTimersByTime(6 * 60_000);
        expect(urls()).toEqual([]);
      });

      it("remembers python's reply endpoints; the pull at ready never probes", async () => {
        const inTenMin = Date.now() + 10 * 60_000;
        replyWith([
          { host: '147.10.157.88', port: STUN_PORT, expiresAt: inTenMin },
          { host: '147.10.157.89', port: STUN_PORT, expiresAt: Date.now() },
          endpoint('a.example', inTenMin),
        ]);
        stunAnswering.add('147.10.157.88');
        // Python (re)started: GO pulls the live list, without probing.
        const pullsBefore = commands('get_community_stun_endpoints').length;
        frame('ready', {
          destinationHash: GO_HASH,
          identityPublicKeyBase64: RK,
        });
        await vi.waitFor(() =>
          expect(cachedRows().map((row) => row.host)).toEqual(['147.10.157.88'])
        );
        expect(commands('get_community_stun_endpoints')).toHaveLength(
          pullsBefore + 1
        );
        await vi.advanceTimersByTimeAsync(2_000);
        expect(probedHosts).toEqual([]);

        // A call asks: live servers first, the cached one is probed.
        const servers = await hub().getIceServers();
        expect(servers.map((server) => server.urls)).toEqual([
          'stun:147.10.157.88:47321',
          'stun:a.example:3478',
        ]);
        await vi.waitFor(() => expect(probedHosts).toEqual(['147.10.157.88']));
      });

      it('serves verified endpoints a previous run left behind, live ones first', async () => {
        seedCache([
          { host: '68.83.3.62', okAt: Date.now() - 60_000 },
          { host: '24.116.142.68', okAt: Date.now() - 30 * 60_000 },
        ]);
        announce('live.example');
        expect(urls()).toEqual([
          'stun:live.example:3478',
          'stun:68.83.3.62:47321',
        ]);
        replyWith([]);
        const servers = await hub().getIceServers();
        expect(servers.map((server) => server.urls)).toEqual([
          'stun:live.example:3478',
          'stun:68.83.3.62:47321',
        ]);
        // The stale one is re-probed in the background (it does not answer).
        await vi.waitFor(() => expect(probedHosts).toEqual(['24.116.142.68']));
      });

      it('with an empty pool waits for the first probe round', async () => {
        seedCache([{ host: '68.83.3.62' }, { host: '80.40.239.125' }]);
        stunAnswering.add('80.40.239.125');
        replyWith([]);
        const servers = await hub().getIceServers();
        expect([...probedHosts].sort()).toEqual([
          '68.83.3.62',
          '80.40.239.125',
        ]);
        expect(servers).toEqual([{ urls: 'stun:80.40.239.125:47321' }]);
      });

      it('with an empty pool waits at most 1.6 s, not for a whole round of dead hosts', async () => {
        const silent = ['31.0.0.1', '32.0.0.1', '33.0.0.1', '34.0.0.1'];
        seedCache([{ host: '30.0.0.1' }, ...silent.map((host) => ({ host }))]);
        stunAnswering.add('30.0.0.1');
        silent.forEach((host) => stunSilent.add(host));
        replyWith([]);
        let servers: Array<Record<string, unknown>> | undefined;
        void hub()
          .getIceServers()
          .then((result) => {
            servers = result;
          });
        // 3 at once, 1.5 s each: this round takes 3 s.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(servers).toBeUndefined();
        await vi.advanceTimersByTimeAsync(700);
        expect(servers).toEqual([{ urls: 'stun:30.0.0.1:47321' }]);
        // Resolved by the cap: the last dead host is still being probed.
        expect([...openProbes]).toEqual(['34.0.0.1']);
        await vi.advanceTimersByTimeAsync(1_500);
        expect(openProbes.size).toBe(0);
        expect(probedHosts).toHaveLength(5);
      });

      it('in Private calls (Reticulum only) never builds a probe connection', async () => {
        const preference = await import('./callTransportPreference');
        preference.setCallTransportPreference('reticulum');
        seedCache([{ host: '68.83.3.62' }, { host: '80.40.239.125' }]);
        stunAnswering.add('80.40.239.125');
        frame('community_stun_endpoint', {
          host: '24.116.142.68',
          port: STUN_PORT,
          expiresAt: Date.now() + 10 * 60_000,
        });
        replyWith([]);
        const startedAt = Date.now();
        const servers = await hub().getIceServers();
        expect(probedHosts).toEqual([]);
        expect(servers).toEqual([{ urls: 'stun:24.116.142.68:47321' }]);
        // No probe to wait for when nothing is usable either.
        vi.advanceTimersByTime(11 * 60_000);
        await hub().getIceServers();
        expect(probedHosts).toEqual([]);
        expect(Date.now() - startedAt).toBeLessThan(11 * 60_000 + 1_000);

        // Back to WebRTC: the same pool is probed on the next ask.
        preference.setCallTransportPreference('webrtc');
        const after = await hub().getIceServers();
        expect([...probedHosts].sort()).toEqual([
          '24.116.142.68',
          '68.83.3.62',
          '80.40.239.125',
        ]);
        expect(after).toEqual([{ urls: 'stun:80.40.239.125:47321' }]);
      });
    });
  });

  describe('window.groupCall DM media', () => {
    const joinAsCallee = async (callId: string) =>
      (window.groupCall as any).join(
        ROOM,
        CHAT,
        GO_ADDR,
        'join-sig',
        'go-pk',
        Date.now(),
        GO_HASH,
        undefined,
        0,
        RK,
        'join-rk-sig',
        'opener',
        undefined,
        undefined,
        callId
      );

    const acceptInbound = async (): Promise<string> => {
      const callId = createRouteBoundId('call', HUB_HASH)!;
      inboundCallRequest(callId);
      await window.call!.accept(callId, 'sig', 'pk', Date.now());
      return callId;
    };

    it('joins with a GJ without rk plus a GI, and opens the link to the call peer', async () => {
      const callId = await acceptInbound();
      const result = await joinAsCallee(callId);
      expect(result.success).toBe(true);

      const fanout = commands('fanout_group_call');
      expect(fanout).toHaveLength(1);
      const [gj, gi] = fanout[0].payload.messages;
      expect(gj).toMatchObject({
        t: 'GJ',
        R: ROOM,
        H: 'd:0123456789abcdef01',
        a: GO_ADDR,
        k: 'go-pk',
        g: 'join-sig',
        d: GO_HASH,
      });
      expect(gj).not.toHaveProperty('rk');
      expect(gj).not.toHaveProperty('j');
      expect(gi).toMatchObject({
        t: 'GI',
        a: GO_ADDR,
        g: 'join-rk-sig',
        d: GO_HASH,
        rk: RK.replace(/=+$/u, ''),
      });

      // Opener: link to the device bound into the call id, at once.
      expect(commands('open_group_audio_link')).toEqual([
        {
          action: 'open_group_audio_link',
          payload: { peerPresenceHash: HUB_HASH, activeCall: true },
        },
      ]);
    });

    it('authenticates every audio link until the Hub shows it accepted it', async () => {
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      frame('group_audio_link_established', {
        linkId: 'link-1',
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        incoming: false,
      });
      const first = linkAuthSends('link-1');
      expect(first).toHaveLength(1);
      expect(first[0].payload).toMatchObject({
        roomId: ROOM,
        peerPresenceHash: HUB_HASH,
        receivedAtWallMs: 0,
      });
      const sentGj = decodeSentFrame(first[0].payload.data).wire;
      const overlayGj = commands('fanout_group_call')[0].payload.messages[0];
      const { X: _x, L: _l, ...overlayGjWithoutMeta } = overlayGj;
      expect(sentGj).toEqual(overlayGjWithoutMeta);

      vi.advanceTimersByTime(3_100);
      expect(linkAuthSends('link-1').length).toBe(3);

      // The Hub's room key arrives on the link: it adopted the link.
      frame('group_audio_packet', {
        linkId: 'link-1',
        roomId: ROOM,
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        receivedAtWallMs: Date.now(),
        data: controlFrame({
          t: 'GK',
          R: ROOM,
          T: GO_ADDR,
          a: HUB_ADDR,
          k: 'hub-pk',
          y: 'enc',
          v: 3,
          S: 'session',
          G: 1,
          h: 'commit',
          d: 'digest',
          m: Date.now(),
          g: 'sig',
        }),
      });
      expect(gcEvents.map(([e]) => e)).toContain('gcall:key');
      const afterKey = linkAuthSends('link-1').length;
      vi.advanceTimersByTime(6_000);
      expect(linkAuthSends('link-1').length).toBe(afterKey);

      // A new link to the same peer needs its own link-auth.
      frame('group_audio_link_established', {
        linkId: 'link-2',
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        incoming: true,
      });
      expect(linkAuthSends('link-2')).toHaveLength(1);
    });

    it('answers the Hub heartbeat PING with a PONG on the same link', async () => {
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      frame('group_call_message', {
        wire: { t: 'GAC', R: ROOM, c: 'PING', m: Date.now(), p: 17 },
        senderDestinationHash: HUB_HASH,
        peerPresenceHash: HUB_HASH,
        linkId: 'link-1',
      });
      expect(commands('send_group_audio_link_heartbeat')).toEqual([
        {
          action: 'send_group_audio_link_heartbeat',
          payload: {
            roomId: ROOM,
            command: 'PONG',
            linkId: 'link-1',
            seq: 17,
            peerPresenceHash: HUB_HASH,
          },
        },
      ]);
    });

    it('does not answer heartbeats for a room it is not in (Hub parity)', async () => {
      const ping = () =>
        frame('group_call_message', {
          wire: { t: 'GAC', R: ROOM, c: 'PING', m: Date.now(), p: 3 },
          senderDestinationHash: HUB_HASH,
          peerPresenceHash: HUB_HASH,
          linkId: 'link-1',
        });
      ping();
      expect(commands('send_group_audio_link_heartbeat')).toEqual([]);

      const callId = await acceptInbound();
      await joinAsCallee(callId);
      ping();
      expect(commands('send_group_audio_link_heartbeat')).toHaveLength(1);

      await (window.groupCall as any).leave(
        ROOM,
        GO_ADDR,
        'leave-sig',
        'go-pk',
        Date.now()
      );
      ping();
      expect(commands('send_group_audio_link_heartbeat')).toHaveLength(1);
    });

    it('on leave sends GC_LEAVE over the link, then releases the link and the peer', async () => {
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      frame('group_audio_link_established', {
        linkId: 'link-1',
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        incoming: false,
      });
      native.commands = [];

      const result = await (window.groupCall as any).leave(
        ROOM,
        GO_ADDR,
        'leave-sig',
        'go-pk',
        1234
      );
      expect(result).toEqual({ success: true });
      const overLink = commands('send_group_audio').map((c) => ({
        linkId: c.payload.linkId,
        wire: decodeSentFrame(c.payload.data).wire,
      }));
      expect(overLink).toEqual([
        {
          linkId: 'link-1',
          wire: expect.objectContaining({
            t: 'GL',
            R: ROOM,
            a: GO_ADDR,
            g: 'leave-sig',
          }),
        },
      ]);
      expect(
        commands('fanout_group_call')[0].payload.messages[0]
      ).toMatchObject({
        t: 'GL',
        R: ROOM,
      });
      // The links close after the Hub's 350 ms drain, never before.
      expect(commands('close_group_audio_link')).toEqual([]);
      expect(commands('reset_group_audio_peer_state')).toEqual([]);
      vi.advanceTimersByTime(400);
      expect(commands('close_group_audio_link')).toEqual([
        {
          action: 'close_group_audio_link',
          payload: { linkId: 'link-1', reason: 'local_close' },
        },
      ]);
      // python only stops re-dialling a peer it opened a link to on a reset.
      expect(commands('reset_group_audio_peer_state')).toEqual([
        {
          action: 'reset_group_audio_peer_state',
          payload: { peerPresenceHash: HUB_HASH, reason: 'call-left' },
        },
      ]);

      // The Hub tearing down its side afterwards re-opens nothing.
      frame('group_audio_link_closed', {
        linkId: 'link-1',
        peerPresenceHash: HUB_HASH,
        reason: 'closed',
      });
      vi.advanceTimersByTime(10_000);
      expect(commands('open_group_audio_link')).toEqual([]);
    });

    it('keeps link-auth and media on the pinned call device', async () => {
      const OTHER = 'e'.repeat(32);
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      // Another device of the peer (or a leftover link) sends on the room.
      frame('group_audio_packet', {
        linkId: 'other-link',
        roomId: ROOM,
        peerPresenceHash: OTHER,
        peerDestinationHash: OTHER,
        receivedAtWallMs: Date.now(),
        data: btoa('x'.repeat(40)),
      });
      vi.advanceTimersByTime(3_100);
      expect(linkAuthSends('other-link')).toEqual([]);
      frame('group_call_message', {
        wire: { t: 'GAC', R: ROOM, c: 'PING', m: Date.now(), p: 1 },
        senderDestinationHash: OTHER,
        peerPresenceHash: OTHER,
        linkId: 'other-link',
      });
      expect(commands('send_group_audio_link_heartbeat')).toEqual([]);

      frame('group_audio_link_established', {
        linkId: 'link-1',
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        incoming: false,
      });
      native.commands = [];
      await (window.groupCall as any).sendAudio(
        ROOM,
        HUB_ADDR,
        new Uint8Array([1, 2, 3])
      );
      expect(commands('send_group_audio').map((c) => c.payload)).toEqual([
        expect.objectContaining({
          linkId: 'link-1',
          peerPresenceHash: HUB_HASH,
        }),
      ]);
      expect(
        native.commands.some((c) => c.payload?.linkId === 'other-link')
      ).toBe(false);
    });

    it('authenticates links it learned from frames or by destination hash only', async () => {
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      // An incoming link python could not map to a presence hash yet.
      frame('group_audio_link_established', {
        linkId: 'dest-only',
        peerPresenceHash: '',
        peerDestinationHash: HUB_HASH,
        incoming: true,
      });
      expect(linkAuthSends('dest-only')).toHaveLength(1);

      // The Hub accepts it (key request on the link) ...
      frame('group_audio_packet', {
        linkId: 'dest-only',
        roomId: ROOM,
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        receivedAtWallMs: 0,
        data: controlFrame({ t: 'GQ', R: ROOM, T: GO_ADDR, a: HUB_ADDR }),
      });
      // ... then replaces it with a link GO only sees through its frames.
      frame('group_audio_packet', {
        linkId: 'replacement',
        roomId: ROOM,
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        receivedAtWallMs: 0,
        data: controlFrame({ t: 'GJ', R: ROOM }),
      });
      expect(linkAuthSends('replacement')).toHaveLength(1);
      const sentBefore = linkAuthSends('dest-only').length;
      vi.advanceTimersByTime(3_100);
      expect(linkAuthSends('dest-only').length).toBe(sentBefore);
      expect(linkAuthSends('replacement').length).toBeGreaterThan(1);
    });

    it('never hands link control (GO0/GO1, unknown types) to the audio surface', async () => {
      const callId = await acceptInbound();
      await joinAsCallee(callId);
      const packet = (data: string) =>
        frame('group_audio_packet', {
          linkId: 'link-1',
          roomId: ROOM,
          peerPresenceHash: HUB_HASH,
          peerDestinationHash: HUB_HASH,
          receivedAtWallMs: Date.now(),
          data,
        });
      packet(controlFrame({ t: 'GO0', R: ROOM, z: 'a'.repeat(64), n: 2 }));
      packet(
        controlFrame({
          t: 'GO1',
          R: ROOM,
          z: 'a'.repeat(64),
          n: 2,
          x: 0,
          p: 'AA',
        })
      );
      packet(controlFrame({ t: 'GX', R: ROOM }));
      expect(gcEvents.filter(([e]) => e === 'gcall:audio')).toEqual([]);

      packet(
        btoa(String.fromCharCode(...new Array(60).fill(0).map((_, i) => i)))
      );
      expect(gcEvents.filter(([e]) => e === 'gcall:audio')).toHaveLength(1);
    });

    it('as the caller waits 4 s for the Hub to open the link, then opens it itself', async () => {
      const callId = createRouteBoundId('call', GO_HASH)!;
      await window.call!.initiate(
        HUB_ADDR,
        CHAT,
        GO_ADDR,
        'sig',
        'pk',
        callId,
        Date.now()
      );
      frame('call_message', {
        wire: { t: 'CA', c: callId, k: 'hub-pk', g: 'hub-sig', m: Date.now() },
        senderDestinationHash: HUB_HASH,
        peerPresenceHash: NEIGHBOR_HASH,
      });
      await (window.groupCall as any).join(
        ROOM,
        CHAT,
        GO_ADDR,
        'join-sig',
        'go-pk',
        Date.now(),
        GO_HASH,
        undefined,
        0,
        undefined,
        undefined,
        'waiter',
        undefined,
        undefined,
        callId
      );
      vi.advanceTimersByTime(3_500);
      expect(commands('open_group_audio_link')).toEqual([]);
      vi.advanceTimersByTime(1_000);
      expect(commands('open_group_audio_link')).toEqual([
        {
          action: 'open_group_audio_link',
          payload: { peerPresenceHash: HUB_HASH, activeCall: true },
        },
      ]);
    });

    it('as the caller does not open a second link when the Hub opened one', async () => {
      const callId = createRouteBoundId('call', GO_HASH)!;
      await window.call!.initiate(
        HUB_ADDR,
        CHAT,
        GO_ADDR,
        'sig',
        'pk',
        callId,
        Date.now()
      );
      frame('call_message', {
        wire: { t: 'CA', c: callId, k: 'hub-pk', g: 'hub-sig', m: Date.now() },
        senderDestinationHash: HUB_HASH,
        peerPresenceHash: NEIGHBOR_HASH,
      });
      await (window.groupCall as any).join(
        ROOM,
        CHAT,
        GO_ADDR,
        'join-sig',
        'go-pk',
        Date.now(),
        GO_HASH,
        undefined,
        0,
        undefined,
        undefined,
        'waiter',
        undefined,
        undefined,
        callId
      );
      frame('group_audio_link_established', {
        linkId: 'hub-link',
        peerPresenceHash: HUB_HASH,
        peerDestinationHash: HUB_HASH,
        incoming: true,
      });
      expect(linkAuthSends('hub-link')).toHaveLength(1);
      vi.advanceTimersByTime(5_000);
      expect(commands('open_group_audio_link')).toEqual([]);
    });

    it('puts the signed group join generation on the wire (contract order)', async () => {
      await (window.groupCall as any).join(
        'gcall-qortal-7',
        'group-chat-7',
        GO_ADDR,
        'join-sig',
        'go-pk',
        Date.now(),
        GO_HASH,
        123456,
        0,
        undefined,
        undefined,
        undefined,
        true
      );
      const [gj] = commands('fanout_group_call')[0].payload.messages;
      expect(gj.j).toBe(-1 - 123456);
    });
  });
});
