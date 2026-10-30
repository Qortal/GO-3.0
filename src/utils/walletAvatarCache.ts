import { getData, storeData } from './chromeStorage';
import {
  getArbitraryEndpointReact,
  getBaseApiReactForAvatar,
} from './globalApi';

const STORAGE_KEY = 'walletAvatarByAddress';

export type WalletAvatarCacheEntry = {
  dataUrl: string;
  primaryName: string;
};

type StoredWalletAvatarMap = Record<string, WalletAvatarCacheEntry | string>;

async function readRawMap(): Promise<StoredWalletAvatarMap> {
  const stored = await getData<StoredWalletAvatarMap>(STORAGE_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

function normalizeWalletAvatarCacheEntry(
  raw: unknown
): WalletAvatarCacheEntry | null {
  if (typeof raw === 'string' && raw.startsWith('data:')) {
    return { dataUrl: raw, primaryName: '' };
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Partial<WalletAvatarCacheEntry>;
    if (
      typeof record.dataUrl === 'string' &&
      record.dataUrl.startsWith('data:')
    ) {
      return {
        dataUrl: record.dataUrl,
        primaryName:
          typeof record.primaryName === 'string' ? record.primaryName : '',
      };
    }
  }
  return null;
}

export function walletAvatarCacheMatchesName(
  entry: WalletAvatarCacheEntry | null | undefined,
  primaryName?: string | null
): boolean {
  if (!entry?.dataUrl?.startsWith('data:')) return false;
  const expected = primaryName?.trim();
  const cachedName = entry.primaryName?.trim() ?? '';
  if (!expected) return true;
  if (!cachedName) return true;
  return cachedName.toLowerCase() === expected.toLowerCase();
}

/**
 * Avatar URL for a registered name. `_walletAddress` is accepted for older
 * callers but not sent: the request would tell the node which wallet address
 * is on this device, before login and for every wallet in the picker.
 */
export function buildQortalAvatarUrl(
  primaryName: string,
  _walletAddress?: string
): string {
  const encoded = encodeURIComponent(primaryName.trim());
  return `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encoded}/qortal_avatar?async=true`;
}

/** True when the QDN has a published qortal_avatar thumbnail. null = check failed (unknown). */
async function checkQortalAvatarExists(
  primaryName: string
): Promise<boolean | null> {
  const name = primaryName.trim();
  if (!name) return false;

  try {
    const url = `${getBaseApiReactForAvatar()}${getArbitraryEndpointReact()}?mode=ALL&service=THUMBNAIL&identifier=qortal_avatar&limit=1&name=${encodeURIComponent(name)}&includemetadata=false&prefix=true`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return false;
    const itemName =
      typeof data[0]?.name === 'string' ? data[0].name.trim() : '';
    return itemName.toLowerCase() === name.toLowerCase();
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (!blob.size) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.startsWith('data:') ? result : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Download the QDN avatar thumbnail as a data URL for local cache storage. */
export async function fetchWalletAvatarDataUrl(
  primaryName: string
): Promise<string | null> {
  const name = primaryName.trim();
  if (!name) return null;

  try {
    const response = await fetch(buildQortalAvatarUrl(name));
    if (!response.ok) return null;
    return blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
}

/** Resolve which avatar image to show for a wallet row or top bar. */
export function resolveWalletAvatarSrc(options: {
  primaryName?: string | null;
  walletAddress?: string;
  cachedAvatarEntry?: WalletAvatarCacheEntry | null;
}): string | undefined {
  const primaryName = options.primaryName?.trim();
  const cache = options.cachedAvatarEntry;

  if (primaryName) {
    if (walletAvatarCacheMatchesName(cache, primaryName) && cache?.dataUrl) {
      return cache.dataUrl;
    }
    return buildQortalAvatarUrl(primaryName, options.walletAddress);
  }

  if (cache?.dataUrl?.startsWith('data:')) {
    return cache.dataUrl;
  }

  return undefined;
}

/** Cached avatar for one wallet address (optionally scoped to a QDN name). */
export async function getWalletAvatarCache(
  address: string,
  primaryName?: string | null
): Promise<WalletAvatarCacheEntry | null> {
  if (!address) return null;
  const map = await readRawMap();
  const entry = normalizeWalletAvatarCacheEntry(map[address]);
  if (!entry) return null;
  if (primaryName != null && primaryName !== '') {
    return walletAvatarCacheMatchesName(entry, primaryName) ? entry : null;
  }
  return entry;
}

/** All cached wallet avatars keyed by address. */
export async function getWalletAvatarCacheEntries(): Promise<
  Record<string, WalletAvatarCacheEntry>
> {
  const map = await readRawMap();
  const entries: Record<string, WalletAvatarCacheEntry> = {};
  for (const [address, raw] of Object.entries(map)) {
    const entry = normalizeWalletAvatarCacheEntry(raw);
    if (entry) entries[address] = entry;
  }
  return entries;
}

/** Remove a stale cached avatar for one wallet address. */
export async function clearWalletAvatarCache(address: string): Promise<void> {
  if (!address) return;
  const map = await readRawMap();
  if (!map[address]) return;
  delete map[address];
  await storeData(STORAGE_KEY, map);
}

/** Persist avatar preview locally, bound to the wallet address + QDN name. */
export async function setWalletAvatarCache(
  address: string,
  dataUrl: string,
  primaryName = ''
): Promise<void> {
  if (!address || !dataUrl.startsWith('data:')) return;
  const map = await readRawMap();
  map[address] = {
    dataUrl,
    primaryName: primaryName.trim(),
  };
  await storeData(STORAGE_KEY, map);
}

/** Verify QDN avatars and refresh per-address cache on the Enter Qortal screen. */
export async function syncWalletAvatarCachesForAddresses(
  addresses: string[],
  primaryNamesByAddress: Record<string, string>,
  options?: { namesLoaded?: boolean }
): Promise<{
  hasAvatarByAddress: Record<string, boolean | null | undefined>;
  entriesByAddress: Record<string, WalletAvatarCacheEntry>;
}> {
  const caches = await getWalletAvatarCacheEntries();
  const hasAvatarByAddress: Record<string, boolean | null | undefined> = {};
  const entriesByAddress: Record<string, WalletAvatarCacheEntry> = {
    ...caches,
  };

  if (options?.namesLoaded === false) {
    return { hasAvatarByAddress, entriesByAddress };
  }

  await Promise.all(
    addresses.map(async (address) => {
      const primaryName = primaryNamesByAddress[address]?.trim();

      if (!primaryName) {
        if (options?.namesLoaded) {
          if (caches[address]) {
            await clearWalletAvatarCache(address);
            delete entriesByAddress[address];
          }
          hasAvatarByAddress[address] = false;
        }
        return;
      }

      const cached = normalizeWalletAvatarCacheEntry(caches[address]);

      if (cached && !walletAvatarCacheMatchesName(cached, primaryName)) {
        await clearWalletAvatarCache(address);
        delete entriesByAddress[address];
      }

      const exists = await checkQortalAvatarExists(primaryName);
      hasAvatarByAddress[address] = exists ?? undefined;

      const current = entriesByAddress[address];
      if (walletAvatarCacheMatchesName(current, primaryName)) {
        return;
      }

      const dataUrl = await fetchWalletAvatarDataUrl(primaryName);
      if (!dataUrl) return;

      await setWalletAvatarCache(address, dataUrl, primaryName);
      entriesByAddress[address] = { dataUrl, primaryName };
    })
  );

  return { hasAvatarByAddress, entriesByAddress };
}
