import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferHttpForLocalPrivateUrl } from './helpers';

describe('preferHttpForLocalPrivateUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rewrites local/private HTTPS to HTTP outside Electron', () => {
    vi.stubGlobal('window', {});
    expect(preferHttpForLocalPrivateUrl('https://localhost:2222')).toBe(
      'http://localhost:2222'
    );
    expect(preferHttpForLocalPrivateUrl('https://127.0.0.1:12391')).toBe(
      'http://127.0.0.1:12391'
    );
    expect(preferHttpForLocalPrivateUrl('https://192.168.1.10:12391')).toBe(
      'http://192.168.1.10:12391'
    );
  });

  it('keeps public HTTPS and already-HTTP local URLs', () => {
    vi.stubGlobal('window', {});
    expect(preferHttpForLocalPrivateUrl('https://ext-node.qortal.link')).toBe(
      'https://ext-node.qortal.link'
    );
    expect(preferHttpForLocalPrivateUrl('http://localhost:2222')).toBe(
      'http://localhost:2222'
    );
  });

  it('keeps local HTTPS in Electron when cert pinning is available', () => {
    vi.stubGlobal('window', {
      electronAPI: {
        ensureCertForBase: vi.fn(),
      },
    });
    expect(preferHttpForLocalPrivateUrl('https://localhost:12391')).toBe(
      'https://localhost:12391'
    );
  });
});
