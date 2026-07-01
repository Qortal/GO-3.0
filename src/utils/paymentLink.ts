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
 */

export type ParsedPaymentTarget =
  | { kind: 'payment'; recipient: string; amount?: number }
  | { kind: 'appLink'; link: string }
  | { kind: 'none' };

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

export function parsePaymentTarget(rawInput: string): ParsedPaymentTarget {
  const input = (rawInput || '').trim();
  if (!input) return { kind: 'none' };

  const lower = input.toLowerCase();

  // qortal://pay?... or qortal://send?...
  if (lower.startsWith('qortal://pay') || lower.startsWith('qortal://send')) {
    const { query } = splitQuery(input);
    return paymentFromQuery(query);
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

export const getPendingPaymentRequest = (): PendingPayment | null =>
  pendingPayment;

export const clearPendingPaymentRequest = (): void => {
  pendingPayment = null;
};

/**
 * Route a scanned/deep-linked string: open the pre-filled Send screen for
 * payments, or open the resource in the apps view for QDN links. Returns true
 * when the input was recognized and handled.
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
