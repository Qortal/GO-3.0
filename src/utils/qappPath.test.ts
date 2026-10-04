import { describe, expect, it } from 'vitest';
import {
  buildQappRenderUrl,
  encodeQappPath,
  encodeQappSegment,
  isQappTabTargetSafe,
  isSafeQappName,
  isSafeQappPath,
  isSafeQappService,
  pickQappTabTarget,
} from './qappPath';

const NODE = 'http://127.0.0.1:12391';

// Ways to climb out of /render/APP/Q-Wallets/ (audit GO-21 and variants).
const TRAVERSAL_PATHS = [
  '../../../render/APP/Evil',
  '..\\..\\..\\render\\APP/Evil',
  '%2e%2e/%2e%2e/%2e%2e/render/APP/Evil',
  '%2E%2E/%2E%2E/render/APP/Evil',
  '.%2e/.%2e/render/APP/Evil',
  '%2e./render/APP/Evil',
  '..;/..;/..;/render/APP/Evil',
  '%2e%2e;x/render/APP/Evil',
  '..%3b/render/APP/Evil',
  '..%2f..%2f..%2frender%2fAPP%2fEvil',
  '..%5c..%5crender%5cAPP%5cEvil',
  'video/./../../../render/APP/Evil',
  '.\n./.\t./render/APP/Evil',
  '.%0a./render/APP/Evil',
  './x',
  'a/..',
  // Overlong UTF-8 for "." and "/", which no browser sends but some servers
  // decode, and double encoding that a second decode turns into "..".
  '%c0%ae%c0%ae/render/APP/Evil',
  '%e0%80%ae%e0%80%ae/render/APP/Evil',
  '..%c0%af..%c0%afrender/APP/Evil',
  '%c0%2e%c0%2e/render/APP/Evil',
  '%252e%252e/%252e%252e/render/APP/Evil',
  '%25252e%25252e/render/APP/Evil',
  '..%252f..%252frender%252fAPP%252fEvil',
  '%252e%252e%253bx/render/APP/Evil',
  '%2525252e%2525252e/render/APP/Evil',
];

describe('isSafeQappService', () => {
  it.each(['APP', 'WEBSITE', 'QCHAT_ATTACHMENT', 'app'])('accepts %s', (s) => {
    expect(isSafeQappService(s)).toBe(true);
  });

  it.each(['', '..', 'APP/..', 'APP?', 'USE-GROUP', '_APP', undefined, 3])(
    'refuses %s',
    (s) => {
      expect(isSafeQappService(s)).toBe(false);
    }
  );
});

describe('isSafeQappName', () => {
  it.each([
    'Q-Wallets',
    'Q Tube',
    'Q%20Tube',
    'Qortal Hub',
    "Joe's App",
    'name.with.dots',
    'Q.',
    '...',
    'Ünïcødé',
    'a+b',
    '100%',
    '100%25',
    'Q%2520Tube',
    'café',
    'caf%C3%A9',
  ])('accepts %s', (name) => {
    expect(isSafeQappName(name)).toBe(true);
  });

  it.each([
    '',
    '   ',
    '.',
    '..',
    '%2e',
    '%2e%2e',
    '.%2E',
    '..;x',
    'Q-Wallets/../Evil',
    'Q-Wallets%2f..%2fEvil',
    'Q-Wallets\\..\\Evil',
    'Q-Wallets%5c..',
    'Q-Wallets?x=1',
    'Q-Wallets%3Fx',
    'Q-Wallets#x',
    'Q-Wallets%23x',
    'Q-Wallets\n',
    'Q-Wallets%00',
    '%c0%ae%c0%ae',
    '%e0%80%ae%e0%80%ae',
    'Q-Wallets%c0%af..',
    'Q-Wallets%ff',
    '%252e%252e',
    'Q-Wallets%252f..%252fEvil',
    'Q-Wallets%253Fx',
    'Q-Wallets%2523x',
    'Q-Wallets%250a',
    '%2525252e',
    'x'.repeat(129),
    '\ud800',
    null,
    undefined,
    42,
  ])('refuses %j', (name) => {
    expect(isSafeQappName(name)).toBe(false);
  });
});

describe('isSafeQappPath', () => {
  it.each([
    '',
    null,
    undefined,
    'video/QTUBE_VIDEO_abc',
    '/post/alice/id-1',
    'post/A%20B/x',
    'qortal?authOnMount=true',
    '#/route/x',
    '/search?q=../../etc',
    'page#../../x',
    'a//b/',
    '@alice/feed',
    'file:name.txt',
    'v1.2/notes..txt',
    'caf%C3%A9/100%',
    'a%2520b',
    '/search?q=%c0%ae%c0%ae',
  ])('accepts %j', (path) => {
    expect(isSafeQappPath(path)).toBe(true);
  });

  it.each(TRAVERSAL_PATHS)('refuses %j', (path) => {
    expect(isSafeQappPath(path)).toBe(false);
  });

  it('refuses a path that is not a string', () => {
    expect(isSafeQappPath({ toString: () => 'x' })).toBe(false);
  });
});

