import { validateAddress } from './validateAddress';
import { executeEvent } from './events';
import { extractComponents } from '../components/Chat/MessageDisplay';

/**
 * Parsing + routing for scanned QR codes and `qortal://` / `qort:` deep links.
 *
 * Two things can arrive here:
 *   1. A PAYMENT target — open the Send-QORT screen pre-filled with recipient
 *      (+ optional amount) so the user only has to confirm with their password.
 *   2. A QDN resource/app link (`qortal://SERVICE/name/...`) — open it in the
 *      apps view, mirroring the in-chat qortal-link behavior.
 *
 * Supported payment forms (case-insensitive scheme):
 *   • qortal://pay?recipient=<address|name>&amount=<qort>   ← recommended standard
 *   • qortal://send?to=<address|name>&amount=<qort>          (alias)
 *   • qort:<address>?amount=<qort>                           (BIP21-style)
 *   • qortal://<address>                                     (bare address after scheme)
 *   • <address>                                              (bare address, e.g. scanned QR)
 *
 * Recognized amount aliases: amount, qty, qort. Recognized recipient aliases:
 * recipient, address, to, r. A recipient may be a raw Qortal address OR a
 * registered name (names can't be validated offline, so query-param recipients
 * are accepted as-is; bare/ambiguous inputs must be a valid address).
 *
 * Qortal gateway web links are also accepted: an https(s) URL on a known Qortal
 * gateway host is translated to the equivalent `qortal://` deep link and routed
 * through the exact same pipeline, so tapping e.g.
 *   https://qortal.link/WEBSITE/REON   →  qortal://WEBSITE/REON
 * opens the resource in the apps view (and gateway payment links open Send).
 */

export type ParsedPaymentTarget =
  | { kind: 'payment'; recipient: string; amount?: number }
  | { kind: 'appLink'; link: string }
  | { kind: 'joinGroup'; groupId: string }
  | { kind: 'none' };

/** Parse qortal://use-group/action-join/groupid-<id> style action links. */
export function parseUseGroupJoinLink(rawInput: string): string | null {
  const input = (rawInput || '').trim();
  if (!input) return null;
  let rest = input;
  if (/^https?:\/\//i.test(rest)) {
    const gateway = gatewayHttpsToQortalLink(rest);
    if (!gateway) return null;
    rest = gateway;
  }
  rest = rest.replace(/^(qortal:\/\/)/i, '').replace(/^(qortal:)/i, '');
  if (!rest.toLowerCase().startsWith('use-')) return null;
  try {
    const parts = rest.split('/');
    parts.shift(); // use-group
    const actionPart = parts.length > 0 ? parts[0] : '';
    const action = actionPart.includes('-')
      ? actionPart.split('-').slice(1).join('-')
      : actionPart;
    parts.shift();
    const idPart = parts.length > 0 ? parts[0] : '';
    // groupid-810 → 810 (also tolerate bare numeric id)
    const idMatch = idPart.match(/^(?:groupid-)?(\d+)$/i);
    const groupId = idMatch?.[1] || null;
    if (action.toLowerCase() === 'join' && groupId) return groupId;
  } catch {
    return null;
  }
  return null;
}

const AMOUNT_KEYS = ['amount', 'qty', 'qort', 'value'];
const RECIPIENT_KEYS = ['recipient', 'address', 'to', 'r'];

const parseAmount = (raw: string | null | undefined): number | undefined => {
  if (!raw) return undefined;
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
};

const readParam = (
  params: URLSearchParams,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const direct = params.get(key);
    if (direct) return direct;
    // case-insensitive fallback
    for (const [k, v] of params.entries()) {
      if (k.toLowerCase() === key && v) return v;
    }
  }
  return undefined;
};

const paymentFromQuery = (query: string): ParsedPaymentTarget => {
  const params = new URLSearchParams(query);
  const recipient = (readParam(params, RECIPIENT_KEYS) || '').trim();
  const amount = parseAmount(readParam(params, AMOUNT_KEYS));
  if (!recipient) return { kind: 'none' };
  return { kind: 'payment', recipient, ...(amount ? { amount } : {}) };
};

/** Split "target?query" into its parts (query optional). */
const splitQuery = (input: string): { base: string; query: string } => {
  const idx = input.indexOf('?');
  if (idx === -1) return { base: input, query: '' };
  return { base: input.slice(0, idx), query: input.slice(idx + 1) };
};

/**
 * Known Qortal gateway hosts whose https(s) web links mirror QDN `qortal://`
 * deep links. Matched case-insensitively; a leading `www.` is ignored and any
 * `*.qortal.link` subdomain is treated as part of the gateway family.
 *
 * Kept intentionally to the `qortal.link` gateway family: `*.qortal.org` hosts
 * are API/core nodes whose paths are REST endpoints (not `SERVICE/name` render
 * paths), so blindly rewriting them to `qortal://` would mis-route. Add a
 * specific qortal.org gateway host here if one is ever stood up.
 */
const GATEWAY_HOSTS = new Set<string>([
  'qortal.link',
  'hub.qortal.link',
  'go.qortal.link',
  'ext-node.qortal.link',
]);

const isGatewayHost = (host: string): boolean => {
  const h = (host || '').trim().toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  if (GATEWAY_HOSTS.has(h)) return true;
  // Any qortal.link subdomain belongs to the QDN gateway family.
  return h === 'qortal.link' || h.endsWith('.qortal.link');
};

/**
 * Translate a Qortal gateway https(s) URL into the equivalent `qortal://` deep
 * link: drop the scheme + gateway host, keep the remaining path + query + hash,
 * and prepend `qortal://`. Returns null when the input is not an http(s) URL on
 * a recognized gateway host (or resolves to the gateway root with nothing to
 * open), so the caller can fall through to the normal parsing paths.
 *
 *   https://qortal.link/WEBSITE/REON?foo=1  →  qortal://WEBSITE/REON?foo=1
 */
