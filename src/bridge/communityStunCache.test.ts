import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_STUN_CACHE_KEY,
  createCommunityStunCache,
  isPublicCommunityStunHost,
  probeStunWithWebRtc,
  type StunProbeResult,
} from './communityStunCache';

const PORT = 47321;
const MIN = 60_000;

describe('communityStunCache', () => {
  let clock: number;
  let store: Map<string, string>;
  let answering: Set<string>;
  let probed: string[];
  let allowed: boolean;

  const storage = () => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  const mk = (
    probe?: (host: string) => Promise<StunProbeResult>
  ): ReturnType<typeof createCommunityStunCache> =>
    createCommunityStunCache({
      now: () => clock,
      storage,
      probingAllowed: () => allowed,
      probe:
        probe ??
        (async (host) => {
          probed.push(host);
          return answering.has(host)
            ? { ok: true, rttMs: 100 }
            : { ok: false, rttMs: null };
        }),
    });
  const urls = (cache: ReturnType<typeof createCommunityStunCache>) =>
    cache
      .verifiedIceServers()
      .map((server) => server.urls)
      .sort();
  const hear = (
    cache: ReturnType<typeof createCommunityStunCache>,
    ...hosts: string[]
  ) => {
    for (const host of hosts) {
      cache.noteHeard({ host, port: PORT, expiresAt: clock + 10 * MIN });
    }
  };

  beforeEach(() => {
    clock = 1_000_000_000_000;
    store = new Map();
    answering = new Set();
    probed = [];
    allowed = true;
  });

  it('keeps only public IPv4 endpoints on the contributor port', () => {
    const cache = mk();
    cache.noteHeard({ host: 'a.example', port: PORT });
    cache.noteHeard({ host: '192.168.1.5', port: PORT });
    cache.noteHeard({ host: '100.64.0.1', port: PORT });
    cache.noteHeard({ host: '::1', port: PORT });
    cache.noteHeard({ host: '8.8.8.8', port: 3478 });
    cache.noteHeard(null);
    cache.noteHeard('8.8.8.8:47321');
    // An announcement that already expired, or claims more than 1 h.
    cache.noteHeard({ host: '8.8.8.8', port: PORT, expiresAt: clock - 1 });
    cache.noteHeard({
      host: '8.8.8.8',
      port: PORT,
      expiresAt: clock + 2 * 60 * MIN,
    });
    expect(cache.rows()).toEqual([]);
    expect(isPublicCommunityStunHost('68.83.3.62')).toBe(true);
    expect(isPublicCommunityStunHost('203.0.113.9')).toBe(false);
    expect(isPublicCommunityStunHost('256.1.1.1')).toBe(false);
  });

  it("remembers python's whole list with one storage write", () => {
    let writes = 0;
    const cache = createCommunityStunCache({
      now: () => clock,
      storage: () => ({
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          writes += 1;
          store.set(key, value);
        },
      }),
    });
    cache.noteHeardAll([
      { host: '1.1.1.1', port: PORT, expiresAt: clock + MIN },
      { host: '2.2.2.2', port: PORT, expiresAt: clock + MIN },
      { host: 'a.example', port: PORT, expiresAt: clock + MIN },
    ]);
    expect(writes).toBe(1);
    expect(
      mk()
        .rows()
        .map((row) => row.host)
        .sort()
    ).toEqual(['1.1.1.1', '2.2.2.2']);
    cache.noteHeardAll([{ host: '10.0.0.1', port: PORT }]);
    cache.noteHeardAll(undefined);
    cache.noteHeardAll([]);
    expect(writes).toBe(1);
  });

  it('serves only probe-verified endpoints, survives a restart, re-probes after 8 min', async () => {
    const cache = mk();
    hear(cache, '1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4');
    // Heard but never answered: not served.
    expect(cache.verifiedIceServers()).toEqual([]);
    answering.add('1.1.1.1');
    answering.add('3.3.3.3');
    await cache.refresh();
    expect([...probed].sort()).toEqual([
      '1.1.1.1',
      '2.2.2.2',
      '3.3.3.3',
      '4.4.4.4',
    ]);
    expect(urls(cache)).toEqual(['stun:1.1.1.1:47321', 'stun:3.3.3.3:47321']);

    // Persisted: a new instance (app restart) serves the same pool.
    expect(store.get(COMMUNITY_STUN_CACHE_KEY)).toBeTruthy();
    const restarted = mk();
    expect(urls(restarted)).toEqual([
      'stun:1.1.1.1:47321',
      'stun:3.3.3.3:47321',
    ]);

    // 9 min later the probes are stale; 3.3.3.3 switched contribution off.
    clock += 9 * MIN;
    answering.delete('3.3.3.3');
    expect(restarted.verifiedIceServers()).toEqual([]);
    probed = [];
    await restarted.refresh();
    expect(urls(restarted)).toEqual(['stun:1.1.1.1:47321']);

    // One attempt per endpoint a minute.
    probed = [];
    await restarted.refresh();
    expect(probed).toEqual([]);
  });

  it('never probes while probing is not allowed (Private calls)', async () => {
    const cache = mk();
    hear(cache, '1.1.1.1', '2.2.2.2');
    allowed = false;
    await cache.refresh();
    expect(probed).toEqual([]);
    expect(cache.verifiedIceServers()).toEqual([]);
    allowed = true;
    await cache.refresh();
    expect([...probed].sort()).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('forgets an endpoint 24 h after it was last heard or answered', async () => {
    const cache = mk();
    hear(cache, '1.1.1.1', '2.2.2.2');
    answering.add('1.1.1.1');
    await cache.refresh();
    clock += 23 * 60 * MIN;
    hear(cache, '2.2.2.2');
    clock += 2 * 60 * MIN;
    expect(
      mk()
        .rows()
        .map((row) => row.host)
    ).toEqual(['2.2.2.2']);
  });

  it('forgets an endpoint after 24 h in a long-lived instance too', async () => {
    const cache = mk();
    hear(cache, '1.1.1.1', '2.2.2.2');
    await cache.refresh();
    expect([...probed].sort()).toEqual(['1.1.1.1', '2.2.2.2']);
    clock += 23 * 60 * MIN;
    hear(cache, '2.2.2.2');
    // 30 h after 1.1.1.1 was last heard; it would answer now.
    clock += 7 * 60 * MIN;
    answering.add('1.1.1.1');
    answering.add('2.2.2.2');
    probed = [];
    await cache.refresh();
    expect(probed).toEqual(['2.2.2.2']);
    expect(urls(cache)).toEqual(['stun:2.2.2.2:47321']);
    expect(cache.rows().map((row) => row.host)).toEqual(['2.2.2.2']);
    // Persisted without it as well.
    expect(
      mk()
        .rows()
        .map((row) => row.host)
    ).toEqual(['2.2.2.2']);
  });

  it('keeps at most 32 rows, the most recently seen', () => {
    const cache = mk();
    for (let i = 1; i <= 40; i += 1) {
      clock += 1;
      hear(cache, `11.0.0.${i}`);
    }
    const hosts = mk()
      .rows()
      .map((row) => row.host);
    expect(hosts).toHaveLength(32);
    expect(hosts[0]).toBe('11.0.0.40');
    expect(hosts).not.toContain('11.0.0.8');
  });

  it('probes like the Hub: 3 at once, enough to fill 6, 18 a minute', async () => {
    let running = 0;
    let peak = 0;
    const cache = mk(async (host) => {
      probed.push(host);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 0));
      running -= 1;
      return { ok: false, rttMs: null };
    });
    for (let i = 1; i <= 30; i += 1) {
      clock += 1;
      hear(cache, `12.0.${i}.1`);
    }
    await cache.refresh();
    expect(probed).toHaveLength(6);
    expect(peak).toBe(3);
    await cache.refresh();
    await cache.refresh();
    expect(probed).toHaveLength(18);
    expect(new Set(probed).size).toBe(18);
    // Budget spent for this minute.
    await cache.refresh();
    expect(probed).toHaveLength(18);
    clock += MIN;
    await cache.refresh();
    expect(probed).toHaveLength(24);
  });

  it('does not probe more once 6 are verified', async () => {
    const cache = mk();
    const hosts = Array.from({ length: 8 }, (_, i) => `13.${i}.0.1`);
    hosts.forEach((host) => answering.add(host));
    hear(cache, ...hosts);
    await cache.refresh();
    expect(probed).toHaveLength(6);
    expect(cache.verifiedIceServers()).toHaveLength(6);
    probed = [];
    clock += 2 * MIN;
    await cache.refresh();
    expect(probed).toEqual([]);
  });

  it('serves one server per /24 first, fastest first', async () => {
    const rtt: Record<string, number> = {
      '14.0.0.1': 300,
      '14.0.0.2': 50,
      '15.0.0.1': 200,
      '16.0.0.1': 100,
    };
    const cache = mk(async (host) => ({ ok: true, rttMs: rtt[host] }));
    hear(cache, ...Object.keys(rtt));
    await cache.refresh();
    expect(cache.verifiedIceServers().map((s) => s.urls)).toEqual([
      'stun:14.0.0.2:47321',
      'stun:16.0.0.1:47321',
      'stun:15.0.0.1:47321',
      'stun:14.0.0.1:47321',
    ]);
    expect(cache.verifiedIceServers(2)).toHaveLength(2);
  });

  it('stops probing a dead endpoint until it is announced again', async () => {
    const cache = mk();
    hear(cache, '17.0.0.1');
    for (let i = 0; i < 6; i += 1) {
      await cache.refresh();
      clock += MIN;
    }
    expect(probed).toHaveLength(6);
    await cache.refresh();
    expect(probed).toHaveLength(6);
    // Heard again soon after the last failure: still not retried.
    hear(cache, '17.0.0.1');
    await cache.refresh();
    expect(probed).toHaveLength(6);
    // Heard again 10 min after it: one more try, and it answers.
    clock += 10 * MIN;
    hear(cache, '17.0.0.1');
    answering.add('17.0.0.1');
    await cache.refresh();
    expect(probed).toHaveLength(7);
    expect(urls(cache)).toEqual(['stun:17.0.0.1:47321']);
  });

  it("python's reply re-listing one announcement does not revive a dead endpoint", async () => {
    const cache = mk();
    // One announcement with a 1 h lease, as python lists it on every pull.
    const held = [
      { host: '17.0.0.2', port: PORT, expiresAt: clock + 60 * MIN },
    ];
    for (let i = 0; i < 6; i += 1) {
      cache.noteHeardAll(held);
      await cache.refresh();
      clock += MIN;
    }
    expect(probed).toHaveLength(6);
    for (let i = 0; i < 5; i += 1) {
      clock += 10 * MIN;
      cache.noteHeardAll(held);
      await cache.refresh();
    }
    expect(probed).toHaveLength(6);
    expect(cache.rows()[0].heardAt).toBe(clock);
    // A new announcement (later expiry) in the reply: one more try.
    cache.noteHeardAll([
      { host: '17.0.0.2', port: PORT, expiresAt: clock + 10 * MIN },
    ]);
    await cache.refresh();
    expect(probed).toHaveLength(7);
    // An event without an expiry still counts as a new announcement, the
    // same entry in a reply does not.
    clock += 10 * MIN;
    cache.noteHeardAll([{ host: '17.0.0.2', port: PORT }]);
    await cache.refresh();
    expect(probed).toHaveLength(7);
    cache.noteHeard({ host: '17.0.0.2', port: PORT });
    await cache.refresh();
    expect(probed).toHaveLength(8);
  });

  it('works in memory when storage throws or holds junk', async () => {
    const throwing = createCommunityStunCache({
      now: () => clock,
      storage: () => ({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
      probe: async () => ({ ok: true, rttMs: 10 }),
    });
    hear(throwing, '18.0.0.1');
    await throwing.refresh();
    expect(throwing.verifiedIceServers()).toEqual([
      { urls: 'stun:18.0.0.1:47321' },
    ]);

    store.set(COMMUNITY_STUN_CACHE_KEY, '{not json');
    expect(mk().rows()).toEqual([]);
    store.set(
      COMMUNITY_STUN_CACHE_KEY,
      JSON.stringify({
        v: 1,
        rows: [
          { host: '10.0.0.1', port: PORT, heardAt: clock },
          { host: '19.0.0.1', port: 3478, heardAt: clock },
          { host: '19.0.0.2', port: PORT, heardAt: clock },
          { host: '19.0.0.2', port: PORT, heardAt: clock },
        ],
      })
    );
    expect(
      mk()
        .rows()
        .map((row) => row.host)
    ).toEqual(['19.0.0.2']);
  });

  it('a probe that throws counts as a failure', async () => {
    const cache = mk(() => {
      throw new Error('no RTCPeerConnection');
    });
    hear(cache, '20.0.0.1');
    await cache.refresh();
    expect(cache.rows()[0].failStreak).toBe(1);
    expect(cache.verifiedIceServers()).toEqual([]);
  });
});

describe('probeStunWithWebRtc', () => {
  type Behaviour = 'srflx' | 'host-then-end' | 'silent';
  let behaviour: Behaviour;
  let created: Array<{ config: RTCConfiguration; closed: boolean }>;

  class FakePc extends EventTarget {
    record: { config: RTCConfiguration; closed: boolean };
    constructor(config: RTCConfiguration) {
      super();
      this.record = { config, closed: false };
      created.push(this.record);
    }
    createDataChannel() {
      return {};
    }
    async createOffer() {
      return { type: 'offer', sdp: '' };
    }
    async setLocalDescription() {
      const emit = (candidate: unknown) => {
        const event = new Event('icecandidate');
        (event as unknown as { candidate: unknown }).candidate = candidate;
        this.dispatchEvent(event);
      };
      if (behaviour === 'silent') return;
      queueMicrotask(() => {
        if (behaviour === 'srflx') {
          emit({
            type: 'srflx',
            candidate:
              'candidate:1 1 udp 1686052607 198.51.100.7 40000 typ srflx raddr 0.0.0.0 rport 0',
          });
        } else {
          emit({
            type: 'host',
            candidate: 'candidate:2 1 udp 2122260223 0.0.0.0 9 typ host',
          });
          emit(null);
        }
      });
    }
    close() {
      this.record.closed = true;
    }
  }

  beforeEach(() => {
    created = [];
    vi.stubGlobal('RTCPeerConnection', FakePc);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('answers ok on a server-reflexive candidate and closes the connection', async () => {
    behaviour = 'srflx';
    const result = await probeStunWithWebRtc('21.0.0.1', PORT, 1_500);
    expect(result.ok).toBe(true);
    expect(typeof result.rttMs).toBe('number');
    expect(created).toHaveLength(1);
    expect(created[0].config).toEqual({
      iceServers: [{ urls: 'stun:21.0.0.1:47321' }],
    });
    expect(created[0].closed).toBe(true);
  });

  it('fails when gathering ends without one', async () => {
    behaviour = 'host-then-end';
    await expect(probeStunWithWebRtc('21.0.0.1', PORT, 1_500)).resolves.toEqual(
      { ok: false, rttMs: null }
    );
    expect(created[0].closed).toBe(true);
  });

  it('fails after the timeout when the server never answers', async () => {
    vi.useFakeTimers();
    behaviour = 'silent';
    const pending = probeStunWithWebRtc('21.0.0.1', PORT, 1_500);
    await vi.advanceTimersByTimeAsync(1_499);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, rttMs: null });
    expect(created[0].closed).toBe(true);
  });

  it('fails without RTCPeerConnection', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    await expect(probeStunWithWebRtc('21.0.0.1', PORT, 1_500)).resolves.toEqual(
      { ok: false, rttMs: null }
    );
  });
});
