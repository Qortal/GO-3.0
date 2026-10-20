/**
 * GO's counterpart of the Hub's verified community STUN pool
 * (electron/src/stun-cache.ts + stun-coordinator.ts). GO only uses the pool;
 * it never contributes, announces or serves STUN itself.
 *
 * Why GO needs it: a contributor re-announces every 2 min with a 10 min
 * lease, but every RNS transport node applies its default announce rate
 * target (3600 s, grace 5) per destination. After the first few announces of
 * a contributor's daily identity, each hub passes on about one an hour. A
 * phone that keeps only endpoints whose announce is still inside its lease
 * (python's _community_stun_recent_endpoints, capacitorBridge
 * liveCommunityIceServers) therefore holds 0-3 servers. A Hub keeps every
 * endpoint it ever heard in stun-cache.db, and serves it for up to 24 h while
 * a local STUN probe answered within the last 8 min.
 *
 * This module does the same for GO, in the WebView:
 *  - every heard endpoint (python event or reply) is remembered in
 *    localStorage: at most 32, public IPv4 on port 47321 only, forgotten 24 h
 *    after it was last heard or last answered a probe;
 *  - only probe-verified endpoints are served from here (answered within
 *    8 min), so a contributor that switched contribution off (its STUN
 *    socket closes at once) drops out as it does on a Hub;
 *  - the probe is a one-server RTCPeerConnection that waits for a
 *    server-reflexive candidate: the same binding request ICE sends in a
 *    call. It goes through GO's RTCPeerConnection privacy guard like any
 *    call (webrtcPrivacy.ts);
 *  - probes run only when a caller asks for ICE servers (refresh()), never
 *    from a timer, and never in "Private calls" (Reticulum only), where no
 *    STUN traffic may leave the phone. Budget as on the Hub: 3 at once, 18 a
 *    minute, 1.5 s each, one attempt per endpoint a minute.
 *
 * Every storage access is wrapped: storage can throw (private mode, blocked
 * storage, previews) and the in-memory pool keeps working without it.
 */

export const COMMUNITY_STUN_CACHE_KEY = 'go.communityStun.v1';
/** stun-bootstrap STUN_FIXED_UDP_PORT: the only port a contributor uses. */
export const COMMUNITY_STUN_PORT = 47321;
/** Hub STUN_CACHE_MAX_ROWS. */
export const COMMUNITY_STUN_MAX_ROWS = 32;
/** Hub ICE_STUN_SERVER_CAP. */
export const COMMUNITY_STUN_SERVE_CAP = 6;
/** Hub STUN_PROBE_FRESHNESS_MS. */
export const COMMUNITY_STUN_PROBE_FRESHNESS_MS = 8 * 60_000;
/** Hub CACHED_REPROBE_MAX_SUCCESS_AGE_MS: forget a row after this. */
export const COMMUNITY_STUN_MAX_AGE_MS = 24 * 60 * 60_000;
/** Hub PROBE_TIMEOUT_MS. */
export const COMMUNITY_STUN_PROBE_TIMEOUT_MS = 1_500;
/** Hub STUN_PROBE_FAILURE_THRESHOLD. */
const PROBE_FAILURE_THRESHOLD = 2;
/** Hub CACHED_REPROBE_REQUEST_MIN_INTERVAL_MS: one try per endpoint a minute. */
const MIN_ATTEMPT_INTERVAL_MS = 60_000;
const MAX_CONCURRENT_PROBES = 3;
const PROBES_PER_MINUTE = 18;
/** After this many failures in a row (none answered since) no more probes, */
const DEAD_FAIL_STREAK = 6;
/**
 * until a new announcement (not python re-listing a held one) arrives at
 * least this long after its last failure.
 */
const DEAD_REHEARD_RETRY_MS = 10 * 60_000;
/** Python accepts announcements valid for at most 1 h (Hub does the same). */
const MAX_ANNOUNCE_TTL_MS = 60 * 60_000;

export type CommunityStunRow = {
  host: string;
  port: number;
  /** Last time an announcement (event or python reply) named it. */
  heardAt: number;
  /**
   * Expiry of the latest announcement heard (0 = none given). Python's reply
   * repeats one announcement until it expires; a later expiry is a new one.
   */
  announcedExpiresAt: number;
  /** Last successful probe (0 = never). */
  okAt: number;
  /** Last failed probe (0 = never). */
  failAt: number;
  failStreak: number;
  /** Probe round trip, smoothed like the Hub's probe_rtt_ewma. */
  rttMs: number;
};

