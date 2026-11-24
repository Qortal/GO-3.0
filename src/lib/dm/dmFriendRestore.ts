/**
 * DM friends live in this device's storage only (dmFriendsByAccountAtom).
 * Adding a friend also publishes a signed `dm_friend_added` event into the
 * DM, and removing one publishes a signed `delete` of that event. Those events
 * are part of the account's DM history, which every device of the account
 * syncs. So on a device where the account signed in later (a new phone, or GO
 * next to the desktop Hub where the friend was added), the friend list can be
 * rebuilt from the account's OWN events.
 *
 * Only events whose sender is the account itself count: the chat engine
 * stores a DM event only after checking its signature and that the sender
 * address belongs to the signing key (acceptDirectEvent →
 * verifyReticulumDmEvent), so nobody else can make a device believe the
 * account added them. The peer's own "added you" event never counts.
 *
 * The latest own action wins: an add that is later deleted, or followed by a
 * delete of any own add for that peer, means "not a friend".
 */
import { publicKeyBelongsToAddress } from '../../encryption/addressKeyCheck';

/** The fields of a stored DM event this module reads (ReticulumDmEvent). */
export type DmFriendHistoryEvent = {
  eventId?: string;
  senderAddress?: string;
  recipientAddress?: string;
  senderPublicKey?: string;
  eventType?: string;
  targetEventId?: string;
  timestamp?: number;
  payload?: string;
};

export type RestoredDmFriend = {
  /** The peer's public key when the history proves it, else ''. */
  publicKey: string;
  name?: string;
  addedAt: number;
  eventId: string;
};

/** Enough for most DMs; friend events are rare and never expire. */
export const DM_FRIEND_RESTORE_HISTORY_LIMIT = 1000;