describe('encodeQappSegment / encodeQappPath', () => {
  it('leaves already-encoded and path-safe text as the browser would', () => {
    expect(encodeQappSegment('Q%20Tube')).toBe('Q%20Tube');
    expect(encodeQappSegment('QTUBE_VIDEO_abc-1.2~')).toBe(
      'QTUBE_VIDEO_abc-1.2~'
    );
    expect(encodeQappSegment("@a:b+c,d;e=f!$&'()*")).toBe(
      "@a:b+c,d;e=f!$&'()*"
    );
  });

  it('encodes spaces, non-ASCII, lone % and delimiters', () => {
    expect(encodeQappSegment('Q Tube')).toBe('Q%20Tube');
    expect(encodeQappSegment('ü')).toBe('%C3%BC');
    expect(encodeQappSegment('😀')).toBe('%F0%9F%98%80');
    expect(encodeQappSegment('100%')).toBe('100%25');
    expect(encodeQappSegment('a"b<c>`{}|')).toBe('a%22b%3Cc%3E%60%7B%7D%7C');
  });

  it('encodes ";" in names only, so the node cannot cut the name short', () => {
    expect(encodeQappSegment('a;b')).toBe('a;b');
    expect(encodeQappSegment('a;b', { encodeSemicolon: true })).toBe('a%3Bb');
  });

  it('gives null for a lone surrogate', () => {
    expect(encodeQappSegment('a\ud800b')).toBeNull();
  });

  it('keeps the query and fragment untouched', () => {
    expect(encodeQappPath('/a b/c?x=1 2#y z')).toBe('/a%20b/c?x=1 2#y z');
    expect(encodeQappPath('#/route/../x')).toBe('#/route/../x');
  });
});

describe('buildQappRenderUrl', () => {
  const build = (name: unknown, rest?: string | null, query = '') =>
    buildQappRenderUrl({ baseUrl: NODE, service: 'APP', name, rest, query });

  it('builds the same URL as before for ordinary apps', () => {
    expect(
      build('Q-Tube', '/video/QTUBE_VIDEO_abc', '?theme=dark&lang=en')
    ).toBe(
      `${NODE}/render/APP/Q-Tube/video/QTUBE_VIDEO_abc?theme=dark&lang=en`
    );
    expect(build('Q-Wallets', '/qortal?authOnMount=true', '&theme=dark')).toBe(
      `${NODE}/render/APP/Q-Wallets/qortal?authOnMount=true&theme=dark`
    );
    expect(build('Quitter', '', '?theme=light')).toBe(
      `${NODE}/render/APP/Quitter?theme=light`
    );
    expect(build('Quitter', '/', '?theme=light')).toBe(
      `${NODE}/render/APP/Quitter/?theme=light`
    );
    expect(build('Q-Blog', '/#/post/x', '?t=1')).toBe(
      `${NODE}/render/APP/Q-Blog/#/post/x?t=1`
    );
  });

  it('encodes names with spaces and keeps already-encoded ones', () => {
    expect(build('Q Tube', '', '?a=1')).toBe(`${NODE}/render/APP/Q%20Tube?a=1`);
    expect(build('Q%20Tube', '', '?a=1')).toBe(
      `${NODE}/render/APP/Q%20Tube?a=1`
    );
  });

  it('adds the missing "/" between the name and a path', () => {
    expect(build('Q-Wallets', 'x', '')).toBe(`${NODE}/render/APP/Q-Wallets/x`);
    expect(build('Q-Wallets', '?x=1', '')).toBe(
      `${NODE}/render/APP/Q-Wallets?x=1`
    );
  });

  it.each(TRAVERSAL_PATHS)('refuses the path %j', (path) => {
    expect(build('Q-Wallets', `/${path}`, '?theme=dark')).toBeNull();
    expect(build('Q-Wallets', path, '?theme=dark')).toBeNull();
  });

  it.each([
    '..',
    '.',
    '%2e%2e',
    '%252e%252e',
    '%c0%ae%c0%ae',
    'Q-Wallets/../Evil',
    'a\\..',
    'a?b',
    'a#b',
  ])('refuses the name %j', (name) => {
    expect(build(name, '', '')).toBeNull();
  });

  it('refuses a GO suffix that would leave the app', () => {
    expect(build('Q-Wallets', '', '/../Evil')).toBeNull();
    expect(build('Q-Wallets', '', '/../../render/APP/Evil')).toBeNull();
  });

  it('refuses a service outside the pattern', () => {
    expect(
      buildQappRenderUrl({
        baseUrl: NODE,
        service: 'APP/../..',
        name: 'Evil',
        rest: '',
      })
    ).toBeNull();
  });

  it('keeps the result under the node even with a base path or trailing slash', () => {
    expect(
      buildQappRenderUrl({
        baseUrl: 'https://node.example/api',
        service: 'WEBSITE',
        name: 'Site',
        rest: '/a/b',
        query: '?x=1',
      })
    ).toBe('https://node.example/api/render/WEBSITE/Site/a/b?x=1');
    expect(
      buildQappRenderUrl({
        baseUrl: 'http://node.example/',
        service: 'APP',
        name: 'App',
        rest: '/../../x',
      })
    ).toBeNull();
  });

  it('cannot change the host through the name', () => {
    expect(build('@evil.example', '', '')).toBe(
      `${NODE}/render/APP/@evil.example`
    );
    const url = new URL(build('@evil.example', '', '') as string);
    expect(url.host).toBe('127.0.0.1:12391');
  });
});

