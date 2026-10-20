/**
 * The slice of the desktop `PresenceManager` (electron/src/presence.ts) that
 * the hosted Hub call managers read:
 *   - CallManager: getRoutesForAddress (invite every live device of the
 *     callee; resolve an unbound caller's endpoint), getRouteForAddress
 *   - GroupCallManager: getRouteForAddress / getRoutesForAddress (audio peer
 *     destination fallback, DM pin check for non-call joins)
 *
 * Fed from an injected source so capacitorBridge can hand over its live
 * account endpoints (`liveAccountEndpoints()`, CB ~1628). Ordering mirrors
 * PresenceManager.getRoutesForAddress: binding-verified first, then freshest.
 *
 * Note (plan 1.4): GO's presence endpoints are learned from presence frames
 * that GO does not signature-verify today; `verified` should only be set for
 * endpoints whose signed presence envelope was checked.
 */
import type { PresenceRoute } from '../../../electron/src/presence';

export type MobilePresenceEndpoint = {
  destinationHash: string;
  lastSeen: number;
  /** Route binding verified (signed presence envelope checked). */
  verified?: boolean;
};

export interface MobilePresenceSource {
  /** Live Reticulum endpoints (presence destination hashes) of an account. */
  getEndpoints(address: string): MobilePresenceEndpoint[];
}

export type MobilePresenceAdapterOptions = {
  /**
   * Endpoints older than this are not routes. Default 90 s = CB
   * PRESENCE_TTL_MS (desktop: 45 s route TTL inside a live session).
   */
  maxAgeMs?: number;
  /** Excluded from every route list (a looped-back announce of our own device). */
  getLocalDestinationHash?: () => string | undefined;
  now?: () => number;
};

const DEST_HASH_RE = /^[0-9a-f]{32}$/;
const DEFAULT_MAX_AGE_MS = 90_000;

export class MobilePresenceAdapter {
  private readonly source: MobilePresenceSource;
  private readonly options: MobilePresenceAdapterOptions;

  constructor(
    source: MobilePresenceSource,
    options: MobilePresenceAdapterOptions = {}
  ) {
    this.source = source;
    this.options = options;
  }

  getRoutesForAddress(address: string): PresenceRoute[] {
    if (typeof address !== 'string' || !address.trim()) return [];
    let endpoints: MobilePresenceEndpoint[] = [];
    try {
      endpoints = this.source.getEndpoints(address.trim()) ?? [];
    } catch {
      endpoints = [];
    }
    const now = this.options.now?.() ?? Date.now();
    const maxAgeMs = this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const local = this.options
      .getLocalDestinationHash?.()
      ?.trim()
      .toLowerCase();
    const byHash = new Map<string, MobilePresenceEndpoint>();
    for (const endpoint of endpoints) {
      const hash = String(endpoint?.destinationHash || '')
        .trim()
        .toLowerCase();
      if (!DEST_HASH_RE.test(hash) || hash === local) continue;
      const lastSeen = Number(endpoint.lastSeen) || 0;
      if (maxAgeMs > 0 && now - lastSeen > maxAgeMs) continue;
      const previous = byHash.get(hash);
      if (
        !previous ||
        lastSeen > previous.lastSeen ||
        (endpoint.verified === true && previous.verified !== true)
      ) {
        byHash.set(hash, {
          destinationHash: hash,
          lastSeen: Math.max(lastSeen, previous?.lastSeen ?? 0),
          verified: endpoint.verified === true || previous?.verified === true,
        });
      }
    }
    return [...byHash.values()]
      .sort((left, right) => {
        if (left.verified !== right.verified) return left.verified ? -1 : 1;
        if (left.lastSeen !== right.lastSeen) {
          return right.lastSeen - left.lastSeen;
        }
        return left.destinationHash.localeCompare(right.destinationHash);
      })
      .map((endpoint) => ({
        kind: 'reticulum' as const,
        destinationHash: endpoint.destinationHash,
      }));
  }

  getRouteForAddress(address: string): PresenceRoute | null {
    return this.getRoutesForAddress(address)[0] ?? null;
  }
}
