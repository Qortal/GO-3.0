import { afterEach, describe, expect, it, vi } from 'vitest';
import { openHttpUrlExternally } from './openExternalHttp';

afterEach(() => vi.restoreAllMocks());

describe('openHttpUrlExternally', () => {
  it('hands outside http(s) links to the browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openHttpUrlExternally('https://qortal.dev/team')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://qortal.dev/team',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it.each([
    `${window.location.origin}/`,
    `${window.location.origin}/_capacitor_file_/data/user/0/x/files/a.html`,
    'http://localhost/_capacitor_http_interceptor_?u=https://evil.example/x',
    'HTTP://LOCALHOST/',
    'http://127.0.0.1:12391/admin/status',
    'http://127.8.9.1/',
    'http://[::1]:8080/',
    'http://app.localhost/',
    'javascript:alert(1)',
    'file:///data/user/0/x/files/key',
  ])('refuses %s', (url) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openHttpUrlExternally(url)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
