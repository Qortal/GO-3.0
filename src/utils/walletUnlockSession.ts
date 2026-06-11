/** Tracks wallets decrypted this app session — enables biometric-only re-unlock. */

const unlockedAddresses = new Set<string>();

export function markWalletUnlockedInSession(address?: string | null): void {
  const trimmed = address?.trim();
  if (trimmed) unlockedAddresses.add(trimmed);
}

export function isWalletUnlockedInSession(address?: string | null): boolean {
  const trimmed = address?.trim();
  return Boolean(trimmed && unlockedAddresses.has(trimmed));
}

export function clearWalletUnlockSession(address?: string | null): void {
  if (address?.trim()) {
    unlockedAddresses.delete(address.trim());
  } else {
    unlockedAddresses.clear();
  }
}
