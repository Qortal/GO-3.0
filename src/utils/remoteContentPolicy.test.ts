import { afterEach, describe, expect, it } from 'vitest';
import {
  cssCanFetch,
  isAllowedMediaUrl,
  isAllowedSrcset,
  isAllowedSvgReference,
  setCurrentNodeBaseResolver,
} from './remoteContentPolicy';

afterEach(() => setCurrentNodeBaseResolver(() => null));

describe('isAllowedMediaUrl', () => {
  it.each([
    '',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:http://localhost/7a1c',
    '/arbitrary/IMAGE/alice/avatar',
    `${window.location.origin}/assets/logo.png`,
    'http://127.0.0.1:12391/arbitrary/IMAGE/alice/pic',
    'https://localhost:12391/arbitrary/IMAGE/alice/pic',
    'https://ext-node.qortal.link/arbitrary/IMAGE/alice/pic',
    'https://api.qortal.org/arbitrary/IMAGE/alice/pic',
    'https://apinode3.qortalnodes.live/arbitrary/IMAGE/alice/pic',
  ])('allows %s', (url) => {
    expect(isAllowedMediaUrl(url)).toBe(true);
  });

  it.each([
    'https://tracker.example/pixel.gif?reader=alice',
    'HTTPS://TRACKER.EXAMPLE/pixel.gif',
    '//tracker.example/pixel.gif',
    'http://192.168.1.1/cgi-bin/reboot',
    'http://127.0.0.1:8080/local-service',
    'https://ext-node.qortal.link.tracker.example/x.png',
    'ftp://tracker.example/x.png',
    'https://fonts.gstatic.com/s/i/x.svg',
    // Capacitor's proxy and file paths, which it serves on any host.
    '/_capacitor_http_interceptor_?u=https%3A%2F%2Ftracker.example%2Fp.png',
    `${window.location.origin}/_capacitor_http_interceptor_?u=HTTPS://t.example/p`,
    'http://127.0.0.1:12391/_capacitor_http_interceptor_?u=https://t.example/p',
    '/%5Fcapacitor_http_interceptor_?u=https://t.example/p',
    '/assets/%2e%2e/_capacitor_file_/data/user/0/x/files/key',
    '/_CAPACITOR_FILE_/data/user/0/x/files/key',
  ])('refuses %s', (url) => {
    expect(isAllowedMediaUrl(url)).toBe(false);
  });

  it('allows the node GO is using now, and only while it is in use', () => {
    const url = 'https://my-node.example:12391/arbitrary/IMAGE/alice/pic';
    expect(isAllowedMediaUrl(url)).toBe(false);

    setCurrentNodeBaseResolver(() => 'https://my-node.example:12391');
    expect(isAllowedMediaUrl(url)).toBe(true);
    expect(
      isAllowedMediaUrl('https://my-node.example:9999/arbitrary/IMAGE/a/b')
    ).toBe(false);
  });
});

describe('isAllowedSrcset', () => {
  it('needs every candidate to be allowed', () => {
    expect(
      isAllowedSrcset(
        'http://127.0.0.1:12391/a.png 1x, data:image/png;base64,AAAA 2x'
      )
    ).toBe(true);
    expect(
      isAllowedSrcset(
        'http://127.0.0.1:12391/a.png 480w, https://tracker.example/b.png 800w'
      )
    ).toBe(false);
  });
});

describe('isAllowedSvgReference', () => {
  it('allows in-page fragments and refuses outside documents', () => {
    expect(isAllowedSvgReference('#icon')).toBe(true);
    expect(isAllowedSvgReference('https://tracker.example/s.svg#icon')).toBe(
      false
    );
  });
});

describe('cssCanFetch', () => {
  it.each([
    'background: url(https://tracker.example/x.png)',
    'background-image:URL("x.png")',
    'background: u\\72 l(https://tracker.example/x.png)',
    'background: \\75\\72\\6c(https://tracker.example/x.png)',
    'background: -webkit-image-set("https://tracker.example/x.png" 1x)',
    'content: image("x.png")',
    '@import "https://tracker.example/x.css";',
  ])('catches %s', (css) => {
    expect(cssCanFetch(css)).toBe(true);
  });

  it.each([
    'color: rgb(10, 20, 30); font-size: 14px',
    'text-align: center',
    '',
  ])('leaves %s alone', (css) => {
    expect(cssCanFetch(css)).toBe(false);
  });
});
