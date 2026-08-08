/**
 * Engine host: runs inside the dedicated mobile chat worker AFTER the shims
 * (fs, sqlite, Buffer, process) are initialised by engine.worker.ts.
 *
 * Mirrors the desktop wiring in electron/src/setup.ts:
 *  - constructs the ReticulumResourceStore and ReticulumChatManager,
 *  - implements the 67 `reticulumChat:*` invoke handlers over the manager,
 *  - forwards the manager's events to the main thread (which fans them out to
 *    the preload-twin subscribers exactly like sendToRenderer did),
 *  - implements signing via RPC to the renderer's existing
 *    `signReticulumChatEvent` background case, and Qortal group member/admin
 *    validation via direct core API calls.
 */
import {
  startReticulumChatManager,
  stopReticulumChatManager,
  getReticulumChatManager,
} from '../../../electron/src/reticulum-chat';
import { ReticulumResourceStore } from '../../../electron/src/reticulum-resource-store';
import { MobileReticulumBridge } from './wireBridge';

type WorkerOut =
  | { t: 'evt'; channel: string; payload: unknown }
  | { t: 'rpcres'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'cmd'; id: number; action: string; payload: Record<string, unknown>; timeoutMs?: number }
  | { t: 'sign'; id: number; fields: Record<string, unknown> }
  | { t: 'engine-ready' }
  | { t: 'engine-failed'; error: string };

const post = (msg: WorkerOut) => {
  (self as unknown as Worker).postMessage(msg);
};

// ── main-thread RPC plumbing (commands + signing) ────────────────────────────

let nextOutId = 1;
const pendingOut = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();

function requestMain<T>(
  msg: Omit<Extract<WorkerOut, { t: 'cmd' }>, 'id'> | Omit<Extract<WorkerOut, { t: 'sign' }>, 'id'>,
  timeoutMs = 30_000
): Promise<T> {
  const id = nextOutId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOut.delete(id);
      reject(new Error(`worker->main request timed out: ${(msg as any).action ?? msg.t}`));
    }, timeoutMs);
    pendingOut.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    post({ ...(msg as any), id });
  });
}

const sendPythonCommand = (
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000
) =>
  requestMain<{ ok: boolean; error?: string; payload?: Record<string, any> }>(
    { t: 'cmd', action, payload, timeoutMs },
    timeoutMs + 5_000
  );

// ── environment fed from the main thread ─────────────────────────────────────

type EngineConfig = {
  apiBase: string;
  apiKey?: string;
};

let config: EngineConfig = { apiBase: '' };
let presencePeers: Array<Record<string, unknown>> = [];
let presenceLeases: Array<Record<string, unknown>> = [];
let overlayHealthy = false;

// ── Qortal group validation (port of setup.ts validateQortalGroupMember) ────

async function fetchCoreJson(path: string): Promise<unknown | null> {
  if (!config.apiBase) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url =
    config.apiBase.replace(/\/$/, '') +
    path +
    (config.apiKey ? `${sep}apiKey=${config.apiKey}` : '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function validateGroupMember(
  groupId: number,
  address: string
): Promise<boolean | null> {
  const normalized = address.trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalized) return false;
  const rows = await fetchCoreJson(
    `/groups/members/${groupId}?limit=0`
  );
  if (!rows || typeof rows !== 'object') return null;
  const members = Array.isArray((rows as any).members)
    ? (rows as any).members
    : [];
  return members.some(
    (m: any) => String(m?.member || '').trim() === normalized
  );
}

async function validateGroupAdmin(
  groupId: number,
  address: string
): Promise<boolean | null> {
  const normalized = address.trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalized) return false;
  const rows = await fetchCoreJson(
    `/groups/members/${groupId}?onlyAdmins=true&limit=0`
  );
  if (!rows || typeof rows !== 'object') return null;
  const members = Array.isArray((rows as any).members)
    ? (rows as any).members
    : [];
  return members.some(
    (m: any) => String(m?.member || '').trim() === normalized
  );
}

async function signLocalFields(fields: Record<string, unknown>): Promise<{
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
} | null> {
  try {
    const result = await requestMain<any>({ t: 'sign', fields }, 15_000);
    if (
      result &&
      typeof result.authorAddress === 'string' &&
      typeof result.authorPublicKey === 'string' &&
      typeof result.signature === 'string'
    ) {
      return result;
    }
  } catch (err) {
    console.warn('[MobileChat] control signing failed', err);
  }
  return null;
}

// ── engine lifecycle ─────────────────────────────────────────────────────────

let bridge: MobileReticulumBridge | null = null;
let resourceStore: ReticulumResourceStore | null = null;

