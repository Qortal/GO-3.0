/**
 * Primary names of the wallets saved on this device, kept locally so the
 * account picker and Login settings never have to ask the node about them.
 *
 * Asking the node for every saved wallet at once (POST /names/list with the
 * whole list) told the node operator exactly which wallets share this phone,
 * before any login and including wallets that are never unlocked. Instead, a
 * wallet's name is remembered whenever GO looks it up while that wallet is
 * in use (the unlock screen and the signed-in top bar already do), one
 * address at a time, and the picker shows what was remembered.
 */
import { getData, storeData } from './chromeStorage';
import { getLastAuthenticatedWalletAddress } from './lastAuthenticatedWallet';
import type { WalletAvatarCacheEntry } from './walletAvatarCache';

const STORAGE_KEY = 'walletPrimaryNameByAddress';

type StoredEntry = { name: string; at: number };
type StoredMap = Record<string, StoredEntry>;

const deviceWalletAddresses = new Set<string>();
let writeChain: Promise<unknown> = Promise.resolve();

const normalizeAddress = (address: unknown): string =>
  typeof address === 'string' ? address.trim() : '';

async function readMap(): Promise<StoredMap> {
  try {
    const stored = await getData<StoredMap>(STORAGE_KEY);
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

/**
 * Remembered primary names for these addresses. Addresses with nothing
 * remembered are left out; `''` means "looked up, has no name".
 */
export async function getCachedWalletPrimaryNames(
  addresses: string[]
): Promise<Record<string, string>> {
  const map = await readMap();
  const out: Record<string, string> = {};
  for (const raw of addresses) {
    const address = normalizeAddress(raw);
    const entry = address ? map[address] : undefined;
    if (entry && typeof entry.name === 'string') out[address] = entry.name;
  }
  return out;
}

/**
 * Names already stored with cached avatars (written while each wallet was
 * signed in). Used until a wallet's own name entry exists.
 */
export function primaryNamesFromAvatarCache(
  entries: Record<string, WalletAvatarCacheEntry> | null | undefined,
  addresses: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entries) return out;
  for (const raw of addresses) {
    const address = normalizeAddress(raw);
    const name = entries[address]?.primaryName?.trim();
    if (address && name) out[address] = name;
  }
  return out;
}

/** Run one read-modify-write of the stored map after the previous ones. */
function queueWrite<T>(task: () => Promise<T>): Promise<T> {
  const write = writeChain.then(task);
  // Keep the chain alive after a failed write.
  writeChain = write.catch(() => undefined);
  return write;
}

/** Store one wallet's primary name (`''` when it has none). */
export function rememberWalletPrimaryName(
  address: string,
  name: string
): Promise<void> {
  const key = normalizeAddress(address);
  if (!key) return Promise.resolve();
  const value = typeof name === 'string' ? name.trim() : '';
  return queueWrite(async () => {
    const map = await readMap();
    if (map[key]?.name === value) return;
    map[key] = { name: value, at: Date.now() };
    await storeData(STORAGE_KEY, map);
  });
}

/**
 * Addresses in `cached` that are neither in `keep` (the wallets saved on
 * this device) nor the wallet signed in last: what a removed wallet left
 * behind in a per-wallet cache.
 */
export function staleWalletAddresses(
  cached: string[],
  keep: string[]
): string[] {
  const kept = new Set(keep.map(normalizeAddress).filter(Boolean));
  const lastAuthenticated = getLastAuthenticatedWalletAddress();
  if (lastAuthenticated) kept.add(lastAuthenticated);
  return cached.filter((address) => !kept.has(normalizeAddress(address)));
}

/**
 * Drop the names of wallets no longer saved on this device, so a removed
 * wallet does not stay linked to the phone. Returns the addresses dropped.
 */
export function forgetWalletPrimaryNames(keep: string[]): Promise<string[]> {
  return queueWrite(async () => {
    const map = await readMap();
    const stale = staleWalletAddresses(Object.keys(map), keep);
    if (stale.length === 0) return [];
    for (const address of stale) delete map[address];
    await storeData(STORAGE_KEY, map);
    return stale;
  });
}

/** Drop one wallet's name (the wallet was removed from this device). */
export function forgetWalletPrimaryName(address: string): Promise<void> {
  const key = normalizeAddress(address);
  if (!key) return Promise.resolve();
  deviceWalletAddresses.delete(key);
  return queueWrite(async () => {
    const map = await readMap();
    if (!(key in map)) return;
    delete map[key];
    await storeData(STORAGE_KEY, map);
  });
}

/**
 * The account picker registers the wallets saved on this device; the list
 * replaces the previous one, so a removed wallet stops counting as own.
 */
export function registerDeviceWalletAddresses(addresses: string[]): void {
  const next = addresses.map(normalizeAddress).filter(Boolean);
  if (next.length === 0) return;
  deviceWalletAddresses.clear();
  for (const address of next) deviceWalletAddresses.add(address);
}

const LOOPBACK_HOSTNAME_RE = /^(localhost|.+\.localhost|127(?:\.\d{1,3}){3})$/i;

/**
 * True for a node on this device itself (loopback). Asking your own node
 * about all your wallets tells nobody anything; a remote or LAN node is
 * someone else's server, or can be.
 */
export function isLoopbackNodeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return (
      LOOPBACK_HOSTNAME_RE.test(host) || host === '[::1]' || host === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Names for every wallet saved on this device, asked of a node on this
 * device (see isLoopbackNodeUrl): the picker's names stay fresh on a desktop
 * with its own Core. The answer is remembered, `''` for wallets without a
 * name. `lookup` is the bulk name request (getPrimaryNamesForAddresses).
 */
export async function refreshWalletPrimaryNamesFromOwnNode(
  addresses: string[],
  lookup: (addresses: string[]) => Promise<Record<string, string>>
): Promise<Record<string, string>> {
  const unique = Array.from(
    new Set(addresses.map(normalizeAddress).filter(Boolean))
  );
  if (unique.length === 0) return {};
  const found = await lookup(unique);
  const names: Record<string, string> = {};
  for (const address of unique) {
    const name = found?.[address];
    names[address] = typeof name === 'string' ? name.trim() : '';
  }
  await Promise.all(
    unique.map((address) =>
      rememberWalletPrimaryName(address, names[address]).catch(() => undefined)
    )
  );
  return names;
}

/**
 * Whether a name looked up for `address` belongs in the cache: it is one of
 * this device's wallets, or the wallet signed in now. Names of chat partners
 * and payees are never stored.
 */
export function isOwnWalletAddress(address: string): boolean {
  const key = normalizeAddress(address);
  if (!key) return false;
  return (
    deviceWalletAddresses.has(key) ||
    getLastAuthenticatedWalletAddress() === key
  );
}

export function resetWalletPrimaryNameCacheForTests(): void {
  deviceWalletAddresses.clear();
  writeChain = Promise.resolve();
}
