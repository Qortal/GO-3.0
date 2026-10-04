import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => key) },
}));

const platform = vi.hoisted(() => ({ native: true }));
vi.mock('./platform', () => ({ isCapacitor: () => platform.native }));

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
  ])('allows a node on this device, marked as loopback: %s', (url) => {
    expect(checkForeignKeyEgress(url)).toMatchObject({
      allowed: true,
      local: true,
      route: 'loopback',
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
      route: 'tailscale',
    });
  });

  it('treats a Tailscale HTTPS name as an ordinary HTTPS node', () => {
    expect(
      checkForeignKeyEgress('https://node.tail1234.ts.net/crosschain/ltc/send')
    ).toMatchObject({ allowed: true, local: false, route: 'https' });
  });

  it('allows a remote HTTPS node as a remote node', () => {
    expect(
      checkForeignKeyEgress('https://mynode.example.com/crosschain/ltc/send')
    ).toEqual({
      allowed: true,
      host: 'mynode.example.com',
      local: false,
      route: 'https',
    });
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
    ).toEqual({
      allowed: true,
      host: '127.0.0.1',
      local: true,
      route: 'loopback',
    });
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
  afterEach(() => {
    platform.native = true;
  });

  it('requires a tick-box confirmation for a node on this device', () => {
    // Any app on the phone can listen on a loopback port.
    expect(
      foreignKeyConsentFields(
        checkForeignKeyEgress('http://127.0.0.1:12391/x') as Extract<
          ReturnType<typeof checkForeignKeyEgress>,
          { allowed: true }
        >,
        'LTC'
      )
    ).toEqual({
      text4: 'question:permission.foreign_key_local_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_node_confirm',
    });
  });

  it('warns that plain HTTP over Tailscale is only private while connected', () => {
    expect(
      foreignKeyConsentFields(
        checkForeignKeyEgress('http://100.69.252.77:12391/x') as Extract<
          ReturnType<typeof checkForeignKeyEgress>,
          { allowed: true }
        >,
        'LTC'
      )
    ).toEqual({
      text4: 'question:permission.foreign_key_tailscale_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_node_confirm',
    });
  });

  it('requires a tick-box confirmation for a remote HTTPS node', () => {
    expect(
      foreignKeyConsentFields(
        {
          allowed: true,
          host: 'mynode.example.com',
          local: false,
          route: 'https',
        },
        'LTC'
      )
    ).toEqual({
      text4: 'question:permission.foreign_key_node_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_node_confirm',
    });
  });

  it('keeps no warning for the local Core node on desktop', () => {
    platform.native = false;
    const egress = checkForeignKeyEgress('http://127.0.0.1:12391/x');
    expect(egress.allowed).toBe(true);
    if (egress.allowed !== true) return;
    expect(foreignKeyConsentFields(egress, 'LTC')).toEqual({});
    // Remote nodes still warn on desktop.
    const remote = checkForeignKeyEgress('https://mynode.example.com/x');
    if (remote.allowed !== true) throw new Error('expected allowed');
    expect(foreignKeyConsentFields(remote, 'LTC')).toMatchObject({
      confirmCheckbox: true,
    });
  });

  it('never returns an empty consent on the phone for any allowed node', () => {
    for (const url of [
      'http://localhost:12391/x',
      'http://[::1]:12391/x',
      'https://127.0.0.1:12391/x',
      'http://node.tail1234.ts.net:12391/x',
      'https://mynode.example.com/x',
    ]) {
      const egress = checkForeignKeyEgress(url);
      expect(egress.allowed).toBe(true);
      if (egress.allowed !== true) continue;
      expect(foreignKeyConsentFields(egress, 'ARRR')).toMatchObject({
        confirmCheckbox: true,
      });
    }
  });

  it('requires a tick-box confirmation for the gateway trade proxy', () => {
    expect(foreignKeyProxyConsentFields('LTC')).toEqual({
      text4: 'question:permission.foreign_key_proxy_warning',
      confirmCheckbox: true,
      confirmCheckboxLabel: 'question:permission.foreign_key_proxy_confirm',
    });
  });
});
