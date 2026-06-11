import { SecureStoragePlugin } from '@evva/capacitor-secure-storage-plugin';
import { Preferences } from '@capacitor/preferences';

let inMemoryKey: CryptoKey | null = null;
let keyInitPromise: Promise<void> | null = null;

const keysToEncrypt = ['keyPair'];
const PERSISTED_STORAGE_KEY = 'storageSessionAesKey';
// Mirrors ENABLED_LS_KEY in walletBiometricAuth (not imported: circular dep).
const BIOMETRIC_ENABLED_LS_KEY = 'walletBiometricEnabledAddresses';

/**
 * Envelope ("vault") encryption for all stored data.
 *
 * The SecureStorage plugin RSA-decrypts every value in the hardware keystore
 * 256 bytes at a time; large values (wallet list, avatar map) take hundreds
 * of sequential TEE round-trips — ~10s on some devices, on EVERY cold start.
 *
 * Instead we keep a single 32-byte AES-256 vault key in SecureStorage (one
 * RSA block — milliseconds) and encrypt the actual payloads with AES-GCM in
 * JS, storing the ciphertext in plain Preferences. Same hardware-backed
 * protection at rest, without the per-value TEE cost. Legacy values are
 * migrated off SecureStorage lazily on first read.
 */
const VAULT_KEY_STORAGE_KEY = 'storageVaultKey';
const VAULT_PREFIX = 'vault_';

let vaultKey: CryptoKey | null = null;
let vaultKeyInitPromise: Promise<void> | null = null;

async function initializeVaultKey(): Promise<void> {
  if (vaultKey) return;
  if (!vaultKeyInitPromise) {
    vaultKeyInitPromise = (async () => {
      try {
        const stored = await SecureStoragePlugin.get({
          key: VAULT_KEY_STORAGE_KEY,
        });
        if (stored?.value) {
          vaultKey = await crypto.subtle.importKey(
            'raw',
            base64ToBytes(stored.value) as BufferSource,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
          );
          return;
        }
      } catch {
        /* no vault key yet */
      }

      const generated = await generateKey();
      try {
        const raw = await crypto.subtle.exportKey('raw', generated);
        await SecureStoragePlugin.set({
          key: VAULT_KEY_STORAGE_KEY,
          value: bytesToBase64(new Uint8Array(raw)),
        });
        vaultKey = generated;
      } catch {
        // Without a persistable vault key, leave vaultKey null: data keeps
        // using the legacy SecureStorage path so nothing becomes unreadable.
        vaultKey = null;
      }
    })();
    vaultKeyInitPromise.catch(() => {
      vaultKeyInitPromise = null;
    });
  }
  await vaultKeyInitPromise;
}

async function vaultEncrypt(plaintext: string): Promise<string | null> {
  if (!vaultKey) return null;
  try {
    const { iv, encryptedData } = await encryptData(plaintext, vaultKey);
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);
    return bytesToBase64(combined);
  } catch {
    return null;
  }
}

async function vaultDecrypt(payload: string): Promise<string | null> {
  if (!vaultKey) return null;
  try {
    const combined = base64ToBytes(payload);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12).buffer;
    return await decryptData(encrypted, vaultKey, iv);
  } catch {
    return null;
  }
}

/**
 * Persist the storage AES key only for biometric-unlock users. Their wallet
 * password is already stored on-device for the fingerprint flow, so keeping
 * the storage key adds no new exposure — and it lets `tryResumeWalletSession`
 * succeed across cold starts, skipping the ~10s PhraseWallet re-derivation
 * after a fingerprint scan. Password-only users keep the ephemeral key (their
 * stored session becomes unreadable once the app process dies).
 */
