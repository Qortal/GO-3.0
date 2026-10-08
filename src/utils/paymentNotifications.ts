/**
 * QORT payments received (Core `PAYMENT_RECEIVED` notifications).
 *
 * Core sends `{ event, data: { sender, recipient, amount, created,
 * signature } }` with the sender's address only. The sender's registered
 * name is looked up once per address and written onto the item
 * (`data.senderName`), with the sender's avatar as the item's `image`, so the
 * bell card, the history and the tray alert all show who paid.
 */
import { getBaseApiReactForPrimaryName } from './globalApi';

export const PAYMENT_RECEIVED_EVENT = 'PAYMENT_RECEIVED';
/** Tray alert type: a tap opens Q-Wallets. */
export const PAYMENT_ALERT_TYPE = 'payment';
const WALLETS_AVATAR_PATH =
  '/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true';
const NAME_LOOKUP_TIMEOUT_MS = 5000;

type PaymentNotification = {
  event?: string;
  image?: string;
  data?: {
    sender?: string;
    senderName?: string;
    amount?: unknown;
    signature?: string;
  };
};

export const isPaymentNotification = (
  notification: unknown
): notification is PaymentNotification =>
  (notification as PaymentNotification)?.event === PAYMENT_RECEIVED_EVENT &&
  !!(notification as PaymentNotification)?.data;

/** Node path of a name's avatar, or the Q-Wallets one without a name. */
export function paymentAvatarPath(senderName?: string): string {
  const name = senderName?.trim();
  return name
    ? `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`
    : WALLETS_AVATAR_PATH;
}

/** `500.00000000` → `500`, `0.10000000` → `0.1`, in the user's locale. */
export function formatPaymentAmount(raw: unknown, language?: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return String(raw ?? 0);
  try {
    return value.toLocaleString(language || undefined, {
      maximumFractionDigits: 8,
    });
  } catch {
    return String(value);
  }
}

/** The sender's name, or a shortened address when they have none. */
export function paymentSenderLabel(notification: PaymentNotification): string {
  const name = String(notification?.data?.senderName ?? '').trim();
  if (name) return name;
  const address = notification?.data?.sender?.trim() || '';
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/** address → registered name ('' when none). Failed lookups are retried. */
const senderNames = new Map<string, string>();
const pendingLookups = new Map<string, Promise<string>>();

export function lookupPaymentSenderName(address: string): Promise<string> {
  const known = senderNames.get(address);
  if (known !== undefined) return Promise.resolve(known);
  const pending = pendingLookups.get(address);
  if (pending) return pending;
  const lookup = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAME_LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${getBaseApiReactForPrimaryName()}/names/primary/${encodeURIComponent(address)}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (!response.ok || !data || typeof data !== 'object' || 'error' in data)
        return '';
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      senderNames.set(address, name);
      return name;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
      pendingLookups.delete(address);
    }
  })();
  pendingLookups.set(address, lookup);
  return lookup;
}

/**
 * Writes the known sender name and avatar onto payment items. Returns the
 * same array when nothing changed, so a jotai update is a no-op then.
 */
export function applyKnownPaymentSenders<T>(list: T[]): T[] {
  let changed = false;
  const next = list.map((item) => {
    if (!isPaymentNotification(item)) return item;
    const address = item.data?.sender?.trim();
    const name =
      (address ? senderNames.get(address) : undefined) ??
      item.data?.senderName?.trim() ??
      '';
    const image = paymentAvatarPath(name);
    if (item.image === image && (item.data?.senderName ?? '') === name) {
      return item;
    }
    changed = true;
    return { ...item, image, data: { ...item.data, senderName: name } };
  });
  return changed ? next : list;
}

/** Looks up every sender not known yet; true when a new one was found. */
export async function resolvePaymentSenders(list: unknown[]): Promise<boolean> {
  const addresses = new Set<string>();
  for (const item of list) {
    if (!isPaymentNotification(item)) continue;
    const address = item.data?.sender?.trim();
    if (address && !senderNames.has(address)) addresses.add(address);
  }
  if (!addresses.size) return false;
  await Promise.all(Array.from(addresses, lookupPaymentSenderName));
  return Array.from(addresses).some((address) => senderNames.has(address));
}

/** For tests. */
export function resetPaymentSenderNames(): void {
  senderNames.clear();
  pendingLookups.clear();
}
