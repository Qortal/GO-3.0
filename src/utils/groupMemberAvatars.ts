import {
  getArbitraryEndpointReact,
  getBaseApiReactForAvatar,
} from './globalApi';
import { RequestQueueWithPromise } from './queue/queue';

/**
 * Efficient avatar loading for long member/admin lists.
 *
 * Loading a per-user avatar image blindly is expensive: every user WITHOUT a
 * published avatar costs a failed request plus retries. For a list of hundreds
 * of members that is a request storm.
 *
 * Instead we first ask the node — in batches of many names per request — which
 * names actually have a `qortal_avatar` THUMBNAIL published. Only those users
 * then load an image (through the device avatar cache, src/lib/qdnAvatars);
 * everyone else renders an instant local fallback with no network at all.
 * Results are cached process-wide so re-opening a group (or seeing the same
 * user elsewhere) is free.
 */

// nameLower -> true/false (has avatar). Absent = not yet resolved.
const avatarPresenceCache = new Map<string, boolean>();
// Names currently being resolved, so overlapping calls don't double-fetch.
const inFlight = new Set<string>();

// A few names-search requests in parallel; each request covers many names.
const detectionQueue = new RequestQueueWithPromise(3);
const BATCH_SIZE = 40;

const normalize = (name?: string | null): string =>
  (name ?? '').trim().toLowerCase();

/**
 * What the node said about this name: true (has an avatar), false (has
 * none) or undefined (not asked yet, or the lookup failed).
 */
export function getAvatarPresence(name?: string | null): boolean | undefined {
  const key = normalize(name);
  return key ? avatarPresenceCache.get(key) : undefined;
}

async function resolveBatch(names: string[]): Promise<void> {
  const query = names.map((n) => `name=${encodeURIComponent(n)}`).join('&');
  const url =
    `${getBaseApiReactForAvatar()}${getArbitraryEndpointReact()}` +
    `?mode=ALL&service=THUMBNAIL&identifier=qortal_avatar` +
    `&exactmatchnames=true&limit=0&includemetadata=false&${query}`;

  let ok = false;
  const found = new Set<string>();
  try {
    const response = await fetch(url);
    if (response.ok) {
      ok = true;
      const data = await response.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          const itemName = normalize(
            typeof item?.name === 'string' ? item.name : ''
          );
          if (itemName) found.add(itemName);
        }
      }
    }
  } catch {
    // Network/parse failure — leave these names unresolved so a later call can
    // retry, rather than falsely marking everyone as avatar-less.
  }

  for (const n of names) {
    const key = normalize(n);
    inFlight.delete(key);
    if (ok) avatarPresenceCache.set(key, found.has(key));
  }
}

/**
 * Make sure avatar presence is known for every given name. Unknown names are
 * de-duplicated, batched and resolved through a concurrency-limited queue.
 * `onBatchResolved` fires after each batch so callers can re-render as results
 * stream in. Safe (and cheap) to call repeatedly with overlapping lists.
 */
export function ensureAvatarPresence(
  names: (string | null | undefined)[],
  onBatchResolved?: () => void
): void {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = normalize(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (avatarPresenceCache.has(key) || inFlight.has(key)) continue;
    inFlight.add(key);
    pending.push((raw as string).trim());
  }
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    void detectionQueue
      .enqueue(() => resolveBatch(batch))
      .then(() => onBatchResolved?.())
      .catch(() => {
        for (const n of batch) inFlight.delete(normalize(n));
      });
  }
}