function shouldPersistStorageKey(): boolean {
  try {
    const raw = localStorage.getItem(BIOMETRIC_ENABLED_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function initializeKeyAndIV() {
  if (inMemoryKey) return;
  if (!keyInitPromise) {
    keyInitPromise = (async () => {
      const persist = shouldPersistStorageKey();

      if (persist) {
        try {
          const stored = await SecureStoragePlugin.get({
            key: PERSISTED_STORAGE_KEY,
          });
          if (stored?.value) {
            inMemoryKey = await crypto.subtle.importKey(
              'raw',
              base64ToBytes(stored.value) as BufferSource,
              { name: 'AES-GCM' },
              true,
              ['encrypt', 'decrypt']
            );
            return;
          }
        } catch {
          /* no persisted key yet */
        }
      }

      inMemoryKey = await generateKey();

      if (persist) {
        try {
          const raw = await crypto.subtle.exportKey('raw', inMemoryKey);
          await SecureStoragePlugin.set({
            key: PERSISTED_STORAGE_KEY,
            value: bytesToBase64(new Uint8Array(raw)),
          });
        } catch {
          /* fall back to session-only key */
        }
      }
    })();
    keyInitPromise.catch(() => {
      keyInitPromise = null;
    });
  }
  await keyInitPromise;
}

/** Drop the persisted storage key (logout / biometric disabled). */
export async function discardPersistedStorageKey(): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key: PERSISTED_STORAGE_KEY });
  } catch {
    /* not present */
  }
}

/**
 * Persist the current storage key immediately (called when biometric unlock
 * is first enabled, so data written earlier this session stays readable on
 * the next cold start without waiting for a slow self-healing re-encrypt).
 */
export async function persistStorageKeyNow(): Promise<void> {
  await initializeKeyAndIV();
  if (!inMemoryKey) return;
  try {
    const raw = await crypto.subtle.exportKey('raw', inMemoryKey);
    await SecureStoragePlugin.set({
      key: PERSISTED_STORAGE_KEY,
      value: bytesToBase64(new Uint8Array(raw)),
    });
  } catch {
    /* session-only fallback */
  }
}

async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(
  data: string,
  key: CryptoKey
): Promise<{ iv: Uint8Array; encryptedData: ArrayBuffer }> {
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  // Generate a random IV each time you encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encryptedData = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encodedData
  );

  return { iv, encryptedData };
}

