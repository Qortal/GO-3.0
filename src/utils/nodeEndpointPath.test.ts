import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => key) },
}));

import {
  assertSafeNodeEndpoint,
  endpointPathPart,
  hasDotSegment,
  joinNodeEndpoint,
  nodePathSegment,
  UnsafeNodeEndpointError,
} from './nodeEndpointPath';

const NODE = 'http://127.0.0.1:12391';

describe('assertSafeNodeEndpoint', () => {
  it.each([
    '/admin/status',
    '/crosschain/ltc/feekb',
    '/lists/blockedNames_q-tube',
    '/arbitrary/resources/search?service=APP&query=a/../b&limit=5',
    '/arbitrary/THUMBNAIL/Some%20Name/qortal_avatar',
    '/arbitrary/APP/name.with.dots/...',
    '/names/a..b',
    '/arbitrary/resources?query=%2e%2e',
    '/search?q=#tag',
    '/names/a;b',
    '/arbitrary/APP/name/...;x',
    '/arbitrary/resources?query=..;x%00%u002e',
  ])('accepts a normal endpoint: %s', (endpoint) => {
    expect(assertSafeNodeEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([
    ['plain dot-dot', '/crosschain/../admin/apikey/generate'],
    ['single dot', '/crosschain/./tradebot'],
    ['trailing dot-dot', '/lists/..'],
    ['encoded dot-dot', '/crosschain/%2e%2e/tradebot'],
    ['upper-case encoding', '/crosschain/%2E%2E/tradebot'],
    ['half encoded', '/crosschain/.%2e/tradebot'],
    ['double encoded', '/crosschain/%252e%252e/tradebot'],
    ['backslash separator', '/crosschain/..\\admin/stop'],
    ['encoded slash around dots', '/lists/x%2F..%2F..%2Fsettings'],
    ['tab inside dots', '/crosschain/.\t./admin'],
    ['newline inside dots', '/crosschain/.\n./admin'],
    ['fragment before query', '/lists/x#?apiKey'],
    ['missing leading slash', 'crosschain/ltc/feekb'],
    ['host continuation', '.evil.example/x'],
    ['empty string', ''],
    ['dot-dot with a path parameter', '/x/..;/admin'],
    ['dot with a path parameter', '/x/.;/admin'],
    ['dot-dot with a named parameter', '/x/..;jsessionid=1/admin'],
    [
      'repeated parameter traversal',
      '/arbitrary/DOCUMENT/n/..;/..;/..;/admin/apikey/generate',
    ],
    ['encoded semicolon after dots', '/x/%2e%2e%3b/admin'],
    ['legacy %u encoding', '/x/%u002e%u002e/admin'],
    ['legacy %u encoding, upper case', '/x/%U002E%U002E/admin'],
    ['legacy %u slash', '/x/..%u002f../admin'],
    ['double-encoded %u', '/x/%25u002e%25u002e/admin'],
    ['encoded NUL after dots', '/x/..%00/admin'],
    ['encoded NUL anywhere in the path', '/names/a%00b'],
    ['double-encoded NUL after dots', '/x/..%2500/admin'],
  ])('refuses %s', (_label, endpoint) => {
    expect(() => assertSafeNodeEndpoint(endpoint)).toThrow(
      UnsafeNodeEndpointError
    );
  });

  it('refuses something that is not a string', () => {
    expect(() => assertSafeNodeEndpoint(undefined)).toThrow(
      'question:message.error.unsafe_node_path'
    );
    expect(() => assertSafeNodeEndpoint(42)).toThrow(UnsafeNodeEndpointError);
  });
});

describe('hasDotSegment / endpointPathPart', () => {
  it('only looks at whole segments', () => {
    expect(hasDotSegment('/a..b/c')).toBe(false);
    expect(hasDotSegment('/.../c')).toBe(false);
    expect(hasDotSegment('/a/../c')).toBe(true);
  });

  it('cuts the path at the query or fragment', () => {
    expect(endpointPathPart('/a/b?c=../d')).toBe('/a/b');
    expect(endpointPathPart('/a/b#frag')).toBe('/a/b');
    expect(endpointPathPart('/a/b')).toBe('/a/b');
  });

  it('ignores a path parameter or NUL only when the rest is a dot segment', () => {
    expect(hasDotSegment('/a/..;x/c')).toBe(true);
    expect(hasDotSegment('/a/.;/c')).toBe(true);
    expect(hasDotSegment('/a/..\0/c')).toBe(true);
    expect(hasDotSegment('/a/b;../c')).toBe(false);
    expect(hasDotSegment('/a/;/c')).toBe(false);
    expect(hasDotSegment('/a/...;x/c')).toBe(false);
  });

  it('decodes the legacy %u form', () => {
    expect(hasDotSegment('/a/%u002e%u002e/c')).toBe(true);
    expect(hasDotSegment('/a/%u0041/c')).toBe(false);
  });

  it('leaves a literal percent sign alone', () => {
    expect(hasDotSegment('/names/100%25')).toBe(false);
    expect(hasDotSegment('/names/100%')).toBe(false);
  });
});

describe('joinNodeEndpoint', () => {
  it('returns exactly base + endpoint for a normal path', () => {
    expect(joinNodeEndpoint(NODE, '/admin/status')).toBe(
      'http://127.0.0.1:12391/admin/status'
    );
    expect(
      joinNodeEndpoint('https://ext-node.qortal.link', '/addresses/balance/Q1')
    ).toBe('https://ext-node.qortal.link/addresses/balance/Q1');
  });

  it('keeps a base path prefix', () => {
    expect(joinNodeEndpoint('https://host.example/qortal', '/admin/info')).toBe(
      'https://host.example/qortal/admin/info'
    );
  });

  it('refuses an endpoint that would change the host', () => {
    expect(() =>
      joinNodeEndpoint('https://ext-node.qortal.link', '.evil.example/x')
    ).toThrow(UnsafeNodeEndpointError);
  });

  it('refuses traversal out of the configured node URL', () => {
    expect(() =>
      joinNodeEndpoint(NODE, '/crosschain/%2e%2e/admin/apikey/generate')
    ).toThrow(UnsafeNodeEndpointError);
  });

  it('still checks the path when the base is not a URL yet', () => {
    expect(joinNodeEndpoint('', '/admin/status')).toBe('/admin/status');
    expect(() => joinNodeEndpoint('', '/a/../b')).toThrow(
      UnsafeNodeEndpointError
    );
  });
});

describe('nodePathSegment', () => {
  it('encodes characters that would change the path or query', () => {
    expect(nodePathSegment('a/b')).toBe('a%2Fb');
    expect(nodePathSegment('x?apiKey=1')).toBe('x%3FapiKey%3D1');
    expect(nodePathSegment('x#y')).toBe('x%23y');
    expect(nodePathSegment('blocked names')).toBe('blocked%20names');
  });

  it('accepts numbers such as group ids', () => {
    expect(nodePathSegment(694)).toBe('694');
  });

  it('encodes a semicolon', () => {
    expect(nodePathSegment('a;b')).toBe('a%3Bb');
  });

  it.each([
    '',
    '.',
    '..',
    '%2e%2e',
    '..%2F..',
    'a/../b',
    '.\t.',
    '..;x',
    '.;',
    '%u002e%u002e',
    '..%00',
  ])('refuses %j', (value) => {
    expect(() => nodePathSegment(value)).toThrow(UnsafeNodeEndpointError);
  });

  it('refuses values that are not strings or numbers', () => {
    expect(() => nodePathSegment(undefined)).toThrow(UnsafeNodeEndpointError);
    expect(() => nodePathSegment({ toString: () => '..' })).toThrow(
      UnsafeNodeEndpointError
    );
  });
});