export function gatewayHttpsToQortalLink(rawInput: string): string | null {
  const input = (rawInput || '').trim();
  if (!/^https?:\/\//i.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!isGatewayHost(url.hostname)) return null;
  const path = url.pathname.replace(/^\/+/, '');
  const rest = `${path}${url.search}${url.hash}`;
  // Gateway root (no resource/path) — nothing meaningful to open.
  if (!rest || !/[^/]/.test(rest)) return null;
  return `qortal://${rest}`;
}

export function parsePaymentTarget(rawInput: string): ParsedPaymentTarget {
  let input = (rawInput || '').trim();
  if (!input) return { kind: 'none' };

  // Qortal gateway web link → equivalent qortal:// deep link, then parse it
  // exactly like a native link (resource opens in apps view, ?pay opens Send).
  const gatewayLink = gatewayHttpsToQortalLink(input);
  if (gatewayLink) input = gatewayLink;

  const lower = input.toLowerCase();

  // qortal://pay?... or qortal://send?...
  if (lower.startsWith('qortal://pay') || lower.startsWith('qortal://send')) {
    const { query } = splitQuery(input);
    return paymentFromQuery(query);
  }

  // qortal://use-group/action-join/groupid-<id>
  const joinGroupId = parseUseGroupJoinLink(input);
  if (joinGroupId) {
    return { kind: 'joinGroup', groupId: joinGroupId };
  }

  // qortal://...  — either a bare address or a QDN resource/app link.
  if (lower.startsWith('qortal://')) {
    const rest = input.slice('qortal://'.length);
    const { base, query } = splitQuery(rest);
    // Bare address directly after the scheme (no path segment).
    if (base && !base.includes('/') && validateAddress(base.trim())) {
      const params = new URLSearchParams(query);
      const amount = parseAmount(readParam(params, AMOUNT_KEYS));
      return {
        kind: 'payment',
        recipient: base.trim(),
        ...(amount ? { amount } : {}),
      };
    }
    // Otherwise it's a resource/app link.
    if (extractComponents(input)) {
      return { kind: 'appLink', link: input };
    }
    return { kind: 'none' };
  }

  // BIP21-style single-colon schemes: qortal:<recipient>?amount=.. or
  // qort:<recipient>?amount=.. (this is what many payment gateways encode,
  // e.g. qortal:QUxbm...?amount=5). Also tolerates qortal:pay?... /
  // qortal:?recipient=.. shapes. Recipient may be an address or a name.
  if (lower.startsWith('qortal:') || lower.startsWith('qort:')) {
    const rest = input
      .slice(input.indexOf(':') + 1)
      .replace(/^\/+/, '')
      .trim();
    const { base, query } = splitQuery(rest);
    const baseLower = base.trim().toLowerCase();
    if (!base || baseLower === 'pay' || baseLower === 'send') {
      return paymentFromQuery(query);
    }
    const params = new URLSearchParams(query);
    const amount = parseAmount(readParam(params, AMOUNT_KEYS));
    const recipient = base.trim();
    return { kind: 'payment', recipient, ...(amount ? { amount } : {}) };
  }

  // Bare Qortal address (e.g. the raw text encoded in a payment-gateway QR).
  const { base, query } = splitQuery(input);
  if (validateAddress(base.trim())) {
    const params = new URLSearchParams(query);
    const amount = parseAmount(readParam(params, AMOUNT_KEYS));
    return {
      kind: 'payment',
      recipient: base.trim(),
      ...(amount ? { amount } : {}),
    };
  }

  return { kind: 'none' };
}

// ── Pending request (cold-launch / pre-auth) ────────────────────────────────
// A deep link can arrive before the authenticated app UI is mounted (app opened
// from cold by an external QR scanner). We stash the parsed payment so App can
// replay it once the Send overlay is available.

type PendingPayment = { recipient: string; amount?: number };
let pendingPayment: PendingPayment | null = null;
let pendingJoinGroupId: string | null = null;

export const getPendingPaymentRequest = (): PendingPayment | null =>
  pendingPayment;

export const clearPendingPaymentRequest = (): void => {
  pendingPayment = null;
};

export const getPendingJoinGroupRequest = (): string | null =>
  pendingJoinGroupId;

export const clearPendingJoinGroupRequest = (): void => {
  pendingJoinGroupId = null;
};

/**
 * Route a scanned/deep-linked string: open the pre-filled Send screen for
 * payments, open the Join Group dialog for use-group join links, or open the
 * resource in the apps view for QDN links. Returns true when the input was
 * recognized and handled.
 */
export function handleQortalDeepLink(rawInput: string): boolean {
  const parsed = parsePaymentTarget(rawInput);
  if (parsed.kind === 'payment') {
    pendingPayment = { recipient: parsed.recipient, amount: parsed.amount };
    // Fire immediately in case the app is already authenticated + mounted.
    executeEvent('openPaymentInternal', {
      address: parsed.recipient,
      amount: parsed.amount,
    });
    return true;
  }
  if (parsed.kind === 'joinGroup') {
    pendingJoinGroupId = parsed.groupId;
    executeEvent('globalActionJoinGroup', { groupId: parsed.groupId });
    return true;
  }
  if (parsed.kind === 'appLink') {
    const res = extractComponents(parsed.link);
    if (res) {
      const { service, name, identifier, path } = res;
      executeEvent('addTab', { data: { service, name, identifier, path } });
      executeEvent('open-apps-mode', {});
      return true;
    }
  }
  return false;
}