const RETICULUM_CHAT_ONLINE_SINCE_MS = 5 * 60_000;

function readGroupState<T>(fallback: T, read: () => T): T {
  try {
    return read();
  } catch (err) {
    console.warn('[MobileChat] group state read failed', err);
    return fallback;
  }
}

export function startEngine(initial: EngineConfig): void {
  config = initial;
  bridge = new MobileReticulumBridge(sendPythonCommand);
  resourceStore = new ReticulumResourceStore();
  const manager = startReticulumChatManager(bridge as any, undefined, {
    signLocalFields,
    validateGroupMember,
    validateGroupAdmin,
    getVerifiedReticulumPeers: () => presencePeers as any,
    getAccountEndpointLeases: () => presenceLeases as any,
    hasGoodOverlayHealth: () => overlayHealthy,
    resourceStore,
  });
  attachManagerListeners(manager);
  post({ t: 'engine-ready' });
}

const MANAGER_EVENTS = [
  'event',
  'typing',
  'landState',
  'landChat',
  'landAction',
  'landCall',
  'summaryChanged',
  'directEvent',
  'directCallHistory',
  'directTyping',
  'directSummaryChanged',
  'resource',
  'silenceChanged',
  'calendarChanged',
  'calendarReminderDue',
] as const;

function attachManagerListeners(manager: any): void {
  for (const eventName of MANAGER_EVENTS) {
    manager.on(eventName, (payload: unknown) => {
      post({ t: 'evt', channel: `reticulumChat:${eventName}`, payload });
    });
  }
}

// ── invoke dispatcher (port of the 67 setup.ts ipc handlers) ─────────────────

type Handler = (...args: any[]) => unknown | Promise<unknown>;

const manager = () => getReticulumChatManager() as any;

const notRunning = { success: false, error: 'Reticulum chat manager is not running' };

