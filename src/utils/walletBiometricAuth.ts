import { Preferences } from '@capacitor/preferences';
import i18n from 'i18next';
import {
  deleteQortalBiometricSecret,
  getQortalBiometricEarlyPromptState,
  isQortalBiometricHardwareAvailable,
  setQortalBiometricAutoPrompt,
  verifyQortalBiometric,
  warmUpQortalBiometric,
} from '../plugins/QortalBiometric';
import {
  discardPersistedStorageKey,
  getData,
  removeData,
  storeData,
} from './chromeStorage';
import { isCapacitor } from './platform';
import { decryptStoredWallet, precomputeWalletKdfKey } from './decryptWallet';
import {
  isWalletUnlockedInSession,
  markWalletUnlockedInSession,
} from './walletUnlockSession';
import { recordUnlockTiming } from './unlockTimings';

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
        // Self-heal the localStorage mirror used by the sync helpers (it can
        // be lost if WebView storage is cleared; Preferences is the source).
        try {
          localStorage.setItem(ENABLED_LS_KEY, value);
        } catch {
          /* ignore */
        }
        return new Set(
          parsed
            .filter((item) => typeof item === 'string')
            .map(normalizeAddress)
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
          parsed
            .filter((item) => typeof item === 'string')
            .map(normalizeAddress)
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
          parsed
            .filter((item) => typeof item === 'string')
            .map(normalizeAddress)
        );
      }
    }
  } catch {
    /* ignore */
  }

  return new Set();
}

/**
 * Plaintext wallet passwords live ONLY here (process memory) and in
 * hardware-encrypted SecureStorage at rest. Older builds kept plaintext
 * copies in Preferences/localStorage; those are migrated and purged on read.
 */
const passwordMemoryCache = new Map<string, string>();

function readStoredPasswordSync(address: string): string | null {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return null;

  const cached = passwordMemoryCache.get(trimmed);
  if (cached) return cached;

  const key = storageKey(trimmed);

  // Pre-migration fallback: plaintext copies that haven't been purged yet.
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
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return false;
  // The password itself lives in SecureStorage (async); the non-secret
  // enabled-set in localStorage answers "is it configured?" synchronously.
  if (passwordMemoryCache.has(trimmed)) return true;
  if (loadEnabledSetSync().has(trimmed)) return true;
  return Boolean(readStoredPasswordSync(trimmed));
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

  // Disarm the native launch-time sheet on any enable/disable. The flag is only
  // safe to arm for the account the app auto-opens on reopen — the TOP wallet in
  // the Enter Qortal list — and this function has no wallet-order context to know
  // if that's still true. The entry screen re-arms it correctly for the top
  // wallet on its next mount (updateEarlyBiometricPromptForTopWallet); disarming
  // here just avoids an orphaned early scan in the meantime.
  void setQortalBiometricAutoPrompt(false).catch(() => {});
}

/**
 * Arm the native launch-time biometric sheet only when the account the app
 * auto-opens on reopen — the TOP wallet in the Enter Qortal list — has biometric
 * unlock enabled. That wallet's unlock screen consumes the early scan; arming it
 * for anything else would orphan the scan (user left on the account picker) and
 * can stack a second prompt. Called by the Enter Qortal list on mount and after
 * every reorder so the flag always tracks the current top wallet.
 */
export function updateEarlyBiometricPromptForTopWallet(
  topAddress: string | null | undefined
): void {
  if (!isCapacitor()) return;
  const trimmed = normalizeAddress(topAddress);
  const enabled = Boolean(trimmed) && loadEnabledSetSync().has(trimmed);
  void setQortalBiometricAutoPrompt(enabled).catch(() => {});
}

export async function waitForNativeBiometricPrompt(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function readLegacyPassword(address: string): Promise<string | null> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) return null;

  try {
    const { value } = await Preferences.get({
      key: legacyPasswordKey(trimmed),
    });
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

/**
 * localStorage is backed by an append-only leveldb log: removed values linger
 * on disk until compaction. Overwrite with junk first (so the newest record
 * is garbage), then remove, then churn the write log once so the segment
 * containing the old plaintext gets rotated out.
 */
function scrubLocalStorageKey(key: string): void {
  try {
    const existing = localStorage.getItem(key);
    if (existing !== null) {
      localStorage.setItem(key, 'x'.repeat(Math.max(existing.length, 16)));
      localStorage.removeItem(key);
      scheduleLocalStorageChurn();
    }
  } catch {
    /* ignore */
  }
}

let churnScheduled = false;
function scheduleLocalStorageChurn(): void {
  if (churnScheduled) return;
  churnScheduled = true;
  // Push ~4MB through the leveldb log to force rotation; old segments with
  // plaintext records are dropped during the next compaction.
  window.setTimeout(() => {
    try {
      const chunk = 'q'.repeat(64 * 1024);
      for (let i = 0; i < 64; i++) {
        localStorage.setItem(`__scrub_${i}`, chunk);
      }
      for (let i = 0; i < 64; i++) {
        localStorage.removeItem(`__scrub_${i}`);
      }
    } catch {
      /* quota or unavailable — best effort */
    }
  }, 3000);
}

/** Remove every plaintext copy older builds left on disk. */
async function purgePlaintextPasswordCopies(trimmed: string): Promise<void> {
  const key = storageKey(trimmed);
  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }
  scrubLocalStorageKey(key);
  try {
    await Preferences.remove({ key: legacyPasswordKey(trimmed) });
  } catch {
    /* ignore */
  }
  scrubLocalStorageKey(legacyPasswordKey(trimmed));
}