const parseOtherData = (payload: unknown): Record<string, unknown> | null => {
  if (typeof payload !== 'string' || !payload) return null;
  try {
    const parsed = JSON.parse(payload);
    const otherData = parsed?.otherData;
    return otherData &&
      typeof otherData === 'object' &&
      !Array.isArray(otherData)
      ? (otherData as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Whether `myAddress` has `peerAddress` as a DM friend according to its own
 * signed events in this DM's history. Returns the friend entry to store, or
 * null (no own add, or the latest own action removed the friend).
 */
export function dmFriendFromHistory(
  events: readonly unknown[],
  myAddress: string,
  peerAddress: string
): RestoredDmFriend | null {
  const me = str(myAddress);
  const peer = str(peerAddress);
  if (!me || !peer || me === peer || !Array.isArray(events)) return null;

  type Add = {
    eventId: string;
    timestamp: number;
    name?: string;
  };
  const adds = new Map<string, Add>();
  const deletes: Array<{ target: string; timestamp: number }> = [];
  let peerPublicKey = '';

  for (const raw of events) {
    const event = raw as DmFriendHistoryEvent;
    if (!event || typeof event !== 'object') continue;
    const sender = str(event.senderAddress);
    const recipient = str(event.recipientAddress);
    const timestamp = Number(event.timestamp) || 0;
    if (sender === peer && recipient === me) {
      const key = str(event.senderPublicKey);
      if (!peerPublicKey && key && publicKeyBelongsToAddress(key, peer)) {
        peerPublicKey = key;
      }
      continue;
    }
    if (sender !== me || recipient !== peer) continue;
    const eventType = str(event.eventType);
    if (eventType === 'delete') {
      const target = str(event.targetEventId);
      if (target) deletes.push({ target, timestamp });
      continue;
    }
    if (eventType !== 'message') continue;
    const eventId = str(event.eventId);
    if (!eventId) continue;
    const otherData = parseOtherData(event.payload);
    if (!otherData || otherData.type !== 'dm_friend_added') continue;
    const friendEvent = otherData.dmFriendEvent as
      | Record<string, unknown>
      | undefined;
    if (
      !friendEvent ||
      str(friendEvent.actorAddress) !== me ||
      str(friendEvent.targetAddress) !== peer
    ) {
      continue;
    }
    const name = str(friendEvent.targetName);
    adds.set(eventId, {
      eventId,
      timestamp,
      ...(name && name !== peer ? { name } : {}),
    });
  }
  if (adds.size === 0) return null;

  let latestAdd: Add | null = null;
  for (const add of adds.values()) {
    if (deletes.some((d) => d.target === add.eventId)) continue;
    if (
      !latestAdd ||
      add.timestamp > latestAdd.timestamp ||
      (add.timestamp === latestAdd.timestamp &&
        add.eventId.localeCompare(latestAdd.eventId) > 0)
    ) {
      latestAdd = add;
    }
  }
  if (!latestAdd) return null;
  // A removal deletes one add event. If an own add was deleted after the
  // newest surviving add, the friend was removed (an older duplicate add
  // survived only because removal targets one event).
  const latestRemoval = deletes
    .filter((d) => adds.has(d.target))
    .reduce((max, d) => Math.max(max, d.timestamp), -Infinity);
  if (latestRemoval >= latestAdd.timestamp) return null;

  return {
    publicKey: peerPublicKey,
    ...(latestAdd.name ? { name: latestAdd.name } : {}),
    addedAt: latestAdd.timestamp || Date.now(),
    eventId: latestAdd.eventId,
  };
}

type DirectHistoryReader = (
  myAddress: string,
  peerAddress: string,
  limit?: number
) => Promise<unknown[]> | unknown[] | undefined;

type OwnFriendEventsReader = (
  myAddress: string,
  peerAddress: string
) => Promise<unknown[]> | unknown[] | undefined;

type ChatEngine = {
  getDirectHistory?: DirectHistoryReader;
  getOwnDirectFriendEvents?: OwnFriendEventsReader;
};

const chatEngine = (): ChatEngine | undefined =>
  (globalThis as { reticulumChat?: unknown }).reticulumChat as
    | ChatEngine
    | undefined;

const defaultHistoryReader = (): DirectHistoryReader | null => {
  const chat = chatEngine();
  return typeof chat?.getDirectHistory === 'function'
    ? chat.getDirectHistory.bind(chat)
    : null;
};

/** GO engine: own friend events however old (newest-N history misses them). */
const defaultOwnFriendEventsReader = (): OwnFriendEventsReader | null => {
  const chat = chatEngine();
  return typeof chat?.getOwnDirectFriendEvents === 'function'
    ? chat.getOwnDirectFriendEvents.bind(chat)
    : null;
};

const withTimeout = async <T>(
  value: Promise<T> | T,
  timeoutMs: number
): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Reads the DM history with `peerAddress` and rebuilds the friend entry from
 * the account's own events. Never throws; null when unknown.
 */
export async function restoreDmFriendFromHistory(
  myAddress: string,
  peerAddress: string,
  options: {
    getDirectHistory?: DirectHistoryReader | null;
    /** The account's own friend events in this DM, however old. */
    getOwnFriendEvents?: OwnFriendEventsReader | null;
    /**
     * Fallback for the peer's public key when no peer event in the history
     * proves it (e.g. the Qortal node's /addresses/publickey). The key is
     * kept only if it belongs to the peer's address.
     */
    lookupPublicKey?: (address: string) => Promise<unknown>;
    limit?: number;
    timeoutMs?: number;
  } = {}
): Promise<RestoredDmFriend | null> {
  const reader =
    options.getDirectHistory === undefined
      ? defaultHistoryReader()
      : options.getDirectHistory;
  const ownReader =
    options.getOwnFriendEvents === undefined
      ? defaultOwnFriendEventsReader()
      : options.getOwnFriendEvents;
  if ((!reader && !ownReader) || !myAddress || !peerAddress) return null;
  const timeoutMs = options.timeoutMs ?? 4_000;
  try {
    const [history, own] = await Promise.all([
      reader
        ? withTimeout(
            reader(
              myAddress,
              peerAddress,
              options.limit ?? DM_FRIEND_RESTORE_HISTORY_LIMIT
            ),
            timeoutMs
          ).catch(() => null)
        : null,
      ownReader
        ? withTimeout(ownReader(myAddress, peerAddress), timeoutMs).catch(
            () => null
          )
        : null,
    ]);
    const events: unknown[] = [];
    const seen = new Set<string>();
    for (const list of [own, history]) {
      if (!Array.isArray(list)) continue;
      for (const event of list) {
        const id = str((event as DmFriendHistoryEvent)?.eventId);
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        events.push(event);
      }
    }
    if (events.length === 0) return null;
    const restored = dmFriendFromHistory(events, myAddress, peerAddress);
    if (restored && !restored.publicKey && options.lookupPublicKey) {
      restored.publicKey = await lookupPeerPublicKey(
        options.lookupPublicKey,
        peerAddress,
        timeoutMs
      );
    }
    return restored;
  } catch {
    return null;
  }
}

async function lookupPeerPublicKey(
  lookup: (address: string) => Promise<unknown>,
  peerAddress: string,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const key = await Promise.race([
      Promise.resolve(lookup(peerAddress)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    const value = str(key);
    return value && publicKeyBelongsToAddress(value, peerAddress) ? value : '';
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The peer whose stored friend entry an accepted own `delete` removes: the
 * account removed this friend on another device (it deleted the very add
 * event this entry came from). Null otherwise.
 */
export function ownFriendRemovalPeer(
  event: unknown,
  myAddress: string,
  friends: Record<string, { eventId?: string } | undefined>
): string | null {
  const e = event as DmFriendHistoryEvent;
  if (!e || typeof e !== 'object' || str(e.eventType) !== 'delete') {
    return null;
  }
  const me = str(myAddress);
  if (!me || str(e.senderAddress) !== me) return null;
  const peer = str(e.recipientAddress);
  const target = str(e.targetEventId);
  if (!peer || peer === me || !target) return null;
  const entryEventId = str(friends?.[peer]?.eventId);
  return entryEventId && entryEventId === target ? peer : null;
}

/**
 * Whether the account deleted (removed) the friend add `eventId` with
 * `peerAddress`, per its own events. Unknown is false.
 */
export async function isOwnFriendAddDeleted(
  myAddress: string,
  peerAddress: string,
  eventId: string,
  options: { getOwnFriendEvents?: OwnFriendEventsReader | null } = {}
): Promise<boolean> {
  const reader =
    options.getOwnFriendEvents === undefined
      ? defaultOwnFriendEventsReader()
      : options.getOwnFriendEvents;
  if (!reader || !eventId) return false;
  const events = await withTimeout(reader(myAddress, peerAddress), 4_000).catch(
    () => null
  );
  if (!Array.isArray(events)) return false;
  return events.some(
    (raw) =>
      ownFriendRemovalPeer(raw, myAddress, { [peerAddress]: { eventId } }) ===
      peerAddress
  );
}
