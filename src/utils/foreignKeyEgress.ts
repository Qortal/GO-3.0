import i18n from 'i18next';
import { API_ENDPOINTS, EXT_NODE_QORTAL_LINK } from '../constants/constants';
import { isCapacitor } from './platform';

/**
 * Foreign-chain private keys (BTC/LTC/DOGE/DGB/RVN xprv, ARRR seed) are sent to
 * the connected Core node, which signs on our behalf. Whoever runs that node, and
 * anyone who can read the connection, gets the key; Core also keeps trade-bot
 * keys on disk. Only let a key leave the device over an encrypted connection to
 * a node that is not a shared public node, and only after the user has ticked a
 * warning naming that node.
 *
 * No address is trusted by location alone. On a phone, 127.0.0.1 is whatever
 * app is listening on that port (an SSH tunnel, Termux, or any other installed
 * app), and 100.64.0.0/10 is also the carriers' shared NAT range, routed over
 * the normal network whenever Tailscale is off. Those nodes are allowed, but
 * always with the warning, worded for the case. On the desktop app, 127.0.0.1
 * is the Core node the user runs next to it, so that case keeps no warning.
 */

/**
 * How the key would travel: `loopback` to a port on this device, `tailscale`
 * as plain HTTP that is only private while Tailscale carries it, `https` to a
 * remote node over TLS.
 */
export type ForeignKeyEgressRoute = 'loopback' | 'tailscale' | 'https';

export type ForeignKeyEgress =
  | {
      allowed: true;
      host: string;
      local: boolean;
      route: ForeignKeyEgressRoute;
    }
  | {
      allowed: false;
      host: string;
      reason: 'public-node' | 'cleartext' | 'invalid-url';
    };

const PUBLIC_NODE_SUFFIXES = ['qortal.org', 'qortal.link', 'qortalnodes.live'];

const hostOf = (url: string): string => {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
};

const normalizeHost = (host: string): string =>
  host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

const PUBLIC_NODE_HOSTS = new Set(
  [EXT_NODE_QORTAL_LINK, ...API_ENDPOINTS.map(hostOf)].filter(Boolean)
);

const parseIpv4 = (host: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
};

export function isPublicQortalNodeHost(host: string): boolean {
  const h = normalizeHost(host);
  if (PUBLIC_NODE_HOSTS.has(h)) return true;
  return PUBLIC_NODE_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  return parseIpv4(host)?.[0] === 127;
}

/**
 * Tailscale carries traffic inside WireGuard, so plain HTTP over it is not
 * readable on the network while Tailscale is connected. Nothing here can see
 * whether it is, which is why the consent text says so.
 */
function isTailscaleHost(host: string): boolean {
  if (host.endsWith('.ts.net')) return true;
  if (host.startsWith('fd7a:115c:a1e0:')) return true;
  const ip = parseIpv4(host);
  return !!ip && ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127;
}

export function checkForeignKeyEgress(url: string): ForeignKeyEgress {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, host: '', reason: 'invalid-url' };
  }
  const host = normalizeHost(parsed.hostname);
  if (!host) return { allowed: false, host, reason: 'invalid-url' };
  if (isPublicQortalNodeHost(host)) {
    return { allowed: false, host, reason: 'public-node' };
  }
  if (isLoopbackHost(host)) {
    return { allowed: true, host, local: true, route: 'loopback' };
  }
  if (parsed.protocol === 'https:') {
    return { allowed: true, host, local: false, route: 'https' };
  }
  if (parsed.protocol === 'http:' && isTailscaleHost(host)) {
    return { allowed: true, host, local: false, route: 'tailscale' };
  }
  return { allowed: false, host, reason: 'cleartext' };
}

/** Throws a user-facing error unless the foreign key may be sent to `url`. */
export function assertForeignKeyEgress(
  url: string,
  coin: string
): Extract<ForeignKeyEgress, { allowed: true }> {
  const egress = checkForeignKeyEgress(url);
  if (egress.allowed === true) return egress;
  const key =
    egress.reason === 'public-node'
      ? 'question:message.error.foreign_key_public_node'
      : egress.reason === 'cleartext'
        ? 'question:message.error.foreign_key_cleartext'
        : 'question:message.error.foreign_key_invalid_node';
  throw new Error(
    i18n.t(key, { coin, host: egress.host, postProcess: 'capitalizeFirstChar' })
  );
}

const CONSENT_WARNING_KEYS: Record<ForeignKeyEgressRoute, string> = {
  loopback: 'question:permission.foreign_key_local_warning',
  tailscale: 'question:permission.foreign_key_tailscale_warning',
  https: 'question:permission.foreign_key_node_warning',
};

/**
 * Approval-dialog fields (warning text and a tick box the user must tick) for a
 * private key leaving the app. Every allowed route gets them on the phone,
 * including a node on this device; on desktop the local Core node does not.
 */
export function foreignKeyConsentFields(
  egress: Extract<ForeignKeyEgress, { allowed: true }>,
  coin: string
) {
  const route: ForeignKeyEgressRoute =
    egress.route ?? (egress.local ? 'loopback' : 'https');
  if (route === 'loopback' && !isCapacitor()) return {};
  return {
    text4: i18n.t(CONSENT_WARNING_KEYS[route], {
      coin,
      host: egress.host,
      postProcess: 'capitalizeFirstChar',
    }),
    confirmCheckbox: true,
    confirmCheckboxLabel: i18n.t(
      'question:permission.foreign_key_node_confirm',
      {
        coin,
        postProcess: 'capitalizeFirstChar',
      }
    ),
  };
}

/** Extra approval-dialog fields for a gateway buy, where the trade proxy receives the key. */
export function foreignKeyProxyConsentFields(coin: string) {
  return {
    text4: i18n.t('question:permission.foreign_key_proxy_warning', {
      coin,
      postProcess: 'capitalizeFirstChar',
    }),
    confirmCheckbox: true,
    confirmCheckboxLabel: i18n.t(
      'question:permission.foreign_key_proxy_confirm',
      { coin, postProcess: 'capitalizeFirstChar' }
    ),
  };
}
