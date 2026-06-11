/** In-memory KDF cache for the current app session (cleared on logout). */

type KdfCacheEntry = {
  key: Uint8Array;
  password: string;
};

const kdfKeyByWallet = new Map<string, KdfCacheEntry>();

export function getCachedWalletKdfKey(
  address: string,
  password: string
): Uint8Array | undefined {
  const entry = kdfKeyByWallet.get(address.trim());
  if (!entry || entry.password !== password) return undefined;
  return entry.key;
}

export function setCachedWalletKdfKey(
  address: string,
  password: string,
  key: Uint8Array
) {
  kdfKeyByWallet.set(address.trim(), {
    key: key.slice(),
    password,
  });
}

export function clearWalletKdfSessionCache(address?: string) {
  if (address) {
    kdfKeyByWallet.delete(address.trim());
  } else {
    kdfKeyByWallet.clear();
  }
}
