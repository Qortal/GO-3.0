/**
 * Per-report pseudonyms for the "Copy diagnostics" / "Save as .md" report.
 *
 * The report is pasted into public support chats, so it must not say who the
 * user talks to, which groups they read or where their own node lives. Every
 * Qortal address, group / peer / conversation / file / event id and private
 * node host is replaced by a short keyed hash. The key is random per report
 * and never printed, so a pseudonym cannot be checked against a known address
 * or matched across two reports; within one report the same value always gets
 * the same pseudonym, so "the same peer failed three times" still reads.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { API_ENDPOINTS, EXT_NODE_QORTAL_LINK } from '../../constants/constants';

type DiagnosticPseudonymizer = {
  /**
   * A node host (`host`, `host:port` or `[v6]:port`) as the report shows it:
   * loopback and public Qortal nodes as they are, any other host as
   * `<node-…>` or `<lan-node-…>` with its port kept. Registered hosts are
   * also replaced wherever `line` meets them.
   */
  host: (host: string | null | undefined) => string;
  /** The line with every identifier it recognises replaced. */
  line: (text: string) => string;
};

const TOKEN_HEX = 6;

/** Public Qortal nodes and loopback say nothing about the user: kept as is. */
const PUBLIC_HOSTNAMES = new Set(
  [EXT_NODE_QORTAL_LINK, ...API_ENDPOINTS]
    .map((value) => {
      try {
        return new URL(
          value.includes('://') ? value : `https://${value}`
        ).hostname.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
);

const QORTAL_ADDRESS_RE = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

/** `key=value` pairs whose value names a person, group, peer or object. */
const ID_PAIR_RE =
  /\b(group(?:_?id)?|peer(?:_?address)?|active_?peer|provider|next_?hop|responder|author|address|requester|sender|recipient|member|owner|root|transfer|old_?transfer|file|rid|request(?:_?id)?|conversation(?:_?id)?|event(?:_?id)?|cursor|message(?:_?id)?|channel(?:_?id)?|session(?:_?id)?|target(?:_?session)?|source_?session|call(?:_?id)?|key(?:_?id)?|link(?:_?id)?|dest(?:ination)?(?:_?hash)?|hash|blob|thread|identity|id)=([^\s,;&)\]]+)/gi;

/**
 * `host=<host[:port]>` in engine lines (`membership_fetch_failed … host=…`):
 * the value goes through the same host rule as the report's own node lines,
 * so public nodes and loopback stay readable and a private node does not.
 */
const HOST_PAIR_RE = /\bhost=([^\s,;&)\]]+)/gi;

/**
 * `bridge_traffic` keys such as `reticulum_chat_resource:receiving:event=145`
 * hold a count after `:event=`, not an event id (event ids are base58, never
 * a plain number).
 */
const isEventCountPair = (
  key: string,
  value: string,
  offset: number,
  whole: string
): boolean =>
  key.toLowerCase() === 'event' &&
  whole[offset - 1] === ':' &&
  /^\d+$/.test(value);

/** Values that are not identifiers, whatever key they follow. */
const PLAIN_VALUES = new Set([
  '',
  '-',
  '0',
  'none',
  'null',
  'undefined',
  'unknown',
  'missing',
  'true',
  'false',
  'general',
]);

/** Secrets never belong in a report, not even as a pseudonym. */
const SECRET_PAIR_RE =
  /\b(token|secret|password|passphrase|seed|private_?key)=([^\s,;&)\]]+)/gi;

/**
 * The same pairs in JSON, as the worker logger prints any object argument
 * (`{"groupId":694,"name":"Alice"}`). Only quoted strings and numbers.
 */
const JSON_ID_PAIR_RE =
  /"(group(?:_?id)?|peer(?:_?(?:address|hash))?|provider|responder|author|address|requester|sender(?:_?name)?|recipient|receiver|member|owner|name|display_?name|transfer(?:_?id)?|file(?:_?(?:id|name))?|filename|identifier|rid|request(?:_?id)?|conversation(?:_?id)?|event(?:_?id)?|message_?id|signature|reference|chat_?reference|channel(?:_?id)?|session(?:_?id)?|target|call(?:_?id)?|link(?:_?id)?|dest(?:ination)?(?:_?hash)?|hash|thread|identity)"(\s*:\s*)(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)(?![\w.]))/gi;

/** Keys whose value may be a group queue id: `694`, `694:general`, `group-694`. */
const GROUP_VALUE_KEY_RE = /^(group(?:_?id)?|target)$/i;
const GROUP_VALUE_RE = /^(?:group-)?(\d+)(?::([^:\s]+))?$/i;