export type StunProbeResult = { ok: boolean; rttMs: number | null };
export type StunProbe = (
  host: string,
  port: number,
  timeoutMs: number
) => Promise<StunProbeResult>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type CommunityStunCacheOptions = {
  now?: () => number;
  storage?: () => StorageLike | null | undefined;
  probe?: StunProbe;
  /** False in "Private calls": no STUN traffic may leave the phone. */
  probingAllowed?: () => boolean;
};

/** Same rule as the Hub's isPublicCommunityStunHost (stun-coordinator.ts). */
export function isPublicCommunityStunHost(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

const ipv4Prefix24 = (host: string): string =>
  host.slice(0, host.lastIndexOf('.'));

const isSrflxCandidate = (
  candidate: { type?: string | null; candidate?: string } | null
): boolean =>
  !!candidate &&
  (candidate.type === 'srflx' ||
    / typ srflx(\s|$)/.test(candidate.candidate || ''));

/**
 * STUN binding probe through the WebView's own ICE agent: ok when the one
 * configured server returns a server-reflexive candidate. Built through
 * window.RTCPeerConnection, i.e. GO's privacy guard, which keeps public IPv4
 * srflx candidates (raddr zeroed) and never lets a host candidate out.
 */
export const probeStunWithWebRtc: StunProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const Pc = (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection })
      .RTCPeerConnection;
    if (typeof Pc !== 'function') {
      resolve({ ok: false, rttMs: null });
      return;
    }
    const startedAt = Date.now();
    let pc: RTCPeerConnection | null = null;
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
      resolve({ ok, rttMs: ok ? Date.now() - startedAt : null });
    };
    try {
      pc = new Pc({ iceServers: [{ urls: `stun:${host}:${port}` }] });
      pc.addEventListener('icecandidate', (event) => {
        const candidate = (event as RTCPeerConnectionIceEvent).candidate;
        // End of gathering without a reflexive candidate: no answer.
        if (!candidate) {
          finish(false);
          return;
        }
        if (isSrflxCandidate(candidate)) finish(true);
      });
      // A data channel is enough to start gathering; no media is touched.
      pc.createDataChannel('stun-probe');
      pc.createOffer()
        .then((offer) => (settled ? undefined : pc?.setLocalDescription(offer)))
        .catch(() => finish(false));
    } catch {
      finish(false);
    }
  });

