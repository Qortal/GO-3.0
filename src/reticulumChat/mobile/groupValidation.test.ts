import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  apiHostOf,
  apiSchemeOf,
  buildGroupValidationRequest,
  createGroupValidatorStats,
  membershipProbeResult,
  recordGroupValidation,
  redactDiagnosticText,
  runGroupValidationRequest,
  toWorkerNodeConfig,
} from './groupValidation';

const ADDRESS = 'QfdpbaGasRtFSYyFu73xsnghgXHcRYrLTP';

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
      { fetchImpl }
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
      { fetchImpl: async () => jsonResponse({ error: 'nope' }, 404) }
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
      { fetchImpl: async () => jsonResponse({ isMember: true }) }
    );
    expect(odd).toMatchObject({
      row: null,
      status: 200,
      error: 'unexpected response body',
    });
    const fetchImpl = vi.fn();
    const noBase = await runGroupValidationRequest('', 1, ADDRESS, {
      fetchImpl,
    });
    expect(noBase).toMatchObject({ row: null, error: 'no Core API base' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a missing row as "not a member"', async () => {
    const outcome = await runGroupValidationRequest(
      'http://localhost:52391',
      1,
      ADDRESS,
      { fetchImpl: async () => jsonResponse([]) }
    );
    expect(outcome.row).toEqual({ isMember: false, isAdmin: false });
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
