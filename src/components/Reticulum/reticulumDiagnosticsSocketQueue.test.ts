import { describe, expect, it, vi } from 'vitest';

// The report module's environment, as in reticulumDiagnostics.test.ts.
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: Object.create(actual.Capacitor, {
      isNativePlatform: { value: () => false },
      getPlatform: { value: () => 'web' },
    }),
  };
});
vi.mock('../../reticulumChat/mobile', () => ({
  getMobileReticulumChatDiagnostics: async () => null,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));
vi.mock('../../utils/nativeBcrypt', () => ({
  getNativeBcryptRuntimeInfo: vi.fn(async () => null),
}));

import type { EngineIoStats } from '../../reticulumChat/mobile/engineIoStats';
import type { SocketEventQueueStats } from '../../reticulumChat/mobile/socketEventPump';
import {
  formatEngineIoLines,
  formatSocketQueueLine,
} from './reticulumDiagnostics';

const AT = (h: number, m: number, s: number) => Date.UTC(2026, 9, 19, h, m, s);
const NOW = AT(13, 20, 0);

const QUEUE: SocketEventQueueStats = {
  depth: 3,
  oldestAgeMs: 1_240,
  maxDepth: 812,
  maxDepthAt: AT(13, 15, 59),
  enqueued: 9_000,
  handled: 8_400,
  wait: { n: 8_400, p50: 3, p95: 1_200, max: 70_400, maxAt: AT(13, 16, 0) },
  waitRecent: { n: 900, p50: 2, p95: 30, max: 80, maxAt: AT(13, 19, 0) },
  slices: 2_000,
  maxSliceMs: 45,
  staleGossipDropped: 598,
  staleGossipByKind: { dm_notify: 90, group_state_digest_v3: 500, typing: 8 },
  digestsCoalesced: 500,
  cleared: 0,
};

describe('Socket event queue line', () => {
  it('prints depth, wait and the stale gossip dropped', () => {
    expect(formatSocketQueueLine(QUEUE, NOW)).toBe(
      'Socket event queue: waiting 3 (oldest 1.2 s); most 812 at 13:15:59; wait p95 ~1.2 s max 70.4 s, last 10 min p95 ~30 ms; longest slice 45 ms; stale gossip dropped 598 (group_state_digest_v3=500 dm_notify=90 typing=8; 500 older digests merged)'
    );
  });

  it('stays short for a quiet queue and is absent for an older worker', () => {
    expect(
      formatSocketQueueLine(
        {
          ...QUEUE,
          depth: 0,
          oldestAgeMs: null,
          maxDepth: 1,
          maxDepthAt: null,
          wait: null,
          waitRecent: null,
          maxSliceMs: 0,
          staleGossipDropped: 0,
          staleGossipByKind: {},
          digestsCoalesced: 0,
        },
        NOW
      )
    ).toBe('Socket event queue: waiting 0; most 1; stale gossip dropped 0');
    expect(formatSocketQueueLine({ ...QUEUE, enqueued: 0 }, NOW)).toBeNull();
    expect(formatSocketQueueLine(undefined, NOW)).toBeNull();
    expect(formatSocketQueueLine(null, NOW)).toBeNull();
  });

  it('follows the socket frames line in the engine time section', () => {
    const io: EngineIoStats = {
      rpc: { calls: 0, methods: [] },
      flush: {
        installed: false,
        rate: { total: 0, recent: 0, minutes: 0 },
        recent: null,
      },
      commits: { total: 0, recent: 0, minutes: 0 },
      socketFrames: {
        rate: { total: 5_000, recent: 410, minutes: 10 },
        maxBackToBack: 37,
        maxBackToBackAt: AT(13, 1, 12),
        recentMaxBackToBack: 12,
      },
      socketQueue: QUEUE,
    };
    const lines = formatEngineIoLines(io, null, NOW);
    const frames = lines.findIndex((l) => l.startsWith('Socket frames:'));
    expect(frames).toBeGreaterThan(-1);
    expect(lines[frames + 1]).toMatch(/^Socket event queue: waiting 3 /);
    // Without the field (an older worker) the section is as before.
    const { socketQueue: _omit, ...older } = io;
    expect(
      formatEngineIoLines(older, null, NOW).some((l) =>
        l.startsWith('Socket event queue')
      )
    ).toBe(false);
  });
});