export function createCommunityStunCache(
  options: CommunityStunCacheOptions = {}
) {
  const now = options.now ?? (() => Date.now());
  const storage =
    options.storage ??
    (() => (globalThis as { localStorage?: StorageLike }).localStorage);
  const probe = options.probe ?? probeStunWithWebRtc;
  const probingAllowed = options.probingAllowed ?? (() => true);

  let rows: CommunityStunRow[] | null = null;
  let active = 0;
  let budget = PROBES_PER_MINUTE;
  let budgetResetAt = Number.NEGATIVE_INFINITY;
  const inFlight = new Map<string, Promise<void>>();

  const keyOf = (host: string, port: number) => `${host}:${port}`;
  const lastSeen = (r: CommunityStunRow) => Math.max(r.heardAt, r.okAt);

  const prune = (): void => {
    if (!rows) return;
    const cutoff = now() - COMMUNITY_STUN_MAX_AGE_MS;
    rows = rows
      .filter((r) => lastSeen(r) >= cutoff)
      .sort((a, b) => lastSeen(b) - lastSeen(a))
      .slice(0, COMMUNITY_STUN_MAX_ROWS);
  };

  const readStored = (): CommunityStunRow[] => {
    const stored: CommunityStunRow[] = [];
    try {
      const raw = storage()?.getItem(COMMUNITY_STUN_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.rows)) {
        const seen = new Set<string>();
        for (const r of parsed.rows) {
          if (
            !r ||
            typeof r.host !== 'string' ||
            !isPublicCommunityStunHost(r.host) ||
            r.port !== COMMUNITY_STUN_PORT ||
            seen.has(keyOf(r.host, r.port))
          ) {
            continue;
          }
          seen.add(keyOf(r.host, r.port));
          stored.push({
            host: r.host,
            port: r.port,
            heardAt: Number(r.heardAt) || 0,
            announcedExpiresAt: Number(r.announcedExpiresAt) || 0,
            okAt: Number(r.okAt) || 0,
            failAt: Number(r.failAt) || 0,
            failStreak: Math.max(0, Number(r.failStreak) || 0),
            rttMs: Math.max(0, Number(r.rttMs) || 0),
          });
        }
      }
    } catch {
      /* unreadable cache: start empty */
    }
    return stored;
  };

  /**
   * The rows, pruned on every read: in a long-lived WebView a row must also
   * drop out 24 h after it was last heard or answered, not only at restart.
   */
  const load = (): CommunityStunRow[] => {
    if (!rows) rows = readStored();
    prune();
    return rows;
  };

  const save = (): void => {
    const list = load();
    try {
      storage()?.setItem(
        COMMUNITY_STUN_CACHE_KEY,
        JSON.stringify({ v: 1, rows: list })
      );
    } catch {
      /* storage blocked or full: the in-memory pool still works */
    }
  };

  const isFresh = (r: CommunityStunRow, at: number): boolean =>
    r.okAt > 0 &&
    r.okAt >= at - COMMUNITY_STUN_PROBE_FRESHNESS_MS &&
    (r.okAt > r.failAt || r.failStreak < PROBE_FAILURE_THRESHOLD);

  const isDead = (r: CommunityStunRow): boolean =>
    r.failAt >= r.okAt && r.failStreak >= DEAD_FAIL_STREAK;

  /**
   * Adds or refreshes one row in memory; false when the endpoint is ignored.
   * `fromEvent`: a `community_stun_endpoint` event, which python emits only
   * when an announce arrives (its reply re-lists held ones).
   */
  const remember = (endpoint: unknown, fromEvent: boolean): boolean => {
    if (!endpoint || typeof endpoint !== 'object') return false;
    const e = endpoint as {
      host?: unknown;
      port?: unknown;
      expiresAt?: unknown;
    };
    const host = typeof e.host === 'string' ? e.host.trim() : '';
    const port = Number(e.port);
    if (!isPublicCommunityStunHost(host) || port !== COMMUNITY_STUN_PORT) {
      return false;
    }
    const at = now();
    const hasExpiry = e.expiresAt !== undefined && e.expiresAt !== null;
    const expiresAt = hasExpiry ? Number(e.expiresAt) : 0;
    if (
      hasExpiry &&
      (!Number.isFinite(expiresAt) ||
        expiresAt <= at ||
        expiresAt > at + MAX_ANNOUNCE_TTL_MS)
    ) {
      return false;
    }
    const list = load();
    const row = list.find((r) => r.host === host && r.port === port);
    if (row) {
      row.heardAt = at;
      // Python's reply lists a held announcement again on every pull until
      // it expires (up to 1 h): only a later expiry, or an event when none
      // is given, is a new announcement.
      const isNewAnnouncement = hasExpiry
        ? expiresAt > row.announcedExpiresAt
        : fromEvent;
      if (expiresAt > row.announcedExpiresAt) {
        row.announcedExpiresAt = expiresAt;
      }
      // Announced again: the contributor is up. One more try (the Hub probes
      // every endpoint it hears), at most once per retry interval.
      if (
        isNewAnnouncement &&
        isDead(row) &&
        at - row.failAt >= DEAD_REHEARD_RETRY_MS
      ) {
        row.failStreak = DEAD_FAIL_STREAK - 1;
      }
    } else {
      list.push({
        host,
        port,
        heardAt: at,
        announcedExpiresAt: expiresAt,
        okAt: 0,
        failAt: 0,
        failStreak: 0,
        rttMs: 0,
      });
      prune();
    }
    return true;
  };

  /**
   * Remember one announced endpoint (`{host, port, expiresAt?}`, the shape of
   * python's `community_stun_endpoint` event). Anything that is not a public
   * IPv4 on the contributor port, or whose announcement already expired (or
   * claims more than 1 h), is ignored.
   */
  const noteHeard = (endpoint: unknown): void => {
    if (remember(endpoint, true)) save();
  };

  /** Python's `get_community_stun_endpoints` list: one storage write. */
  const noteHeardAll = (endpoints: unknown): void => {
    if (!Array.isArray(endpoints)) return;
    let changed = false;
    for (const endpoint of endpoints) {
      changed = remember(endpoint, false) || changed;
    }
    if (changed) save();
  };

  /**
   * Probe-verified servers (answered within 8 min), fewest recent failures
   * and fastest first, one per /24 first (Hub selectTopIceServers), then
   * the rest. `{urls}` only, as RTCPeerConnection takes them.
   */
  const verifiedIceServers = (
    limit = COMMUNITY_STUN_SERVE_CAP
  ): { urls: string }[] => {
    const at = now();
    const max = Math.max(0, Math.min(limit, COMMUNITY_STUN_SERVE_CAP));
    const ranked = load()
      .filter((r) => isFresh(r, at))
      .sort((a, b) => a.failStreak - b.failStreak || a.rttMs - b.rttMs);
    const picked: CommunityStunRow[] = [];
    const used24 = new Set<string>();
    for (const r of ranked) {
      if (picked.length >= max) break;
      const p24 = ipv4Prefix24(r.host);
      if (used24.has(p24)) continue;
      used24.add(p24);
      picked.push(r);
    }
    for (const r of ranked) {
      if (picked.length >= max) break;
      if (!picked.includes(r)) picked.push(r);
    }
    return picked.map((r) => ({ urls: `stun:${r.host}:${r.port}` }));
  };

  const probeRow = (r: CommunityStunRow): Promise<void> => {
    const key = keyOf(r.host, r.port);
    const running = inFlight.get(key);
    if (running) return running;
    active += 1;
    budget -= 1;
    let pending: Promise<StunProbeResult>;
    try {
      pending = Promise.resolve(
        probe(r.host, r.port, COMMUNITY_STUN_PROBE_TIMEOUT_MS)
      );
    } catch {
      pending = Promise.resolve({ ok: false, rttMs: null });
    }
    const done = pending
      .catch((): StunProbeResult => ({ ok: false, rttMs: null }))
      .then((result) => {
        const at = now();
        if (result && result.ok) {
          r.okAt = at;
          r.failStreak = 0;
          if (typeof result.rttMs === 'number' && result.rttMs >= 0) {
            r.rttMs = r.rttMs
              ? Math.round(r.rttMs * 0.7 + result.rttMs * 0.3)
              : result.rttMs;
          }
        } else {
          r.failAt = at;
          r.failStreak += 1;
        }
        save();
      })
      .finally(() => {
        active -= 1;
        inFlight.delete(key);
      });
    inFlight.set(key, done);
    return done;
  };

  /**
   * Probe the best endpoints that are not fresh, at most enough to fill the
   * serve cap. Resolves when this round (and any probe already running) is
   * done; never rejects. No-op in "Private calls".
   */
  const refresh = (): Promise<void> => {
    if (!probingAllowed()) return Promise.resolve();
    const at = now();
    if (at - budgetResetAt >= 60_000) {
      budget = PROBES_PER_MINUTE;
      budgetResetAt = at;
    }
    const list = load();
    const freshCount = list.filter((r) => isFresh(r, at)).length;
    const wanted = Math.max(0, COMMUNITY_STUN_SERVE_CAP - freshCount);
    // Checked again right before each probe: another refresh may have
    // probed the row since this one was queued.
    const due = (r: CommunityStunRow, t: number): boolean =>
      !isFresh(r, t) &&
      !isDead(r) &&
      !inFlight.has(keyOf(r.host, r.port)) &&
      Math.max(r.okAt, r.failAt) <= t - MIN_ATTEMPT_INTERVAL_MS;
    const queue = list
      .filter((r) => due(r, at))
      // Answered most recently first, then heard most recently.
      .sort((a, b) => b.okAt - a.okAt || b.heardAt - a.heardAt)
      .slice(0, wanted);
    const worker = async (): Promise<void> => {
      while (
        queue.length > 0 &&
        budget > 0 &&
        active < MAX_CONCURRENT_PROBES &&
        probingAllowed()
      ) {
        const r = queue.shift();
        if (r && due(r, now())) await probeRow(r);
      }
    };
    const tasks: Promise<void>[] = [...inFlight.values()];
    const workers = Math.min(
      Math.max(0, MAX_CONCURRENT_PROBES - active),
      queue.length
    );
    for (let i = 0; i < workers; i += 1) tasks.push(worker());
    return Promise.all(tasks).then(
      () => undefined,
      () => undefined
    );
  };

  return {
    noteHeard,
    noteHeardAll,
    verifiedIceServers,
    refresh,
    /** Diagnostics and tests: a copy of the rows (no probing). */
    rows: (): CommunityStunRow[] => load().map((r) => ({ ...r })),
  };
}

export type CommunityStunCache = ReturnType<typeof createCommunityStunCache>;