/** `group 1144` (membership probe) and `groups 694,581` (collapsed repeats). */
const GROUP_WORD_RE = /\b(groups?) (\d+(?:,\d+)*)\b/gi;

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ADDRESS_RE = /\bQ[1-9A-HJ-NP-Za-km-z]{33}\b/g;
/** Event ids and signatures (base58), longer than any word. */
const BASE58_RE = /\b[1-9A-HJ-NP-Za-km-z]{40,}\b/g;
/** Peer, destination, file and request hashes; one letter so counters stay. */
const HEX_ID_RE = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi;
/**
 * Dotted quads, also after `/` as Java prints them (`host/203.0.113.9:4242`).
 * The `User agent:` line is skipped: its version strings look the same.
 */
const IPV4_RE = /(?<![\w.:-])(\d{1,3}(?:\.\d{1,3}){3})(?![\w-]|\.\d)/g;
/**
 * IPv6 candidates: hex groups joined by colons, with an optional `%scope`.
 * `isIpv6` then keeps only real addresses (with `::`, or all eight groups),
 * so clock times such as `03:49:01` stay.
 */
const IPV6_RE =
  /(?<![\w:.%])(?:[0-9a-f]{0,4}:){2,7}(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{0,4})(?:%[\w.-]+)?(?![\w:%])/gi;
const USER_AGENT_LINE_RE = /^\s*User agent:/i;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isIpv4 = (text: string) =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text) &&
  text.split('.').every((part) => Number(part) <= 255);

function isIpv6(text: string): boolean {
  const address = text.replace(/%.*$/, '');
  if (!address.includes(':') || /:::/.test(address)) return false;
  const compressed = address.split('::');
  if (compressed.length > 2) return false;
  const groups = address.split(':').filter(Boolean);
  // An IPv4-mapped tail (`::ffff:192.168.1.20`) counts as two groups.
  const last = groups[groups.length - 1] ?? '';
  const mapped = isIpv4(last);
  const hexGroups = mapped ? groups.slice(0, -1) : groups;
  const count = hexGroups.length + (mapped ? 2 : 0);
  if (count === 0 || count > 8) return false;
  if (!hexGroups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) {
    return false;
  }
  return compressed.length === 2 || count === 8;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    (isIpv4(host) && host.startsWith('127.'))
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIpv4(host)) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':')) {
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(host);
  }
  return (
    /\.(local|lan|home|internal|home\.arpa)$/.test(host) || !host.includes('.')
  );
}

/** `host:port`, `[v6]:port` or a URL split into hostname and `:port`. */
export function splitDiagnosticHost(raw: string): {
  hostname: string;
  port: string;
} {
  const value = String(raw ?? '').trim();
  if (!value) return { hostname: '', port: '' };
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      return { hostname: url.hostname, port: url.port ? `:${url.port}` : '' };
    } catch {
      return { hostname: '', port: '' };
    }
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) {
      return { hostname: value.slice(0, end + 1), port: value.slice(end + 1) };
    }
    return { hostname: value, port: '' };
  }
  const colon = value.lastIndexOf(':');
  if (
    colon > 0 &&
    value.indexOf(':') === colon &&
    /^\d+$/.test(value.slice(colon + 1))
  ) {
    return { hostname: value.slice(0, colon), port: value.slice(colon) };
  }
  return { hostname: value, port: '' };
}

