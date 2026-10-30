import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiHostOf,
  apiSchemeOf,
  buildGroupValidationRequest,
  createGroupValidatorStats,
  groupValidationFailReason,
  membershipProbeResult,
  recordGroupValidationBatch,
  recordGroupValidationUnsent,
  redactDiagnosticText,
  runGroupValidationBatchRequest,
  runGroupValidationRequest,
  toWorkerNodeConfig,
  type GroupValidationOutcome,
  type GroupValidatorStats,
} from './groupValidation';

const ADDRESS = 'QfdpbaGasRtFSYyFu73xsnghgXHcRYrLTP';

/** One single-address request, recorded through the batch recorder. */
function recordGroupValidation(
  stats: GroupValidatorStats,
  outcome: GroupValidationOutcome,
  host: string,
  at = Date.now(),
  options: { own?: boolean; retried?: boolean } = {}
): void {
  const { row, ...rest } = outcome;
  recordGroupValidationBatch(
    stats,
    { ...rest, rows: new Map([['', row]]) },
    host,
    at,
    { own: () => options.own === true, retried: options.retried }
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerNames(init: RequestInit): string[] {
  return Object.keys((init.headers ?? {}) as Record<string, string>).map((h) =>
    h.toLowerCase()
  );
}

describe('groupValidation', () => {
  it('builds a keyless request: Content-Type only, no key in header or URL', () => {
    const { url, init } = buildGroupValidationRequest(
      'http://localhost:52391/',
      1144,
      ADDRESS
    );
    expect(url).toBe('http://localhost:52391/groups/members/1144/validate');
    expect(init.method).toBe('POST');
    expect(headerNames(init)).toEqual(['content-type']);
    expect(init.body).toBe(JSON.stringify([ADDRESS]));
  });

  it('never forwards a key even when one sneaks into the base URL', () => {
    const { url, init } = buildGroupValidationRequest(
      'http://user:pw@localhost:52391/?apiKey=K#frag',
      7,
      ADDRESS
    );
    expect(url).toBe('http://localhost:52391/groups/members/7/validate');
    expect(url).not.toMatch(/apikey|K#|user|pw/i);
    expect(headerNames(init)).not.toContain('x-api-key');
  });

  it('sends the keyless request even when the node has a key configured', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ address: ADDRESS, isMember: true, isAdmin: false }])
    );
    // An older main thread pushed the key; the worker config drops it.
    const config = toWorkerNodeConfig({
      apiBase: 'http://localhost:52391',
      apiKey: 'K',
      apiKeyConfigured: true,
    });
    expect(config).toEqual({
      apiBase: 'http://localhost:52391',
      apiKeyConfigured: true,
    });
    const outcome = await runGroupValidationRequest(
      config.apiBase,
      1144,
      ADDRESS,
      { fetchImpl, resourceTiming: null }
    );
    expect(outcome.row).toEqual({ isMember: true, isAdmin: false });
    expect(outcome.status).toBe(200);
    expect(outcome.error).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).not.toMatch(/apikey/i);
    expect(headerNames(init)).toEqual(['content-type']);
    expect(JSON.stringify(init.headers)).not.toContain('K"');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('cannot keep a stale key across config pushes', () => {
    const first = toWorkerNodeConfig({
      apiBase: 'http://localhost:52391',
      apiKey: 'OLD',
      apiKeyConfigured: true,
    });
    const next = toWorkerNodeConfig(
      { apiBase: 'https://ext-node.qortal.link', apiKeyConfigured: false },
      first
    );
    expect(next).toEqual({
      apiBase: 'https://ext-node.qortal.link',
      apiKeyConfigured: false,
    });
    expect(JSON.stringify(next)).not.toContain('OLD');
    // Missing fields keep the previous values; an explicit null means unknown.
    expect(toWorkerNodeConfig({}, next)).toEqual(next);
    expect(toWorkerNodeConfig({ apiKeyConfigured: null }, next)).toEqual({
      apiBase: 'https://ext-node.qortal.link',
      apiKeyConfigured: null,
    });
  });

  it('returns null with the HTTP status on a non-OK answer', async () => {
    const outcome = await runGroupValidationRequest(
      'http://localhost:52391',
      1144,
      ADDRESS,
      {
        fetchImpl: async () => jsonResponse({ error: 'nope' }, 404),
        resourceTiming: null,
      }
    );
    expect(outcome).toMatchObject({
      row: null,
      status: 404,
      error: 'HTTP 404',
    });
  });

  it('returns null with the error name and message when fetch throws (CORS)', async () => {
    const outcome = await runGroupValidationRequest(
      'http://localhost:52391',
      1144,
      ADDRESS,
      {
        fetchImpl: async () => {
          throw new TypeError(
            'Failed to fetch http://localhost:52391/x?apiKey=SECRET'
          );
        },
        resourceTiming: null,
      }
    );
    expect(outcome.row).toBeNull();
    expect(outcome.status).toBeNull();
    expect(outcome.error).toBe('TypeError: Failed to fetch <url>');
    expect(outcome.error).not.toContain('SECRET');
  });

  it('reports a timeout rather than a bare abort', async () => {
    vi.useFakeTimers();
    try {
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            }),
          resourceTiming: null,
        }
      );
      await vi.advanceTimersByTimeAsync(1_000);
      const outcome = await pending;
      expect(outcome.row).toBeNull();
      expect(outcome.error).toBe('AbortError: no answer in 1000 ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null for an unexpected body and when no base is known', async () => {
    const odd = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      {
        fetchImpl: async () => jsonResponse({ isMember: true }),
        resourceTiming: null,
      }
    );
    expect(odd).toMatchObject({
      row: null,
      status: 200,
      error: 'unexpected response body',
    });
    const fetchImpl = vi.fn();
    const noBase = await runGroupValidationRequest('', 1, ADDRESS, {
      fetchImpl,
      resourceTiming: null,
    });
    expect(noBase).toMatchObject({ row: null, error: 'no Core API base' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a missing row as unknown, never as "not a member"', async () => {
    const outcome = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      { fetchImpl: async () => jsonResponse([]), resourceTiming: null }
    );
    expect(outcome).toMatchObject({
      row: null,
      status: 200,
      error: 'address missing from answer',
      reason: 'missing_row',
    });
  });

  describe('a timer that fires late (worker stall)', () => {
    let resolveFetch: ((res: Response) => void) | null;
    const deferredFetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });

    beforeEach(() => {
      vi.useFakeTimers();
      resolveFetch = null;
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps an answer that lands while the worker is stalled past the deadline', async () => {
      let clock = 0;
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          now: () => clock,
          fetchImpl: deferredFetch,
          resourceTiming: null,
        }
      );
      clock = 2_600;
      // The timer sees itself 1,600 ms late and re-arms once.
      await vi.advanceTimersByTimeAsync(1_000);
      resolveFetch!(
        jsonResponse([{ address: ADDRESS, isMember: true, isAdmin: false }])
      );
      const outcome = await pending;
      expect(outcome).toMatchObject({
        row: { isMember: true, isAdmin: false },
        error: null,
        graced: true,
        timerLateMs: 1_600,
      });
      expect(outcome.timedOut).toBeUndefined();
    });

    it('grants the grace only once', async () => {
      let clock = 0;
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          now: () => clock,
          fetchImpl: deferredFetch,
          resourceTiming: null,
        }
      );
      clock = 2_600;
      await vi.advanceTimersByTimeAsync(1_000);
      clock = 5_000;
      await vi.advanceTimersByTimeAsync(1_500);
      const outcome = await pending;
      expect(outcome).toMatchObject({
        row: null,
        graced: true,
        timedOut: true,
        error:
          'AbortError: no answer in 1000 ms (worker stalled 1600 ms; grace 1500 ms)',
      });
    });

    it('aborts on time when the timer is not late', async () => {
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          now: () => Date.now(),
          fetchImpl: deferredFetch,
          resourceTiming: null,
        }
      );
      await vi.advanceTimersByTimeAsync(1_000);
      const outcome = await pending;
      expect(outcome.error).toBe('AbortError: no answer in 1000 ms');
      expect(outcome.graced).toBeUndefined();
      expect(outcome.timedOut).toBe(true);
    });
  });

  it('measures the network time from Resource Timing', async () => {
    // The browser hands out the same entry objects on every read.
    const entries = [
      { startTime: 5, responseEnd: 40 },
      { startTime: 12, responseEnd: 62 },
    ];
    const perf = {
      now: () => 10,
      getEntriesByName: vi.fn(() => entries),
      getEntriesByType: () => new Array(201),
      clearResourceTimings: vi.fn(),
    };
    const fetchImpl = async () =>
      jsonResponse([{ address: ADDRESS, isMember: true, isAdmin: false }]);
    const first = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      { fetchImpl, resourceTiming: perf }
    );
    // The entry that started before the request (5 < 10 - 1) is not ours.
    expect(first.networkMs).toBe(50);
    expect(perf.getEntriesByName).toHaveBeenCalledWith(
      'http://localhost:52391/groups/members/1/validate',
      'resource'
    );
    expect(perf.clearResourceTimings).toHaveBeenCalledTimes(1);
    // Same entries again: the matching one is already claimed.
    const second = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      { fetchImpl, resourceTiming: perf }
    );
    expect(second.networkMs).toBeNull();
    expect(second.row).toEqual({ isMember: true, isAdmin: false });
  });

  it('keeps the timing buffer from filling up with unread entries', async () => {
    // Like Chromium: 250 entries, then new ones are dropped until cleared.
    let t = 0;
    const entries: Array<{
      name: string;
      startTime: number;
      responseEnd: number;
    }> = [];
    const perf = {
      now: () => (t += 3),
      getEntriesByName: (name: string) =>
        entries.filter((entry) => entry.name === name),
      getEntriesByType: () => entries,
      clearResourceTimings: vi.fn(() => {
        entries.length = 0;
      }),
    };
    const answer = (json: () => Promise<unknown>) => async (url: string) => {
      t += 10;
      if (entries.length < 250) {
        entries.push({ name: url, startTime: t, responseEnd: t + 5 });
      }
      return { ok: true, status: 200, json } as unknown as Response;
    };
    // A captive portal answers 200 with HTML: the body never parses.
    for (let i = 0; i < 300; i += 1) {
      const outcome = await runGroupValidationRequest(
        'http://127.0.0.1:12391',
        694,
        ADDRESS,
        {
          resourceTiming: perf,
          fetchImpl: answer(async () => {
            throw new SyntaxError('Unexpected token <');
          }),
        }
      );
      expect(outcome.row).toBeNull();
    }
    expect(entries.length).toBeLessThanOrEqual(201);
    expect(perf.clearResourceTimings).toHaveBeenCalled();
    const healthy = await runGroupValidationRequest(
      'http://127.0.0.1:12391',
      694,
      ADDRESS,
      { resourceTiming: perf, fetchImpl: answer(async () => []) }
    );
    expect(healthy.networkMs).toBe(5);
  });

  it('counts graced, timed out and own requests and keeps 32 timings', () => {
    const stats = createGroupValidatorStats();
    const ok = { isMember: true, isAdmin: false };
    recordGroupValidation(
      stats,
      {
        row: ok,
        status: 200,
        error: null,
        ms: 9_050,
        networkMs: 50,
        graced: true,
        timerLateMs: 1_600,
      },
      'h',
      1,
      { own: true }
    );
    expect(stats.recentWorkerWaitMs).toEqual([9_000]);
    recordGroupValidation(
      stats,
      {
        row: null,
        status: null,
        error: 'AbortError: no answer in 12000 ms',
        ms: 12_000,
        timedOut: true,
      },
      'h',
      2,
      { own: true }
    );
    for (let i = 0; i < 40; i++) {
      recordGroupValidation(
        stats,
        { row: ok, status: 200, error: null, ms: 20, networkMs: 10 },
        'h',
        3 + i
      );
    }
    expect(stats).toMatchObject({
      okCount: 41,
      unavailableCount: 1,
      gracedCount: 1,
      gracedKeptCount: 1,
      timedOutCount: 1,
      maxTimerLateMs: 1_600,
      ownCount: 2,
      ownUnavailableCount: 1,
    });
    expect(stats.recentNetworkMs).toHaveLength(32);
    expect(stats.recentNetworkMs![31]).toBe(10);
    expect(stats.recentWorkerWaitMs).toHaveLength(32);
    expect(stats.recentWorkerWaitMs![31]).toBe(10);
    expect(stats.recentWorkerWaitMs).not.toContain(9_000);
  });

  it('counts outcomes and keeps the last error after a later success', () => {
    const stats = createGroupValidatorStats();
    recordGroupValidation(
      stats,
      { row: null, status: null, error: 'TypeError: Failed to fetch', ms: 3 },
      'localhost:52391',
      1_000
    );
    recordGroupValidation(
      stats,
      {
        row: { isMember: true, isAdmin: false },
        status: 200,
        error: null,
        ms: 84,
      },
      'localhost:52391',
      2_000
    );
    expect(stats).toEqual({
      okCount: 1,
      unavailableCount: 1,
      lastStatus: 200,
      lastMs: 84,
      lastAt: 2_000,
      lastError: 'TypeError: Failed to fetch',
      lastErrorAt: 1_000,
      host: 'localhost:52391',
      timedOutCount: 0,
      gracedCount: 0,
      gracedKeptCount: 0,
      maxTimerLateMs: 0,
      maxInFlight: 0,
      ownCount: 0,
      ownUnavailableCount: 0,
      ownListAnswers: 0,
      ownBootWaits: 0,
      ownBootWaitTimeouts: 0,
      ownCoreDenied: 0,
      recentNetworkMs: [],
      recentWorkerWaitMs: [],
      requestCount: 2,
      maxBatchSize: 1,
      failByReason: { network: 1 },
      firstFailAt: 1_000,
      lastOkAt: 2_000,
      recentFailures: [{ at: 1_000, reason: 'network', addresses: 1 }],
    });
  });

  it('shapes the probe result and exposes hosts only', () => {
    expect(
      membershipProbeResult(
        {
          row: { isMember: true, isAdmin: false },
          status: 200,
          error: null,
          ms: 84,
        },
        'localhost:52391',
        1144
      )
    ).toEqual({
      host: 'localhost:52391',
      groupId: 1144,
      status: 200,
      ok: true,
      isMember: true,
      error: null,
      ms: 84,
    });
    expect(apiHostOf('http://localhost:52391/?apiKey=K')).toBe(
      'localhost:52391'
    );
    expect(apiHostOf('https://ext-node.qortal.link')).toBe(
      'ext-node.qortal.link'
    );
    expect(apiHostOf('not a url')).toBe('');
    expect(apiSchemeOf('https://localhost:52391/?apiKey=K')).toBe('https');
    expect(apiSchemeOf('http://127.0.0.1:12391')).toBe('http');
    expect(apiSchemeOf('not a url')).toBe('');
  });

  it('redacts URLs and key values from diagnostic text', () => {
    expect(
      redactDiagnosticText(
        'X-API-KEY: abc123 failed for https://node.example/admin?apiKey=abc123 (apikey=abc123)'
      )
    ).toBe('X-API-KEY: <redacted> failed for <url> (apikey=<redacted>)');
    expect(redactDiagnosticText('Node API key: set')).toBe('Node API key: set');
  });

  it('keeps the worker membership request free of API keys', () => {
    const source = readFileSync(resolve(__dirname, 'engineHost.ts'), 'utf8');
    expect(source).not.toMatch(/x-api-key|[?&]apiKey=|config\.apiKey\b/i);
  });
});