const handlers: Record<string, Handler> = {
  isEnabled: () => true,
  setLocalGroupMemberships: (groupIds) => {
    const m = manager();
    if (!m) return notRunning;
    m.setLocalGroupMemberships(Array.isArray(groupIds) ? groupIds : []);
    return { success: true };
  },
  setPublicGroupDirectory: (groupIds) => {
    const m = manager();
    if (!m) return notRunning;
    m.setPublicGroupDirectory(Array.isArray(groupIds) ? groupIds : []);
    return { success: true };
  },
  getPublicGroupActivity: () =>
    manager()?.getPublicGroupActivitySummaries() ?? [],
  getPublicGroupActivitySnapshot: () =>
    manager()?.getPublicGroupActivitySnapshot() ?? {
      availableGroupIds: [],
      observedAt: Date.now(),
      summaries: [],
    },
  setLocalDmAddresses: (addresses) => {
    const m = manager();
    if (!m) return notRunning;
    m.setLocalDmAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
  },
  clearLocalAccountState: async () => {
    const m = manager();
    if (m) await m.clearLocalAccountState();
    return { success: true };
  },
  getSilence: (ownerAddress, targetAddress, scopeType, groupId) =>
    manager()?.getSilence(ownerAddress, targetAddress, scopeType, groupId) ??
    null,
  listSilences: (ownerAddress, scopeType, groupId) =>
    manager()?.listSilences(ownerAddress, scopeType, groupId) ?? [],
  setSilence: (ownerAddress, targetAddress, scopeType, durationMs, groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const silence = m.setSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        durationMs,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  clearSilence: (ownerAddress, targetAddress, scopeType, groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const silence = m.clearSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  setActiveDirectChat: (localAddress, peerAddress, active) => {
    const m = manager();
    if (!m) return notRunning;
    m.setActiveDirectChat(localAddress, peerAddress, active === true);
    return { success: true };
  },
  publishDirectEvent: async (event) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.publishDirectEvent(event);
    if (result.ok) return { success: true };
    return { success: false, error: result.error ?? result.reason };
  },
  getDirectAuthorStreamId: (authorAddress) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getDirectAuthorStreamId(authorAddress);
  },
  getDirectExpiryPreference: (ownerAddress, peerAddress) => {
    const m = manager();
    if (!m) return notRunning;
    return {
      success: true,
      preference: m.getDirectExpiryPreference(
        String(ownerAddress || '').trim(),
        String(peerAddress || '').trim()
      ),
    };
  },
  setDirectExpiryPreference: (ownerAddress, peerAddress, durationMs) => {
    const m = manager();
    if (!m) return notRunning;
    const preference = m.setDirectExpiryPreference(
      String(ownerAddress || '').trim(),
      String(peerAddress || '').trim(),
      durationMs == null ? null : Number(durationMs)
    );
    return preference
      ? { success: true, preference }
      : { success: false, error: 'Invalid DM expiry preference' };
  },
  getCalendarEvents: (groupId, rangeStart, rangeEnd) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarEvents(
      Number(groupId),
      Number(rangeStart),
      Number(rangeEnd)
    );
  },
  getCalendarEvent: (groupId, eventId, preferredOccurrenceStart) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarEvent(
      Number(groupId),
      String(eventId || ''),
      preferredOccurrenceStart == null
        ? undefined
        : Number(preferredOccurrenceStart)
    );
  },
  createCalendarEvent: (groupId, input, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.createCalendarEvent(Number(groupId), input, eventId);
  },
  updateCalendarEvent: (groupId, eventId, input) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.updateCalendarEvent(Number(groupId), String(eventId), input);
  },
  deleteCalendarEvent: (groupId, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.deleteCalendarEvent(Number(groupId), String(eventId));
  },
  getCalendarReminder: (ownerAddress, groupId, eventId) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.getCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || '')
    );
  },
  setCalendarReminder: (ownerAddress, groupId, eventId, offsetMs) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.setCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || ''),
      offsetMs == null ? null : Number(offsetMs)
    );
  },
  sendDirectTyping: async (localAddress, peerAddress, active) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.sendDirectTyping(
      localAddress,
      peerAddress,
      active === true
    );
    if (result.ok) return { success: true };
    return { success: false, error: result.error ?? result.reason };
  },
  getDirectHistory: (myAddress, peerAddress, limit) =>
    manager()?.getDirectHistory(myAddress, peerAddress, limit) ?? [],
  getDirectSummaries: (myAddress, peerAddress) => {
    const m = manager();
    if (!m) return [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    if (address) m.setLocalDmAddresses([address]);
    return m.getDirectSummaries(
      address,
      typeof peerAddress === 'string' ? peerAddress.trim() : undefined
    );
  },
  getDirectCallHistory: (ownerAddress, peerAddress, limit, unreadOnly) =>
    manager()?.getDirectCallHistory(
      String(ownerAddress || '').trim(),
      typeof peerAddress === 'string' ? peerAddress.trim() : undefined,
      Number(limit) || 100,
      unreadOnly === true
    ) ?? [],
  markDirectRead: (myAddress, peerAddress, upToTimestamp) => {
    const m = manager();
    if (!m) return notRunning;
    m.markDirectRead(myAddress, peerAddress, Number(upToTimestamp));
    return { success: true };
  },
  subscribeGroup: (groupId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      m.subscribeGroup(groupId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Reticulum chat subscribe failed',
      };
    }
  },
  subscribeChannel: (groupId, channelId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      m.subscribeChannel(groupId, channelId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum channel subscribe failed',
      };
    }
  },
  unsubscribeChannel: (groupId, channelId) => {
    const m = manager();
    if (!m) return notRunning;
    m.unsubscribeChannel(groupId, channelId);
    return { success: true };
  },
  unsubscribeGroup: (groupId) => {
    const m = manager();
    if (!m) return notRunning;
    m.unsubscribeGroup(groupId);
    return { success: true };
  },
  publishEvent: async (event) => {
    const m = manager();
    if (!m) return notRunning;
    const result = await m.publishEvent(event);
    if (result.ok) return { success: true };
    return { success: false, error: result.error ?? result.reason };
  },
  reserveAuthorSequence: async (groupId, authorAddress) => {
    const m = manager();
    if (!m) throw new Error('Reticulum chat manager is not running');
    return m.reserveAuthorSequence(groupId, authorAddress);
  },
  releaseAuthorSequence: (groupId, authorAddress, authorStreamId, authorSeq) => {
    const m = manager();
    if (!m) return false;
    return m.releaseAuthorSequence(
      groupId,
      authorAddress,
      authorStreamId,
      authorSeq
    );
  },
  sendTyping: (groupId, channelIdOrAuthorAddress, authorAddressOrActive, activeMaybe) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const channelId =
        typeof activeMaybe === 'boolean' ? channelIdOrAuthorAddress : 'general';
      const authorAddress =
        typeof activeMaybe === 'boolean'
          ? String(authorAddressOrActive || '')
          : channelIdOrAuthorAddress;
      const active =
        typeof activeMaybe === 'boolean'
          ? activeMaybe
          : authorAddressOrActive === true;
      m.sendTyping(groupId, channelId, authorAddress, active);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum chat typing send failed',
      };
    }
  },
  sendLandState: async (groupId, authorAddress, state) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      await m.sendLandState(groupId, authorAddress, state);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'QortalLand state send failed',
      };
    }
  },
  sendLandChat: async (message) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandChat(message);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'QortalLand chat send failed',
      };
    }
  },
  sendLandAction: async (groupId, action) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandAction(groupId, action);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand action send failed',
      };
    }
  },
  sendLandCall: async (groupId, call) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.sendLandCall(groupId, call);
      if (!result.ok) {
        return { success: false, error: result.error ?? result.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'QortalLand call send failed',
      };
    }
  },
  requestResource: async (groupId, manifest, eventId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.requestResource(
        groupId,
        manifest,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) return { success: true };
      return { success: false, error: result.error ?? result.reason };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource request failed',
      };
    }
  },
  requestDirectResource: async (myAddress, peerAddress, manifest, eventId) => {
    const m = manager();
    if (!m) return notRunning;
    try {
      const result = await m.requestDirectResource(
        myAddress,
        peerAddress,
        manifest,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) return { success: true };
      return { success: false, error: result.error ?? result.reason };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum direct resource request failed',
      };
    }
  },
  cancelResource: async (fileHash) => {
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    const m = manager();
    if (!m) return notRunning;
    try {
      return { success: true, canceled: await m.cancelResource(hash) };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource cancel failed',
      };
    }
  },
  getHistory: (groupId, channelIdOrLimit, limitMaybe, optionsMaybe) => {
    const m = manager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return m
      ? readGroupState([], () => m.getHistory(groupId, channelId, limit, optionsMaybe))
      : [];
  },
  getMessageHistory: (groupId, channelIdOrLimit, limitMaybe, optionsMaybe) => {
    const m = manager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return m
      ? readGroupState([], () =>
          m.getMessageHistory(groupId, channelId, limit, optionsMaybe)
        )
      : [];
  },
  getMessageHistoryPage: (groupId, channelId, limit, options) => {
    const m = manager();
    const fallback = {
      events: [],
      oldestCursor: null,
      newestCursor: null,
      hasMore: false,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getMessageHistoryPage(groupId, channelId || 'general', limit, options)
        )
      : fallback;
  },
  getDiscussionIndex: (groupId, channelId) => {
    const m = manager();
    const fallback = { replyCounts: {}, rootByEventId: {} };
    return m
      ? readGroupState(fallback, () =>
          m.getDiscussionIndex(groupId, channelId || 'general')
        )
      : fallback;
  },
  getDiscussionMessages: (groupId, channelId, eventId) => {
    const m = manager();
    return m
      ? readGroupState([], () =>
          m.getDiscussionMessages(groupId, channelId, eventId)
        )
      : [];
  },
  getChannelMetadataHistory: (groupId, limit) => {
    const m = manager();
    return m
      ? readGroupState([], () => m.getChannelMetadataHistory(groupId, limit))
      : [];
  },
  getChannels: (groupId, includeArchived) => {
    const m = manager();
    return m
      ? readGroupState([], () => m.getChannels(groupId, includeArchived === true))
      : [];
  },
  getCategories: (groupId) => {
    const m = manager();
    return m ? readGroupState([], () => m.getCategories(groupId)) : [];
  },
  getChannelMetadataBundle: (groupId, includeArchived) => {
    const m = manager();
    const fallback = {
      channels: [],
      categories: [],
      ready: false,
      snapshotVersion: 0,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getChannelMetadataBundle(groupId, includeArchived === true)
        )
      : fallback;
  },
  applyChannelMetadata: async (eventId, payload) => {
    if (typeof eventId !== 'string' || !eventId) return { success: false };
    const m = manager();
    if (!m) return { success: false };
    const applied = await m.applyChannelMetadataEvent(eventId, payload);
    return { success: applied };
  },
  getSyncState: (groupId) => {
    const m = manager();
    return m ? readGroupState({}, () => m.getSyncState(groupId)) : {};
  },
  getSummaries: (myAddress) => {
    const m = manager();
    const address = typeof myAddress === 'string' ? myAddress : '';
    return m ? m.getChatSummaries(address, RETICULUM_CHAT_ONLINE_SINCE_MS) : [];
  },
  search: (query, options) => {
    const safeQuery = typeof query === 'string' ? query : '';
    const safeOptions = options && typeof options === 'object' ? options : {};
    return manager()?.searchEvents(safeQuery, safeOptions) ?? [];
  },
  getMessageWindowAroundEvent: (groupId, channelId, eventId, options) => {
    const m = manager();
    const safeOptions = options && typeof options === 'object' ? options : {};
    return m
      ? readGroupState([], () =>
          m.getMessageWindowAroundEvent(groupId, channelId, eventId, safeOptions)
        )
      : [];
  },
  getMessageWindowPageAroundEvent: (groupId, channelId, eventId, options) => {
    const m = manager();
    const safeOptions = options && typeof options === 'object' ? options : {};
    const fallback = {
      events: [],
      oldestCursor: null,
      newestCursor: null,
      hasOlder: false,
      hasNewer: false,
    };
    return m
      ? readGroupState(fallback, () =>
          m.getMessageWindowPageAroundEvent(
            groupId,
            channelId,
            eventId,
            safeOptions
          )
        )
      : fallback;
  },
  indexSearchText: (eventId, text) => {
    if (typeof eventId !== 'string' || typeof text !== 'string') {
      return { success: false };
    }
    const m = manager();
    return { success: m ? m.indexSearchText(eventId, text) : false };
  },
  deleteSearchText: (eventId) => {
    if (typeof eventId !== 'string') return { success: false };
    const m = manager();
    return { success: m ? m.deleteSearchText(eventId) : false };
  },
  replaceMentions: (eventId, mentionedAddresses) => {
    if (typeof eventId !== 'string' || !Array.isArray(mentionedAddresses)) {
      return { success: false };
    }
    const m = manager();
    return {
      success: m ? m.replaceMentionsForEvent(eventId, mentionedAddresses) : false,
    };
  },
  deleteMentions: (eventId) => {
    if (typeof eventId !== 'string') return { success: false };
    const m = manager();
    return { success: m ? m.deleteMentionsForEvent(eventId) : false };
  },
  markRead: (groupId, channelIdOrTimestamp, upToTimestamp, myAddress) => {
    const channelId =
      typeof channelIdOrTimestamp === 'string'
        ? channelIdOrTimestamp
        : 'general';
    const timestamp =
      typeof channelIdOrTimestamp === 'number'
        ? channelIdOrTimestamp
        : Number(upToTimestamp);
    const address =
      typeof channelIdOrTimestamp === 'number'
        ? typeof upToTimestamp === 'string'
          ? upToTimestamp
          : myAddress
        : myAddress;
    const normalizedAddress = typeof address === 'string' ? address : '';
    manager()?.markRead(groupId, channelId, timestamp, normalizedAddress);
    return { success: true };
  },
  markGroupsRead: (groupIds, myAddress) => {
    const m = manager();
    if (!m) {
      return {
        success: false,
        error: 'Reticulum chat is unavailable',
        groupsMarked: 0,
        channelsMarked: 0,
      };
    }
    const normalizedGroupIds = Array.isArray(groupIds)
      ? groupIds
          .map((groupId: unknown) => Number(groupId))
          .filter((groupId: number) => Number.isInteger(groupId) && groupId > 0)
      : [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    const result = m.markGroupsRead(normalizedGroupIds, address);
    return { success: true, ...result };
  },
  getSubscriptions: () => manager()?.getSubscriptions() ?? [],
  updateMentionBadge: () => ({ success: true }),
};