export function createDiagnosticPseudonymizer(
  salt: Uint8Array = randomBytes(16)
): DiagnosticPseudonymizer {
  const tokenByValue = new Map<string, string>();
  const valueByToken = new Map<string, string>();
  const hosts = new Map<string, string>();

  const token = (prefix: string, value: string): string => {
    const memoKey = `${prefix}\u0000${value}`;
    const known = tokenByValue.get(memoKey);
    if (known) return known;
    const digest = bytesToHex(hmac(sha256, salt, utf8ToBytes(value)));
    // Lengthen on the (rare) clash so two values never share a pseudonym.
    let length = TOKEN_HEX;
    let candidate = `<${prefix}-${digest.slice(0, length)}>`;
    while (
      valueByToken.has(candidate) &&
      valueByToken.get(candidate) !== memoKey &&
      length < 10
    ) {
      length += 2;
      candidate = `<${prefix}-${digest.slice(0, length)}>`;
    }
    tokenByValue.set(memoKey, candidate);
    valueByToken.set(candidate, memoKey);
    return candidate;
  };

  const idToken = (value: string): string =>
    QORTAL_ADDRESS_RE.test(value) ? token('addr', value) : token('id', value);

  const plainValue = (value: string): boolean =>
    PLAIN_VALUES.has(value.toLowerCase()) ||
    value.startsWith('<') ||
    // `{"name":"AbortError"}`: an error class, not a person.
    /^[A-Z]\w*(?:Error|Exception)$/.test(value);

  /**
   * A group queue id (`694`, `694:general`, `group-694`) gets the group's own
   * pseudonym, so a send failure and the engine's `group=694` lines match.
   */
  const groupValue = (value: string): string | null => {
    const match = GROUP_VALUE_RE.exec(value);
    if (!match) return null;
    const channel = match[2];
    const channelPart = channel
      ? `:${plainValue(channel) ? channel : idToken(channel)}`
      : '';
    return `${token('id', match[1])}${channelPart}`;
  };

  const pairValue = (value: string, key = ''): string => {
    // `group=694:` keeps its trailing punctuation outside the pseudonym.
    const match = /^(.*?)([.:]*)$/.exec(value);
    const core = match?.[1] ?? value;
    const tail = match?.[2] ?? '';
    if (plainValue(core)) return value;
    if (GROUP_VALUE_KEY_RE.test(key)) {
      const group = groupValue(core);
      if (group) return `${group}${tail}`;
    }
    return `${idToken(core)}${tail}`;
  };

  const jsonPair = (
    key: string,
    separator: string,
    quoted: string | undefined,
    number: string | undefined
  ): string => {
    if (quoted !== undefined) {
      const value = quoted.trim();
      if (plainValue(value)) return `"${key}"${separator}"${quoted}"`;
      const pseudonym =
        (GROUP_VALUE_KEY_RE.test(key) && groupValue(value)) || idToken(value);
      return `"${key}"${separator}"${pseudonym}"`;
    }
    const value = number ?? '';
    if (plainValue(value)) return `"${key}"${separator}${value}`;
    return `"${key}"${separator}"${token('id', value)}"`;
  };

  const ipToken = (ip: string): string => {
    if (!isIpv4(ip) || isLoopbackHost(ip)) return ip;
    return isPrivateHost(ip) ? token('lan-ip', ip) : token('ip', ip);
  };

  const ipv6Token = (candidate: string): string => {
    if (!isIpv6(candidate)) return candidate;
    const address = candidate.replace(/%.*$/, '').toLowerCase();
    // `::ffff:192.168.1.20` is that IPv4 address: loopback / LAN by its tail.
    const mappedV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
    const kind = mappedV4 ?? address;
    if (isLoopbackHost(kind) || address === '::') return candidate;
    return isPrivateHost(kind)
      ? token('lan-ip', address)
      : token('ip', address);
  };

  const hostToken = (hostname: string): string | null => {
    const key = hostname.toLowerCase();
    if (!key || isLoopbackHost(key) || PUBLIC_HOSTNAMES.has(key)) return null;
    const known = hosts.get(key);
    if (known) return known;
    const pseudonym = isPrivateHost(key)
      ? token('lan-node', key)
      : token('node', key);
    hosts.set(key, pseudonym);
    return pseudonym;
  };

  const host = (raw: string | null | undefined): string => {
    const value = String(raw ?? '').trim();
    const { hostname, port } = splitDiagnosticHost(value);
    const pseudonym = hostToken(hostname);
    return pseudonym ? `${pseudonym}${port}` : value;
  };

  /**
   * Registered hosts met in free text (error messages, log lines). Only names
   * with a dot or a colon: a one-word LAN name such as `qortal` would
   * otherwise eat ordinary words; the host fields themselves go through
   * `host`.
   */
  const replaceHosts = (text: string): string => {
    let out = text;
    // Longest first, so `node.example.com` wins over `example.com`.
    const entries = [...hosts.entries()]
      .filter(([hostname]) => /[.:]/.test(hostname))
      .sort((a, b) => b[0].length - a[0].length);
    for (const [hostname, pseudonym] of entries) {
      out = out.replace(
        new RegExp(
          `(?<![\\w.-])${escapeRegExp(hostname)}(?![\\w-]|\\.\\w)`,
          'gi'
        ),
        pseudonym
      );
    }
    return out;
  };

  const line = (text: string): string => {
    const raw = String(text ?? '');
    const out = replaceHosts(raw)
      .replace(SECRET_PAIR_RE, '$1=<redacted>')
      .replace(
        JSON_ID_PAIR_RE,
        (
          _m,
          key: string,
          separator: string,
          quoted: string | undefined,
          number: string | undefined
        ) => jsonPair(key, separator, quoted, number)
      )
      .replace(HOST_PAIR_RE, (match, value: string) =>
        plainValue(value) ? match : `host=${host(value)}`
      )
      .replace(
        ID_PAIR_RE,
        (match, key: string, value: string, offset: number, whole: string) =>
          isEventCountPair(key, value, offset, whole)
            ? match
            : `${key}=${pairValue(value, key)}`
      )
      .replace(
        GROUP_WORD_RE,
        (_m, word: string, ids: string) =>
          `${word} ${ids
            .split(',')
            .map((id) => token('id', id))
            .join(',')}`
      )
      .replace(UUID_RE, (uuid) => token('id', uuid))
      .replace(ADDRESS_RE, (address) => token('addr', address))
      .replace(BASE58_RE, (id) => token('id', id))
      .replace(HEX_ID_RE, (id) => token('id', id));
    if (USER_AGENT_LINE_RE.test(raw)) return out;
    return out
      .replace(IPV4_RE, (_m, ip: string) => ipToken(ip))
      .replace(IPV6_RE, (candidate) => ipv6Token(candidate));
  };

  return { host, line };
}