async function readStoredPassword(address: string): Promise<string | null> {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return null;

  const cached = passwordMemoryCache.get(trimmed);
  if (cached) return cached;

  const key = storageKey(trimmed);

  // Primary store: SecureStorage (AES key in the Android Keystore).
  try {
    const data = await getData<{ password?: string }>(key);
    const securePassword = data?.password;
    if (typeof securePassword === 'string' && securePassword.length > 0) {
      passwordMemoryCache.set(trimmed, securePassword);
      // Older builds also kept plaintext copies alongside the secure one.
      void purgePlaintextPasswordCopies(trimmed);
      return securePassword;
    }
  } catch {
    /* fall through */
  }

  // Migration: older builds stored the password in plaintext. Read it once,
  // move it into SecureStorage, then purge the plaintext copies.
  let plain: string | null = null;
  try {
    const { value } = await Preferences.get({ key });
    if (typeof value === 'string' && value.length > 0) plain = value;
  } catch {
    /* fall through */
  }
  if (!plain) {
    try {
      const local = localStorage.getItem(key);
      if (local && local.length > 0) plain = local;
    } catch {
      /* ignore */
    }
  }
  if (!plain) {
    plain = await readLegacyPassword(trimmed);
  }
  if (!plain) return null;

  passwordMemoryCache.set(trimmed, plain);
  try {
    await storeData(key, { address: trimmed, password: plain });
    await purgePlaintextPasswordCopies(trimmed);
  } catch {
    /* keep the plaintext copy until the secure write succeeds */
  }
  return plain;
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

  // SecureStorage only — never write the password to Preferences or
  // localStorage in plaintext. (The Keystore CryptoObject copy is also
  // skipped: that path is disabled and its write blocks the Capacitor
  // plugin thread for ~10s on some devices.)
  await storeData(key, { address: trimmed, password });
  passwordMemoryCache.set(trimmed, password);
  await purgePlaintextPasswordCopies(trimmed);

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

  passwordMemoryCache.delete(trimmed);

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
    await removeData(key);
  } catch {
    /* ignore */
  }

  try {
    await deleteQortalBiometricSecret(trimmed);
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

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  if (!isCapacitor()) return false;
  return isQortalBiometricHardwareAvailable();
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

export async function disableBiometricUnlock(address: string): Promise<void> {
  if (!isCapacitor()) return;

  const trimmed = normalizeAddress(address);
  await deleteStoredPassword(trimmed);

  const enabled = await loadEnabledSet();
  enabled.delete(trimmed);
  await saveEnabledSet(enabled);

  if (enabled.size === 0) {
    // Last biometric wallet removed: drop the persisted storage key so the
    // device reverts to ephemeral, session-only storage encryption.
    await discardPersistedStorageKey().catch(() => {});
  }
}

export async function prewarmBiometricUnlockKdf(
  address: string,
  wallet: Record<string, unknown>
): Promise<void> {
  const trimmed = normalizeAddress(address);
  if (!trimmed) return;

  // The KDF is skipped entirely on resume-unlocks; don't burn several
  // CPU-seconds prewarming it while the unlock screen is animating.
  if (await canResumeWalletSession(trimmed).catch(() => false)) return;

  await syncBiometricPasswordCache([trimmed]);

  const password =
    readStoredPasswordSync(trimmed) ?? (await readStoredPassword(trimmed));
  if (!password) return;

  await precomputeWalletKdfKey(password, wallet, 'prewarm').catch(() => {
    /* retry on unlock if prewarm fails */
  });
}

/** Warm the in-memory password cache from SecureStorage (also migrates and purges any legacy plaintext copies). */
export async function syncBiometricPasswordCache(
  addresses: string[]
): Promise<void> {
  if (!isCapacitor()) return;

  await Promise.all(
    addresses.map(async (address) => {
      const trimmed = normalizeAddress(address);
      if (!trimmed || passwordMemoryCache.has(trimmed)) return;
      await readStoredPassword(trimmed).catch(() => null);
    })
  );
}

export async function warmUpBiometricHardware(): Promise<void> {
  if (!isCapacitor()) return;
  await warmUpQortalBiometric();
}

/** Sync the native launch-prompt flag with the enabled set (call at boot). */
export function syncBiometricAutoPromptFlag(): void {
  if (!isCapacitor()) return;
  // The launch-time prompt flag is owned by the Enter Qortal list, which arms it
  // only for the TOP wallet (the account auto-opened on reopen) via
  // updateEarlyBiometricPromptForTopWallet. Nothing to set here.

  // One-time scrub: builds before the SecureStorage migration wrote plaintext
  // passwords to localStorage; even after removal the bytes linger in the
  // leveldb log until it rotates. Churn it once.
  try {
    if (!localStorage.getItem('__pwd_scrub_done')) {
      localStorage.setItem('__pwd_scrub_done', '1');
      scheduleLocalStorageChurn();
    }
  } catch {
    /* ignore */
  }
}

/** True if the launch-time prompt was explicitly cancelled this start (the auto-prompt should not immediately re-prompt). */
export async function wasEarlyBiometricPromptCancelled(): Promise<boolean> {
  if (!isCapacitor()) return false;
  return (await getQortalBiometricEarlyPromptState()) === 'cancelled';
}

let cachedSessionProbe: {
  address: string;
  canResume: boolean;
  checkedAt: number;
} | null = null;

export async function canResumeWalletSession(
  address: string
): Promise<boolean> {
  const trimmed = normalizeAddress(address);
  if (!trimmed || !isCapacitor()) return false;

  if (isWalletUnlockedInSession(trimmed)) {
    return true;
  }

  const now = Date.now();
  if (
    cachedSessionProbe &&
    cachedSessionProbe.address === trimmed &&
    now - cachedSessionProbe.checkedAt < 15_000
  ) {
    return cachedSessionProbe.canResume;
  }

  try {
    const response = (await window.sendMessage('tryResumeWalletSession', {
      address: trimmed,
    })) as { ok?: boolean } | null;
    const canResume = Boolean(response?.ok);
    cachedSessionProbe = { address: trimmed, canResume, checkedAt: now };
    if (canResume) {
      markWalletUnlockedInSession(trimmed);
    }
    return canResume;
  } catch {
    return false;
  }
}

export function prefetchWalletSessionProbe(address: string): void {
  void canResumeWalletSession(normalizeAddress(address));
}

/** Biometric gate; skips password/KDF when an in-storage session can resume. */
export async function biometricUnlockWallet(
  address: string,
  wallet?: Record<string, unknown>
): Promise<'resume' | string> {
  if (!isCapacitor()) {
    throw new Error('Biometric unlock is only available on the mobile app.');
  }

  const trimmed = normalizeAddress(address);
  const started = performance.now();
  let scanMs: number | null = null;
  let kdfMs: number | null = null;
  const sessionPromise = canResumeWalletSession(trimmed);
  const verifyPromise = verifyBiometricUnlock().then(() => {
    scanMs = performance.now() - started;
  });
  // Probe is a local storage check (~ms). Skip the 16-round KDF entirely on
  // resume-unlocks; otherwise it runs during the fingerprint scan.
  const kdfDuringScan = wallet
    ? sessionPromise.then(async (resume) => {
        if (resume) return;
        await syncBiometricPasswordCache([trimmed]);
        const syncPassword = readBiometricUnlockPasswordSync(trimmed);
        const password = syncPassword ?? (await readStoredPassword(trimmed));
        if (password) {
          const kdfStarted = performance.now();
          await precomputeWalletKdfKey(password, wallet, 'scan').catch(
            () => {}
          );
          kdfMs = performance.now() - kdfStarted;
        }
      })
    : Promise.resolve();

  const [, canResume] = await Promise.all([
    verifyPromise,
    sessionPromise,
    kdfDuringScan,
  ]);

  const scan = `scan ${Math.round(scanMs ?? -1)} ms`;
  recordUnlockTiming(
    'fingerprint',
    performance.now() - started,
    canResume
      ? `resumed session, no KDF, ${scan}`
      : kdfMs != null
        ? `${scan}, KDF wait ${Math.round(kdfMs)} ms`
        : `${scan}, no KDF during scan`
  );

  if (canResume) {
    return 'resume';
  }

  const syncPassword = readBiometricUnlockPasswordSync(trimmed);
  const password = syncPassword ?? (await readBiometricUnlockPassword(trimmed));

  return password;
}

export function readBiometricUnlockPasswordSync(
  address: string
): string | null {
  return readStoredPasswordSync(normalizeAddress(address));
}

export async function readBiometricUnlockPassword(
  address: string
): Promise<string> {
  const trimmed = normalizeAddress(address);
  const password =
    readStoredPasswordSync(trimmed) ?? (await readStoredPassword(trimmed));
  if (!password) {
    throw new Error('Fingerprint unlock is not set up for this account.');
  }
  return password;
}

/** Fired right before the native biometric prompt opens. */
export const BIOMETRIC_VERIFY_START_EVENT = 'qortal-biometric-verify-start';

export async function verifyBiometricUnlock(): Promise<void> {
  // Active media playback delays Vivo's under-display fingerprint overlay by
  // up to the clip length (it's a competing video surface). Tell the UI to
  // stop the startup sound before the sensor is armed.
  try {
    window.dispatchEvent(new CustomEvent(BIOMETRIC_VERIFY_START_EVENT));
  } catch {
    /* ignore */
  }

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
