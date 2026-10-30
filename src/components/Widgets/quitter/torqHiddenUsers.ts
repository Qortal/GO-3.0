/**
 * Torq's "Hidden users" for the Home feed.
 *
 * Torq keeps the list in its own storage, which GO cannot read: Q-Apps run on
 * the node's origin. Torq's Settings → "Save to QDN" also publishes it in a
 * public settings DOCUMENT under the user's name (Torq's settingsQdn.ts), and
 * that copy is what the Home feed honours.
 */
import { getBaseApiReact } from '../../../utils/globalApi';
import { quitterHashWord } from './quitterIdentity';

const CACHE_TTL_MS = 5 * 60 * 1000;
/** After a timeout or a node error, try again this much later. */
const RETRY_AFTER_MS = 60 * 1000;
/** The feed must not wait long on a node that is still fetching the file. */
const FETCH_TIMEOUT_MS = 6_000;

const cache = new Map<string, { expiresAt: number; names: string[] }>();

/** Torq's normalizeHiddenUser: trimmed, no leading @, single spaces. */
const normalizeHiddenUser = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ');

/** Comparison key, as Torq's isHiddenUser compares names. */
export const hiddenUserKey = (value: string): string =>
  normalizeHiddenUser(value).toLowerCase();

/** qapp-core hashString('settings', HIGH) with Quitter's salt, as Torq builds it. */
export const torqSettingsIdentifier = (): Promise<string> =>
  quitterHashWord('settings', 14);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function decodeJson(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    // The node may hand back the published base64.
  }
  try {
    const bytes = Uint8Array.from(atob(value.trim()), (c) => c.charCodeAt(0));
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** The hidden names in a Torq settings document (any shape Torq accepts). */
export function parseTorqHiddenUsers(payload: unknown): string[] {
  const record = decodeJson(payload);
  if (!record) return [];
  const candidates = [record];
  const nested = decodeJson(record.data);
  if (nested) candidates.push(nested);
  const settings = candidates.find((item) => Array.isArray(item.hiddenUsers));
  if (!settings) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of settings.hiddenUsers as unknown[]) {
    if (typeof raw !== 'string') continue;
    const name = normalizeHiddenUser(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The names this account hides in Torq. Never throws: with no saved settings,
 * an unreachable node or a timeout it returns the last known list, else [].
 */
export async function fetchTorqHiddenUsers(
  userName: string,
  options: { signal?: AbortSignal; force?: boolean } = {}
): Promise<string[]> {
  const name = userName.trim();
  if (!name) return [];
  const cached = cache.get(name);
  if (cached && !options.force && Date.now() < cached.expiresAt) {
    return cached.names;
  }
  const remember = (names: string[], ttl: number) => {
    cache.set(name, { expiresAt: Date.now() + ttl, names });
    return names;
  };

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  try {
    const identifier = await torqSettingsIdentifier();
    const response = await fetch(
      `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
      { cache: 'no-store', signal: controller.signal }
    );
    if (response.ok) {
      return remember(
        parseTorqHiddenUsers(await response.text()),
        CACHE_TTL_MS
      );
    }
    // 4xx: this account never saved its Torq settings to QDN.
    if (response.status >= 400 && response.status < 500) {
      return remember([], CACHE_TTL_MS);
    }
    return remember(cached?.names ?? [], RETRY_AFTER_MS);
  } catch {
    // Timed out, cancelled or unreachable: keep what was known.
    if (options.signal?.aborted) return cached?.names ?? [];
    return remember(cached?.names ?? [], RETRY_AFTER_MS);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Test hook. */
export function resetTorqHiddenUsersCache(): void {
  cache.clear();
}
