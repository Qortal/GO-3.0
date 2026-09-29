import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => key) },
}));

import {
  assertForeignKeyEgress,
  checkForeignKeyEgress,
  foreignKeyConsentFields,
  foreignKeyProxyConsentFields,
  isPublicQortalNodeHost,
} from './foreignKeyEgress';

describe('checkForeignKeyEgress', () => {
  it.each([
    'http://127.0.0.1:12391/crosschain/ltc/send',
    'https://127.0.0.1:12391/crosschain/ltc/send',
    'http://localhost:12391/crosschain/ltc/send',
    'http://[::1]:12391/crosschain/ltc/send',
  ])('allows a node on this device without consent: %s', (url) => {
    expect(checkForeignKeyEgress(url)).toMatchObject({
      allowed: true,
      local: true,
    });
  });

  it.each([
    'http://100.69.252.77:12391/crosschain/ltc/send',
    'http://100.64.0.1:12391/crosschain/ltc/send',
    'http://100.127.255.254:12391/crosschain/ltc/send',
    'http://node.tail1234.ts.net:12391/crosschain/ltc/send',
    'http://[fd7a:115c:a1e0::1]:12391/crosschain/ltc/send',
  ])('allows plain HTTP over Tailscale as a remote node: %s', (url) => {
    expect(checkForeignKeyEgress(url)).toMatchObject({
      allowed: true,
      local: false,
    });
  });

  it('allows a remote HTTPS node as a remote node', () => {
    expect(
      checkForeignKeyEgress('https://mynode.example.com/crosschain/ltc/send')
    ).toEqual({ allowed: true, host: 'mynode.example.com', local: false });
  });

  it.each([
    'http://192.168.1.10:12391/crosschain/ltc/send',
    'http://10.0.0.5:12391/crosschain/ltc/send',
    'http://172.20.0.2:12391/crosschain/ltc/send',
    'http://100.63.255.255:12391/crosschain/ltc/send',
    'http://100.128.0.1:12391/crosschain/ltc/send',
    'http://mynode.example.com/crosschain/ltc/send',
    'http://qortector:12391/crosschain/ltc/send',
  ])('blocks unencrypted connections: %s', (url) => {
    expect(checkForeignKeyEgress(url)).toMatchObject({
      allowed: false,
      reason: 'cleartext',
    });
  });

  it.each([
    'https://ext-node.qortal.link/crosschain/ltc/send',
    'https://api.qortal.org/crosschain/ltc/send',
    'https://api2.qortal.org/crosschain/ltc/send',
    'https://appnode.qortal.org/crosschain/tradebot/respondmultiple',
    'https://apinode.qortalnodes.live/crosschain/ltc/send',
    'https://apinode3.qortalnodes.live/crosschain/ltc/send',
    'https://some-new-node.qortal.org/crosschain/ltc/send',
    'https://API.QORTAL.ORG./crosschain/ltc/send',
  ])('blocks public Qortal nodes even over HTTPS: %s', (url) => {
    expect(checkForeignKeyEgress(url)).toMatchObject({
      allowed: false,
      reason: 'public-node',
    });
  });

  it('does not treat look-alike hosts as public nodes', () => {
    expect(isPublicQortalNodeHost('notqortal.org')).toBe(false);
    expect(isPublicQortalNodeHost('qortal.org.example.com')).toBe(false);
  });

  it.each(['', 'not a url', '/crosschain/ltc/send', 'undefined/crosschain'])(
    'blocks addresses it cannot parse: %s',
    (url) => {
      expect(checkForeignKeyEgress(url)).toMatchObject({
        allowed: false,
        reason: 'invalid-url',
      });
    }
  );
});

describe('assertForeignKeyEgress', () => {
  it('returns the verdict when the node is allowed', () => {
    expect(
      assertForeignKeyEgress(
        'http://127.0.0.1:12391/crosschain/ltc/send',
        'LTC'
      )
    ).toEqual({ allowed: true, host: '127.0.0.1', local: true });
  });

  it('throws the cleartext error for a LAN node over HTTP', () => {
    expect(() =>
      assertForeignKeyEgress('http://192.168.1.10:12391/x', 'LTC')
    ).toThrow('question:message.error.foreign_key_cleartext');
  });

  it('throws the public-node error for a public node', () => {
    expect(() =>
      assertForeignKeyEgress('https://api.qortal.org/x', 'LTC')
    ).toThrow('question:message.error.foreign_key_public_node');
  });

  it('throws the invalid-node error for an unparseable address', () => {
    expect(() => assertForeignKeyEgress('nope', 'LTC')).toThrow(
      'question:message.error.foreign_key_invalid_node'
    );
  });
});

describe('consent fields', () => {
  it('adds nothing for a node on this device', () => {
    expect(
      foreignKeyConsentFields(
        { allowed: true, host: '127.0.0.1', local: true },
        'LTC'
      )
    ).toEqual({});
  });

  it('requires a tick-box confirmation for a remote node', () => {
    expect(
      foreignKeyConsentFields(
        { allowed: true, host: '100.69.252.77', local: false },
        'LTC'
      )
    ).toEqual({
      text4: 'question:permission.foreign_key_node_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_node_confirm',
    });
  });

  it('requires a tick-box confirmation for the gateway trade proxy', () => {
    expect(foreignKeyProxyConsentFields('LTC')).toEqual({
      text4: 'question:permission.foreign_key_proxy_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_proxy_confirm',
    });
  });
});