const SECOND = 'QM8eUjZLNTQS9wosWJbcvPEtAUeMkcEraS';
const THIRD = 'QZm1JUnN9aB8Tbi7Csx1mcVYmz5i6Ad2Wz';

describe('batched group validation', () => {
  it('sends the addresses as one list and maps the rows back per address', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      // Out of order, an extra row and a duplicate: only the address counts.
      jsonResponse([
        { address: THIRD, isMember: false, isAdmin: null },
        { address: ADDRESS, isMember: true, isAdmin: true },
        { address: 'QOther', isMember: true, isAdmin: false },
        { address: ADDRESS, isMember: false, isAdmin: false },
      ])
    );
    const outcome = await runGroupValidationBatchRequest(
      'http://localhost:52391',
      1144,
      [ADDRESS, SECOND, THIRD, ADDRESS],
      { fetchImpl, resourceTiming: null }
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:52391/groups/members/1144/validate');
    expect(JSON.parse(String(init.body))).toEqual([ADDRESS, SECOND, THIRD]);
    expect(headerNames(init)).toEqual(['content-type']);
    expect([...outcome.rows]).toEqual([
      [ADDRESS, { isMember: true, isAdmin: true }],
      // Left out of the answer: unknown, not "not a member".
      [SECOND, null],
      [THIRD, { isMember: false, isAdmin: false }],
    ]);
    expect(outcome).toMatchObject({
      status: 200,
      reason: 'missing_row',
      error: '1 of 3 addresses missing from answer',
    });
  });

  it('answers every address unknown on a 200 []', async () => {
    const outcome = await runGroupValidationBatchRequest(
      'http://localhost:52391',
      1,
      [ADDRESS, SECOND],
      { fetchImpl: async () => jsonResponse([]), resourceTiming: null }
    );
    expect([...outcome.rows.values()]).toEqual([null, null]);
    expect(outcome.reason).toBe('missing_row');
  });

  it('leaves the whole list unknown on a 400, for the host to split', async () => {
    const outcome = await runGroupValidationBatchRequest(
      'http://localhost:52391',
      1,
      [ADDRESS, 'not-an-address'],
      {
        fetchImpl: async () =>
          jsonResponse({ error: 102, message: 'invalid address' }, 400),
        resourceTiming: null,
      }
    );
    expect(outcome).toMatchObject({
      status: 400,
      reason: 'http:400',
      error: 'HTTP 400',
    });
    expect([...outcome.rows.values()]).toEqual([null, null]);
  });

  it("names Core's GROUP_UNKNOWN 404 apart from any other 404", async () => {
    const unknownGroup = await runGroupValidationRequest(
      'http://localhost:52391',
      99_999,
      ADDRESS,
      {
        fetchImpl: async () =>
          jsonResponse({ error: 1101, message: 'group unknown' }, 404),
        resourceTiming: null,
      }
    );
    expect(unknownGroup).toMatchObject({
      row: null,
      status: 404,
      reason: 'group_unknown',
      error: 'HTTP 404 (group unknown)',
    });
    const oldNode = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      {
        fetchImpl: async () => new Response('Not Found', { status: 404 }),
        resourceTiming: null,
      }
    );
    expect(oldNode).toMatchObject({ reason: 'http:404', error: 'HTTP 404' });
  });

  it('gives every failure its reason', async () => {
    const run = (
      fetchImpl: (url: string, init: RequestInit) => Promise<Response>
    ) =>
      runGroupValidationRequest('http://localhost:52391', 1, ADDRESS, {
        fetchImpl,
        resourceTiming: null,
      });
    expect(
      (
        await run(async () => {
          throw new TypeError('Failed to fetch');
        })
      ).reason
    ).toBe('network');
    expect((await run(async () => jsonResponse({}, 500))).reason).toBe(
      'http:500'
    );
    expect((await run(async () => jsonResponse({ rows: [] }))).reason).toBe(
      'bad_body'
    );
    expect(
      (await run(async () => new Response('<html>', { status: 200 }))).reason
    ).toBe('bad_body');
    expect(
      (
        await runGroupValidationRequest('', 1, ADDRESS, {
          resourceTiming: null,
        })
      ).reason
    ).toBe('no_base');
    expect(
      (
        await run(async () =>
          jsonResponse([{ address: ADDRESS, isMember: true, isAdmin: false }])
        )
      ).reason
    ).toBeNull();
  });

  it('fills failByReason and the ring from real request outcomes', async () => {
    const stats = createGroupValidatorStats();
    const run = (
      fetchImpl: (url: string, init: RequestInit) => Promise<Response>
    ) =>
      runGroupValidationRequest('http://localhost:52391', 1, ADDRESS, {
        fetchImpl,
        resourceTiming: null,
      });
    const outcomes: GroupValidationOutcome[] = [
      await run(async () => {
        throw new TypeError('Failed to fetch');
      }),
      await run(async () => jsonResponse({ error: 'boom' }, 500)),
      await run(async () => jsonResponse({ error: 2 }, 404)),
      await run(async () => jsonResponse({ rows: [] })),
    ];
    vi.useFakeTimers();
    try {
      let clock = 0;
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          now: () => clock,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            }),
          resourceTiming: null,
        }
      );
      clock = 2_600;
      await vi.advanceTimersByTimeAsync(1_000);
      clock = 5_000;
      await vi.advanceTimersByTimeAsync(1_500);
      outcomes.push(await pending);
    } finally {
      vi.useRealTimers();
    }
    outcomes.forEach((outcome, i) =>
      recordGroupValidation(stats, outcome, 'localhost:52391', 10_000 + i)
    );
    expect(stats.failByReason).toEqual({
      network: 1,
      'http:500': 1,
      'http:404': 1,
      bad_body: 1,
      stall_abort: 1,
    });
    expect(stats.recentFailures).toEqual([
      { at: 10_000, reason: 'network', addresses: 1 },
      { at: 10_001, reason: 'http:500', addresses: 1 },
      { at: 10_002, reason: 'http:404', addresses: 1 },
      { at: 10_003, reason: 'bad_body', addresses: 1 },
      { at: 10_004, reason: 'stall_abort', addresses: 1 },
    ]);
    expect(stats).toMatchObject({
      firstFailAt: 10_000,
      lastOkAt: null,
      requestCount: 5,
      unavailableCount: 5,
      gracedCount: 1,
    });
  });

  it('calls a timeout after a worker stall a stall_abort', async () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const pending = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          now: () => clock,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            }),
          resourceTiming: null,
        }
      );
      clock = 2_600;
      await vi.advanceTimersByTimeAsync(1_000);
      clock = 5_000;
      await vi.advanceTimersByTimeAsync(1_500);
      const outcome = await pending;
      expect(outcome).toMatchObject({
        row: null,
        timedOut: true,
        graced: true,
        reason: 'stall_abort',
      });
      const plain = runGroupValidationRequest(
        'http://localhost:52391',
        1,
        ADDRESS,
        {
          timeoutMs: 1_000,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            }),
          resourceTiming: null,
        }
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await plain).reason).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts addresses, requests, reasons and the last 8 failures', () => {
    const stats = createGroupValidatorStats();
    const own = (address: string) => address === ADDRESS;
    const row = { isMember: true, isAdmin: false };
    recordGroupValidationBatch(
      stats,
      {
        rows: new Map([
          [ADDRESS, row],
          [SECOND, null],
          [THIRD, row],
        ]),
        status: 200,
        error: '1 of 3 addresses missing from answer',
        reason: 'missing_row',
        ms: 30,
      },
      'h',
      1_000,
      { own }
    );
    expect(stats).toMatchObject({
      okCount: 2,
      unavailableCount: 1,
      ownCount: 1,
      ownUnavailableCount: 0,
      requestCount: 1,
      maxBatchSize: 3,
      failByReason: { missing_row: 1 },
      firstFailAt: 1_000,
      lastOkAt: 1_000,
      recentFailures: [{ at: 1_000, reason: 'missing_row', addresses: 1 }],
    });
    // A request that is asked again does not count its addresses.
    recordGroupValidationBatch(
      stats,
      {
        rows: new Map([
          [ADDRESS, null],
          [SECOND, null],
        ]),
        status: null,
        error: 'AbortError: no answer in 12000 ms',
        ms: 400_000,
        timedOut: true,
        graced: true,
        timerLateMs: 388_000,
      },
      'h',
      2_000,
      { own, retried: true }
    );
    expect(stats).toMatchObject({
      okCount: 2,
      unavailableCount: 1,
      ownCount: 1,
      requestCount: 2,
      timedOutCount: 1,
      gracedCount: 1,
      gracedKeptCount: 0,
      failByReason: { missing_row: 1, stall_abort: 1 },
    });
    // Hand-built outcomes (no reason field) are classified too.
    const failures: Array<[Partial<GroupValidationOutcome>, string]> = [
      [{ status: null, error: 'TypeError: Failed to fetch' }, 'network'],
      [{ status: 500, error: 'HTTP 500' }, 'http:500'],
      [{ status: 404, error: 'HTTP 404' }, 'http:404'],
      [{ status: 200, error: 'unexpected response body' }, 'bad_body'],
      [{ status: null, error: 'no Core API base' }, 'no_base'],
      [{ status: null, error: 'AbortError', timedOut: true }, 'timeout'],
    ];
    failures.forEach(([fields, reason], i) => {
      expect(
        groupValidationFailReason({ status: null, error: null, ...fields })
      ).toBe(reason);
      recordGroupValidation(
        stats,
        { row: null, status: null, error: null, ms: 1, ...fields },
        'h',
        3_000 + i
      );
    });
    recordGroupValidationUnsent(stats, [SECOND, ADDRESS], 'queue_full', 9_000, {
      own,
    });
    expect(stats.failByReason).toEqual({
      missing_row: 1,
      stall_abort: 1,
      network: 1,
      'http:500': 1,
      'http:404': 1,
      bad_body: 1,
      no_base: 1,
      timeout: 1,
      queue_full: 1,
    });
    expect(stats).toMatchObject({
      unavailableCount: 9,
      ownCount: 2,
      ownUnavailableCount: 1,
      firstFailAt: 1_000,
      lastOkAt: 1_000,
    });
    expect(stats.recentFailures).toHaveLength(8);
    // Nine failures: the oldest (missing_row) has dropped out.
    expect(stats.recentFailures![0]).toEqual({
      at: 2_000,
      reason: 'stall_abort',
      addresses: 2,
    });
    expect(stats.recentFailures![7]).toEqual({
      at: 9_000,
      reason: 'queue_full',
      addresses: 2,
    });
  });
});