describe('pickQappTabTarget (SET_TAB)', () => {
  it('keeps only service, name, identifier and path', () => {
    expect(
      pickQappTabTarget({
        service: 'APP',
        name: 'Q-Tube',
        identifier: 'abc',
        path: '/video/x',
        url: 'https://evil.example/',
        isPreview: true,
        isPrivate: true,
        internal: 'q-chat',
        navigateIfAlreadyOpen: true,
        tabId: 'forged',
      })
    ).toEqual({
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'abc',
      path: '/video/x',
    });
  });

  it('leaves out absent optional fields and stringifies a numeric identifier', () => {
    expect(pickQappTabTarget({ service: 'APP', name: 'Q-Tube' })).toEqual({
      service: 'APP',
      name: 'Q-Tube',
    });
    expect(
      pickQappTabTarget({ service: 'APP', name: 'X', identifier: 7 })
    ).toEqual({ service: 'APP', name: 'X', identifier: '7' });
  });

  it.each([
    { service: 'APP', name: 'Q-Wallets', path: '../../../render/APP/Evil' },
    { service: 'APP', name: 'Q-Wallets', path: '..\\..\\render\\APP\\Evil' },
    {
      service: 'APP',
      name: 'Q-Wallets',
      path: '%2e%2e/%2e%2e/render/APP/Evil',
    },
    { service: 'APP', name: '..', path: 'render/APP/Evil' },
    { service: 'APP', name: 'Q-Wallets/../Evil' },
    { service: '../APP', name: 'Evil' },
    { name: 'Q-Wallets' },
    { service: 'APP', path: 'x' },
    { service: 'APP', name: 'Q-Wallets', path: { evil: true } },
    { url: 'https://evil.example/', isPreview: true },
    null,
    'APP/Q-Wallets',
  ])('refuses %j', (payload) => {
    expect(pickQappTabTarget(payload)).toBeNull();
  });
});

describe('isQappTabTargetSafe (addTab)', () => {
  it('lets internal tabs and private previews through', () => {
    expect(isQappTabTargetSafe({ internal: 'q-chat', name: 'Q-Chat' })).toBe(
      true
    );
    expect(
      isQappTabTargetSafe({
        isPreview: true,
        url: 'http://127.0.0.1:12391/arbitrary/x',
        service: 'APP',
        name: 'Private',
      })
    ).toBe(true);
    expect(isQappTabTargetSafe({ isPreview: true, url: 'blob:x' })).toBe(true);
  });

  it('accepts ordinary tabs', () => {
    expect(isQappTabTargetSafe({ service: 'APP', name: 'Q-Tube' })).toBe(true);
    expect(
      isQappTabTargetSafe({
        service: 'APP',
        name: 'Quitter',
        path: `post/${encodeURIComponent('A B')}/${encodeURIComponent('id 1')}`,
      })
    ).toBe(true);
  });

  it.each([
    { service: 'APP', name: 'Q-Wallets', path: '../../../render/APP/Evil' },
    { service: 'APP', name: '..', path: '' },
    { service: 'APP' },
    { name: 'Q-Wallets' },
    { isPreview: true, name: '..' },
    { isPreview: true, name: 'X', path: '../../y' },
    null,
  ])('refuses %j', (data) => {
    expect(isQappTabTargetSafe(data)).toBe(false);
  });
});