async function decryptData(
  encryptedData: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<string> {
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

// Encode a JSON payload as Base64
function jsonToBase64(payload) {
  const utf8Array = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  utf8Array.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

// Decode a Base64 string back to JSON
function base64ToJson(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Write-through in-memory cache for hot keys.
 *
 * Every SecureStoragePlugin call crosses the native bridge and hits encrypted
 * preferences; profiling showed the same keys re-read constantly (walletInfo
 * 76x, apiKey 38x, userSettings 27x in a few minutes). All app writes go
 * through storeData/removeKeysAndLogout in this module, so a write-through
 * cache stays coherent.
 */
const HOT_KEY_EXACT = new Set([
  'walletInfo',
  'apiKey',
  'keyPair',
  'customNodes',
  'qortalRequestPermissions',
  'walletAvatarByAddress',
  'wallets',
  'active-groups-directs',
]);
const HOT_KEY_PATTERNS = [
  /-userSettings$/,
  /^enter-chat-timestamp-/,
  /^group-announcement-/,
  /^chatheads-/,
  /^threadactivity-/,
];

const isHotKey = (key: string): boolean =>
  HOT_KEY_EXACT.has(key) || HOT_KEY_PATTERNS.some((re) => re.test(key));

const memoryCache = new Map<string, unknown>();

export const invalidateStorageCache = (key?: string): void => {
  if (key === undefined) {
    memoryCache.clear();
  } else {
    memoryCache.delete(key);
  }
};

/** Apply the extra per-session AES layer for keys like keyPair. */
async function encodePayload(key: string, payload: any): Promise<string> {
  const base64Data = jsonToBase64(payload);
  if (keysToEncrypt.includes(key) && inMemoryKey) {
    const { iv, encryptedData } = await encryptData(base64Data, inMemoryKey);
    const combinedData = new Uint8Array([
      ...iv,
      ...new Uint8Array(encryptedData),
    ]);
    return btoa(String.fromCharCode(...combinedData));
  }
  return base64Data;
}

/** Reverse encodePayload. Returns null if undecodable (e.g. lost session key). */
async function decodePayload(key: string, value: string): Promise<any | null> {
  try {
    if (keysToEncrypt.includes(key) && inMemoryKey) {
      const combinedData = atob(value)
        .split('')
        .map((c) => c.charCodeAt(0));
      const iv = new Uint8Array(combinedData.slice(0, 12));
      const encryptedData = new Uint8Array(combinedData.slice(12)).buffer;
      const decryptedBase64Data = await decryptData(
        encryptedData,
        inMemoryKey,
        iv
      );
      return base64ToJson(decryptedBase64Data);
    }
    return base64ToJson(value);
  } catch {
    return null;
  }
}

export const storeData = async (key: string, payload: any): Promise<string> => {
  await initializeKeyAndIV();
  await initializeVaultKey();

  if (isHotKey(key)) {
    memoryCache.set(key, payload);
  }

  const encoded = await encodePayload(key, payload);

  const vaultValue = await vaultEncrypt(encoded);
  if (vaultValue !== null) {
    await Preferences.set({ key: VAULT_PREFIX + key, value: vaultValue });
    // Drop any legacy copy so the slow RSA path never runs for this key again.
    void SecureStoragePlugin.remove({ key }).catch(() => {});
  } else {
    // Vault unavailable: legacy slow-but-safe path.
    await SecureStoragePlugin.set({ key, value: encoded });
  }

  return 'Data saved successfully';
};

export const getData = async <T = any>(key: string): Promise<T | null> => {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }

  await initializeKeyAndIV();
  await initializeVaultKey();

  // Fast path: AES vault in Preferences.
  try {
    const { value } = await Preferences.get({ key: VAULT_PREFIX + key });
    if (value) {
      const decoded = await vaultDecrypt(value);
      if (decoded !== null) {
        const parsed = await decodePayload(key, decoded);
        if (parsed !== null) {
          if (isHotKey(key)) memoryCache.set(key, parsed);
          return parsed;
        }
      }
    }
  } catch {
    /* fall through to legacy */
  }

  // Legacy path: value still lives in SecureStorage (slow RSA). Read once,
  // migrate into the vault so future cold starts skip the TEE round-trips.
  try {
    const storedDataBase64 = await SecureStoragePlugin.get({ key });
    if (!storedDataBase64.value) return null;

    const parsed = await decodePayload(key, storedDataBase64.value);
    if (parsed === null) return null;

    if (isHotKey(key)) memoryCache.set(key, parsed);

    const vaultValue = await vaultEncrypt(storedDataBase64.value);
    if (vaultValue !== null) {
      try {
        await Preferences.set({ key: VAULT_PREFIX + key, value: vaultValue });
        await SecureStoragePlugin.remove({ key });
      } catch {
        /* keep legacy copy until migration succeeds */
      }
    }
    return parsed;
  } catch (error) {
    return null;
  }
};

/** Remove a stored value from the vault, legacy storage and memory cache. */
export const removeData = async (key: string): Promise<void> => {
  memoryCache.delete(key);
  try {
    await Preferences.remove({ key: VAULT_PREFIX + key });
  } catch {
    /* ignore */
  }
  try {
    await SecureStoragePlugin.remove({ key });
  } catch {
    /* ignore */
  }
};

// Remove keys from storage and log out
export async function removeKeysAndLogout(
  keys: string[],
  event: MessageEvent,
  request: any
) {
  try {
    invalidateStorageCache();
    for (const key of keys) {
      try {
        await Preferences.remove({ key: VAULT_PREFIX + key });
        await SecureStoragePlugin.remove({ key });
        await SecureStoragePlugin.remove({ key: `${key}_iv` }); // Remove associated IV
      } catch (error) {
        console.warn(`Key not found: ${key}`);
      }
    }

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'logout',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    console.error('Error removing keys:', error);
  }
}