// ── worker message pump ──────────────────────────────────────────────────────

export function handleMainMessage(data: any): void {
  if (!data || typeof data !== 'object') return;
  if (data.t === 'rpc') {
    const { id, method, args } = data;
    void (async () => {
      try {
        const handler = handlers[method];
        if (!handler) throw new Error(`Unknown reticulumChat method: ${method}`);
        const value = await handler(...(Array.isArray(args) ? args : []));
        post({ t: 'rpcres', id, ok: true, value });
      } catch (err) {
        post({
          t: 'rpcres',
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return;
  }
  if (data.t === 'cmdres' || data.t === 'signres') {
    const pending = pendingOut.get(data.id);
    if (pending) {
      pendingOut.delete(data.id);
      if (data.t === 'cmdres') pending.resolve(data.frame);
      else pending.resolve(data.result);
    }
    return;
  }
  if (data.t === 'pyevent') {
    if (data.event === 'ready') {
      bridge?.markReady(data.payload ?? {});
    } else {
      bridge?.dispatchPythonEvent(data.event, data.payload);
    }
    return;
  }
  if (data.t === 'presence-state') {
    presencePeers = Array.isArray(data.peers) ? data.peers : [];
    presenceLeases = Array.isArray(data.leases) ? data.leases : [];
    overlayHealthy = data.healthy === true;
    return;
  }
  if (data.t === 'config') {
    config = { ...config, ...data.config };
    return;
  }
  if (data.t === 'stop') {
    try {
      stopReticulumChatManager();
      resourceStore?.close?.();
    } catch (err) {
      console.warn('[MobileChat] stop failed', err);
    }
    bridge?.markStopped();
    return;
  }
}
