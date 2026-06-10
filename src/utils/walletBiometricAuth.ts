import { Preferences } from '@capacitor/preferences';
import i18n from 'i18next';
import {
  isQortalBiometricHardwareAvailable,
  verifyQortalBiometric,
} from '../plugins/QortalBiometric';
import { getData, storeData } from './chromeStorage';
import { isCapacitor } from './platform';
import { decryptStoredWallet } from './decryptWallet';

const ENABLED_KEY = 'walletBiometricEnabledAddresses';
const ENABLED_LS_KEY = 'walletBiometricEnabledAddresses';
const STORAGE_PREFIX = 'biometric_unlock_';
const LEGACY_PWD_PREFIX = 'qortal.biometric.pwd.';

function normalizeAddress(address?: string | null): string {
  return address?.trim() || '';
}

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}${normalizeAddress(address)}`;
}

function legacyPasswordKey(address: string): string {
  return `${LEGACY_PWD_PREFIX}${normalizeAddress(address)}`;
}

async function loadEnabledSet(): Promise<Set<string>> {
  try {
    const { value } = await Preferences.get({ key: ENABLED_KEY });
    if (value) {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((item) => typeof item === 'string').map(normalizeAddress)
        );
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const local = localStorage.getItem(ENABLED_LS_KEY);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((item) => typeof item === 'string').map(normalizeAddress)
        );
      }
    }
  } catch {
    /* ignore */
  }

  return new Set();
}

function loadEnabledSetSync(): Set<string> {
  try {
    const local = localStorage.getItem(ENABLED_LS_KEY);
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((item) => typeof item === 'string').map(normalizeAddress)
        );
      }
    }
  } catch {
    /* ignore */
  }

  return new Set();
}

function readStoredPasswordSync(address: string): string | null {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return null;

  const key = storageKey(trimmed);

  try {
    const local = localStorage.getItem(key);
    if (local && local.length > 0) {
      return local;
    }
  } catch {
    /* ignore */
  }

  try {
    const legacy = localStorage.getItem(legacyPasswordKey(trimmed));
    if (legacy && legacy.length > 0) {
      return legacy;
    }
  } catch {
    /* ignore */
  }

  return null;
}

export function isBiometricUnlockConfiguredSync(address: string): boolean {
  return Boolean(readStoredPasswordSync(address));
}

/** Fast synchronous read for UI; async getBiometricEnabledAddresses confirms Preferences/SecureStorage. */
export function getBiometricEnabledAddressesSync(
  walletAddresses: string[] = []
): string[] {
  const candidates = new Set<string>();

  for (const address of walletAddresses) {
    const trimmed = normalizeAddress(address);
    if (trimmed) candidates.add(trimmed);
  }

  for (const address of loadEnabledSetSync()) {
    candidates.add(address);
  }

  const configured: string[] = [];
  for (const address of candidates) {
    if (isBiometricUnlockConfiguredSync(address)) {
      configured.push(address);
    }
  }

  return configured;
}

async function saveEnabledSet(addresses: Set<string>): Promise<void> {
  const payload = JSON.stringify(
    [...addresses].map(normalizeAddress).filter(Boolean)
  );

  await Preferences.set({ key: ENABLED_KEY, value: payload });

  try {
    localStorage.setItem(ENABLED_LS_KEY, payload);
  } catch {
    /* ignore */
  }
}

export async function waitForNativeBiometricPrompt(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
}

async function readLegacyPassword(address: string): Promise<string | null> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) return null;

  try {
    const { value } = await Preferences.get({ key: legacyPasswordKey(trimmed) });
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    /* fall through */
  }

  try {
    const local = localStorage.getItem(legacyPasswordKey(trimmed));
    if (local && local.length > 0) {
      return local;
    }
  } catch {
    /* ignore */
  }

  return null;
}

async function readStoredPassword(address: string): Promise<string | null> {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return null;

  const key = storageKey(trimmed);

  try {
    const { value } = await Preferences.get({ key });
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  } catch {
    /* fall through */
  }

  try {
    const local = localStorage.getItem(key);
    if (local && local.length > 0) {
      return local;
    }
  } catch {
    /* ignore */
  }

  try {
    const data = await getData<{ password?: string }>(key);
    const securePassword = data?.password;
    if (typeof securePassword === 'string' && securePassword.length > 0) {
      return securePassword;
    }
  } catch {
    /* fall through */
  }

  return readLegacyPassword(trimmed);
}

async function writeStoredPassword(
  address: string,
  password: string
): Promise<void> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) {
    throw new Error('No wallet address provided.');
  }

  const key = storageKey(trimmed);

  await Preferences.set({ key, value: password });

  try {
    localStorage.setItem(key, password);
  } catch {
    /* ignore */
  }

  try {
    await storeData(key, { address: trimmed, password });
  } catch {
    /* SecureStorage backup is optional */
  }

  const stored = await readStoredPassword(trimmed);
  if (stored !== password) {
    throw new Error(
      i18n.t('auth:mobile_login_settings.biometric_enable_failed')
    );
  }
}

async function deleteStoredPassword(address: string): Promise<void> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) return;

  const key = storageKey(trimmed);

  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }

  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }

  try {
    await Preferences.remove({ key: legacyPasswordKey(trimmed) });
  } catch {
    /* ignore */
  }

  try {
    localStorage.removeItem(legacyPasswordKey(trimmed));
  } catch {
    /* ignore */
  }

  try {
    const { SecureStoragePlugin } = await import(
      '@evva/capacitor-secure-storage-plugin'
    );
    await SecureStoragePlugin.remove({ key });
  } catch {
    /* ignore */
  }
}

async function markAddressEnabled(address: string): Promise<void> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) return;
  const enabled = await loadEnabledSet();
  enabled.add(trimmed);
  await saveEnabledSet(enabled);
}

async function promptBiometricEnableSheet(): Promise<void> {
  await waitForNativeBiometricPrompt();
  try {
    await verifyQortalBiometric({
      title: 'Biometric unlock',
      subtitle: 'Qortal Go',
      description:
        'Place your finger on the sensor to enable fingerprint unlock',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('cancel')) {
      throw new Error(
        i18n.t('auth:mobile_login_settings.biometric_scan_cancelled')
      );
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

async function promptBiometricUnlockSheet(): Promise<void> {
  await waitForNativeBiometricPrompt();
  try {
    await verifyQortalBiometric({
      title: 'Biometric unlock',
      subtitle: 'Qortal Go',
      description: 'Place your finger on the sensor to unlock',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('cancel')) {
      throw new Error(
        i18n.t('auth:mobile_login_settings.biometric_scan_cancelled')
      );
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  if (!isCapacitor()) return false;
  return isQortalBiometricHardwareAvailable();
}

export async function isBiometricEnabledForWallet(
  address: string
): Promise<boolean> {
  return isBiometricUnlockConfigured(address);
}

export async function isBiometricUnlockConfigured(
  address: string
): Promise<boolean> {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return false;

  const password = await readStoredPassword(trimmed);
  return Boolean(password);
}

export async function getBiometricEnabledAddresses(
  walletAddresses: string[] = []
): Promise<string[]> {
  const candidates = new Set<string>();

  for (const address of walletAddresses) {
    const trimmed = normalizeAddress(address);
    if (trimmed) candidates.add(trimmed);
  }

  for (const address of await loadEnabledSet()) {
    candidates.add(address);
  }

  const configured: string[] = [];
  for (const address of candidates) {
    if (await isBiometricUnlockConfigured(address)) {
      configured.push(address);
    }
  }

  return configured;
}

export async function verifyWalletPassword(
  password: string,
  wallet: Record<string, unknown>
): Promise<boolean> {
  try {
    await decryptStoredWallet(password, wallet);
    return true;
  } catch {
    return false;
  }
}

export async function promptBiometricEnable(): Promise<void> {
  await promptBiometricEnableSheet();
}

export async function storeBiometricCredentials(
  address: string,
  password: string
): Promise<void> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) {
    throw new Error('No wallet address provided.');
  }

  await writeStoredPassword(trimmed, password);
  await markAddressEnabled(trimmed);
}

export async function finalizeBiometricUnlockStorage(
  address: string,
  password: string
): Promise<void> {
  if (!isCapacitor()) {
    throw new Error('Biometric unlock is only available on the mobile app.');
  }

  const trimmed = normalizeAddress(address);
  if (!trimmed) {
    throw new Error('No wallet address provided.');
  }

  await promptBiometricEnableSheet();
  await storeBiometricCredentials(trimmed, password);
}

export async function enableBiometricUnlockForWallet(
  address: string,
  password: string,
  wallet: Record<string, unknown>
): Promise<void> {
  const valid = await verifyWalletPassword(password, wallet);
  if (!valid) {
    throw new Error(
      i18n.t('auth:mobile_login_settings.biometric_wrong_password')
    );
  }

  await finalizeBiometricUnlockStorage(address, password);
}

export async function disableBiometricUnlock(address: string): Promise<void> {
  if (!isCapacitor()) return;

  const trimmed = normalizeAddress(address);
  await deleteStoredPassword(trimmed);

  const enabled = await loadEnabledSet();
  enabled.delete(trimmed);
  await saveEnabledSet(enabled);
}

export async function unlockPasswordWithBiometric(
  address: string
): Promise<string> {
  if (!isCapacitor()) {
    throw new Error('Biometric unlock is only available on the mobile app.');
  }

  const trimmed = normalizeAddress(address);
  if (!(await isBiometricUnlockConfigured(trimmed))) {
    throw new Error('Fingerprint unlock is not set up for this account.');
  }

  await promptBiometricUnlockSheet();

  const password = await readStoredPassword(trimmed);
  if (!password) {
    throw new Error('No stored credentials for this account.');
  }

  return password;
}
