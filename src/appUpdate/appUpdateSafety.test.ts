import { describe, expect, it } from 'vitest';
import {
  appUpdateErrorCode,
  describeAppUpdateError,
  insecureNodeError,
  isSecureUpdateUrl,
} from './appUpdateSafety';

const tr = (key: string) => `t(${key})`;

describe('isSecureUpdateUrl', () => {
  it('allows HTTPS anywhere', () => {
    expect(isSecureUpdateUrl('https://ext-node.qortal.link/arbitrary/x')).toBe(
      true
    );
    expect(isSecureUpdateUrl('https://192.168.1.20:12391/x')).toBe(true);
  });

  it('allows plain HTTP only to this phone', () => {
    expect(isSecureUpdateUrl('http://127.0.0.1:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://localhost:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://[::1]:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://192.168.1.20:12391/x')).toBe(false);
    expect(isSecureUpdateUrl('http://100.64.0.5:12391/x')).toBe(false);
    expect(isSecureUpdateUrl('http://127.0.0.1.evil.example/x')).toBe(false);
    expect(isSecureUpdateUrl('http://localhost@evil.example/x')).toBe(false);
  });

  it('accepts HTTPS hosts java.net.URI cannot read, as the native side does', () => {
    expect(isSecureUpdateUrl('https://my_node.local/x')).toBe(true);
    expect(isSecureUpdateUrl('https://my_node.local:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('https://user@my_node.local/x')).toBe(true);
    expect(isSecureUpdateUrl('https://пример.рф/x')).toBe(true);
  });

  it('judges plain HTTP on the host as written, not as URL normalises it', () => {
    // new URL() reads all of these as 127.0.0.1; AppUpdatePolicy does not.
    expect(isSecureUpdateUrl('http://127.1/x')).toBe(false);
    expect(isSecureUpdateUrl('http://0x7f.0.0.1/x')).toBe(false);
    expect(isSecureUpdateUrl('http://2130706433/x')).toBe(false);
    expect(isSecureUpdateUrl('http://127.0.0.01/x')).toBe(false);
    expect(isSecureUpdateUrl('http://127.0.0.1./x')).toBe(false);
    expect(isSecureUpdateUrl('http://localhost./x')).toBe(false);
    expect(isSecureUpdateUrl('http://my_node.local/x')).toBe(false);
    expect(isSecureUpdateUrl('http://LOCALHOST:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://user@127.0.0.1:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://[0:0:0:0:0:0:0:1]:12391/x')).toBe(true);
    expect(isSecureUpdateUrl('http://127.0.0.0/x')).toBe(true);
  });

  it('refuses anything that is not a web address', () => {
    expect(isSecureUpdateUrl('file:///sdcard/go.apk')).toBe(false);
    expect(isSecureUpdateUrl('not a url')).toBe(false);
    expect(isSecureUpdateUrl('')).toBe(false);
    expect(isSecureUpdateUrl('http:///x')).toBe(false);
    expect(isSecureUpdateUrl('https:x')).toBe(false);
  });
});

describe('describeAppUpdateError', () => {
  it('translates the plugin refusal codes', () => {
    const refusal = (code: string) =>
      Object.assign(new Error('english'), { code });
    expect(describeAppUpdateError(refusal('UPDATE_WRONG_SIGNER'), tr)).toBe(
      't(error.wrong_signer)'
    );
    expect(describeAppUpdateError(refusal('UPDATE_WRONG_PACKAGE'), tr)).toBe(
      't(error.not_go_build)'
    );
    expect(describeAppUpdateError(refusal('UPDATE_NOT_NEWER'), tr)).toBe(
      't(error.not_newer)'
    );
    expect(describeAppUpdateError(refusal('UPDATE_UNREADABLE'), tr)).toBe(
      't(error.unreadable)'
    );
    expect(describeAppUpdateError(insecureNodeError(), tr)).toBe(
      't(error.insecure_node)'
    );
    expect(describeAppUpdateError(refusal('UPDATE_BAD_URL'), tr)).toBe(
      't(error.fetch_failed)'
    );
  });

  it('keeps other messages, minus any URL query', () => {
    expect(
      describeAppUpdateError(
        new Error('Download failed: http://127.0.0.1:12391/x?apiKey=K'),
        tr
      )
    ).toBe('Download failed: http://127.0.0.1:12391/x');
    expect(
      describeAppUpdateError({ code: 'OTHER', message: 'Download failed' }, tr)
    ).toBe('Download failed');
  });

  it('falls back to the generic message', () => {
    expect(describeAppUpdateError(undefined, tr)).toBe('t(error.fetch_failed)');
    expect(describeAppUpdateError(new Error(''), tr)).toBe(
      't(error.fetch_failed)'
    );
  });

  it('only recognises its own codes', () => {
    expect(appUpdateErrorCode({ code: 'UPDATE_NOT_NEWER' })).toBe(
      'UPDATE_NOT_NEWER'
    );
    expect(appUpdateErrorCode({ code: 'constructor' })).toBeNull();
    expect(appUpdateErrorCode({ code: 'UPDATE_BAD_PATH' })).toBe(
      'UPDATE_BAD_PATH'
    );
    expect(appUpdateErrorCode({ code: 'SOMETHING_ELSE' })).toBeNull();
    expect(appUpdateErrorCode(null)).toBeNull();
  });
});
