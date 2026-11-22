import type { QdnSavedSettings } from './qdnSavedSettings';

/** A copy of an account's settings read from QDN, with QDN's time for it. */
export type SettingsCopy = { settings: QdnSavedSettings; updated: number };

/**
 * The newest copy of each account's settings read here in this run. A save
 * publishes the whole document, so every field GO doesn't write (Home's
 * layout, the side panel, fields newer than this GO) goes as this copy holds
 * it, instead of being dropped.
 */
const copies = new Map<string, SettingsCopy>();

export const rememberSettingsCopy = (
  address: string,
  copy: SettingsCopy
): void => {
  const known = copies.get(address);
  if (!known || copy.updated >= known.updated) copies.set(address, copy);
};

export const rememberedSettingsCopy = (address: string): SettingsCopy | null =>
  copies.get(address) ?? null;

/** Forgets every copy read, as a new run would. For tests. */
export const forgetSettingsCopies = (): void => copies.clear();
