import { atom, type PrimitiveAtom } from 'jotai';
import {
  atomWithReset,
  atomFamily,
  atomWithStorage,
  useAtomCallback,
} from 'jotai/utils';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../constants/constants';
import { ApiKey } from '../types/auth';
import { extStates } from '../App';
import { Steps } from '../components/CoreSetupDialog';
import { LOCALHOST } from '../constants/constants';
import { GlobalDownloadEntry } from '../types/resources';
import { defaultPinnedApps } from '../components/Apps/config/officialApps';
import { getElectronPersistentStorage } from '../utils/electronPersistentStorage';
import { isGoApp } from '../utils/platform';
import {
  normalizeReticulumChatTextScale,
  type ReticulumChatTextScale,
} from '../components/Chat/reticulumChatTextScale';
import type { QuitterDashboardFeedCache } from '../components/Widgets/quitter/quitterFeedTypes';
import type { P2pHealthLevel } from '../lib/p2pHealth';

export const sortablePinnedAppsAtom = atomWithReset(defaultPinnedApps);

/** Derived atom family: each card subscribes only to "is this app pinned?". Key: `${service}\\0${name}` */
export const isAppPinnedAtomFamily = atomFamily((key: string) =>
  atom((get) => {
    const list = get(sortablePinnedAppsAtom);
    if (!key || !list?.length) return false;
    const sep = key.indexOf('\0');
    const service = sep >= 0 ? key.slice(0, sep) : key;
    const name = sep >= 0 ? key.slice(sep + 1) : '';
    return !!list.find(
      (item) => item?.service === service && item?.name === name
    );
  })
);

export const addressInfoControllerAtom = atomWithReset({});
export const blobControllerAtom = atomWithReset({});
export const canSaveSettingToQdnAtom = atomWithReset(false);
export const enabledDevModeAtom = atomWithReset(false);
export const fullScreenAtom = atomWithReset(false);
export const p2pHealthAtom = atom<P2pHealthLevel | 'unknown'>('unknown');
export const groupAnnouncementsAtom = atomWithReset({});
export const groupChatTimestampsAtom = atomWithReset({});
export type ReticulumChatSummaryAtomEntry = {
  groupId: number;
  channelId?: string;
  lastEvent?: {
    authorAddress?: string;
    encryptedPayload?: string;
    eventId?: string;
    eventType?: string;
    timestamp?: number;
  } | null;
  unreadCount?: number;
  replyCount?: number;
  mentionCount?: number;
  hasUnreadMention?: boolean;
  updatedAt?: number;
  readThroughTimestamp?: number;
  channels?: ReticulumChatSummaryAtomEntry[];
};
export const reticulumChatSummariesAtom = atomWithReset<
  Record<string, ReticulumChatSummaryAtomEntry>
>({});
export const reticulumDirectSummariesAtom = atomWithReset<Record<string, any>>(
  {}
);
export const reticulumChatEnabledAtom = atomWithReset(true);
export const reticulumEnabledAtom = atomWithReset(true);
/** Group payload for the About Group overlay; null when closed. */
export const reticulumGroupAboutAtom = atom<any>(null);
export const groupsOwnerNamesAtom = atomWithReset({});
export const groupsPropertiesAtom = atomWithReset({});
export const hasSettingsChangedAtom = atomWithReset(false);
/**
 * True when Enter in a chat composer types a new line instead of sending.
 * GO starts there, like other phone chat apps: the keyboard's return key
 * shows a new-line arrow and the composer has its own send button. The
 * desktop keeps Enter = send. A saved choice ('settings-disable-editor-enter')
 * wins over both.
 */
export const isDisabledEditorEnterAtom = atomWithReset(isGoApp());

/** True while mobile chat compose keyboard mode is active (hides tab bar, swaps top bar). */
export const mobileChatComposeActiveAtom = atomWithReset(false);
/** True while the in-app emoji keyboard occupies the soft keyboard's slot. */
export const mobileEmojiPanelOpenAtom = atomWithReset(false);
/**
 * True while the chat composer is expanded to full screen. The composer cannot
 * simply out-stack the top bar — it lives inside a section layer that owns its
 * own stacking context — so the bar steps aside instead.
 */
export const mobileFullscreenComposerActiveAtom = atomWithReset(false);
/**
 * True while a group panel (Threads, Qortal Land, Members) fills the phone
 * screen. The app's top and bottom bars step aside so it sits full screen like
 * the Calendar and Files panels, with its close X in the same place.
 */
export const mobileGroupPanelOpenAtom = atomWithReset(false);
/** True when the chat message list has been scrolled down, so the group section
 *  tabs collapse (landscape) to give the conversation more vertical room. */
export const mobileChatHeaderCollapsedAtom = atomWithReset(false);
/** True when the open group chat has unread @mentions for the local user, so
 *  the header @ trigger (mobile) can highlight it. Set by ChatOptions. */
export const chatMentionUnreadAtom = atomWithReset(false);
export const isOpenBlockedModalAtom = atomWithReset(false);
export const isRunningPublicNodeAtom = atomWithReset(false);
/** Pre-login Login settings modal (shared between Enter Qortal screen and footer). */
export const mobileLoginSettingsOpenAtom = atom(false);
export const mobileLoginSettingsWalletsAtom = atom<
  Array<{
    address0?: string;
    name?: string;
    filename?: string;
    [key: string]: unknown;
  }>
>([]);
export const isUsingImportExportSettingsAtom = atomWithReset(null);
export const memberGroupsAtom = atomWithReset([]);
export const memberDirectsAtom = atomWithReset<any[]>([]);
/** Address whose complete group-membership list has been loaded into memberGroupsAtom. */
export const memberGroupsLoadedAddressAtom = atomWithReset('');
export const mutedGroupsAtom = atomWithReset([]);
export const myGroupsWhereIAmAdminAtom = atomWithReset([]);

export const navigationControllerAtom = atomWithReset({});
export const oldPinnedAppsAtom = atomWithReset([]);
export const promotionsAtom = atomWithReset([]);
export const promotionTimeIntervalAtom = atomWithReset(0);

/** TTL in ms for join requests and group invites cache (3 minutes). */
export const GROUP_ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000;

/** Cache for group invites (user's list). Invalidated after TTL or explicit refresh. */
export type GroupInvitesCache = {
  data: any[];
  fetchedAt: number;
  address: string;
} | null;
export const groupInvitesCacheAtom = atom<GroupInvitesCache>(
  null
) as PrimitiveAtom<GroupInvitesCache>;

/** Cache for join requests (admin list). Invalidated after TTL or explicit refresh. */
export type JoinRequestsCache = {
  data: Array<{ group: any; data: any[] }>;
  fetchedAt: number;
  adminGroupIds: number[];
} | null;
export const joinRequestsCacheAtom = atom<JoinRequestsCache>(
  null
) as PrimitiveAtom<JoinRequestsCache>;

/** Quitter home-dashboard widget feed. Reset on logout. Prefer useAtom only in QuitterFeedWidget. */
export const quitterDashboardFeedCacheAtom =
  atomWithReset<QuitterDashboardFeedCache | null>(null);

export const qMailLastEnteredTimestampAtom = atomWithReset(null);
export const resourceDownloadControllerAtom = atomWithReset({});
export const globalDownloadsAtom = atomWithReset<
  Record<string, GlobalDownloadEntry>
>({});
export const selectedGroupIdAtom = atomWithReset(null);
export const settingsLocalLastUpdatedAtom = atomWithReset(0);
export const settingsQDNLastUpdatedAtom = atomWithReset(-100);
export const timestampEnterDataAtom = atomWithReset({});

// A row depends only on its group object, its summary and the chat switch.
// Summary refreshes keep unchanged summaries' identity, so reusing the row
// here lets the memo'ed GroupItem rows skip re-rendering when another group
// changed.
const memberGroupWithReticulumChatRows = new WeakMap<
  object,
  { summary: unknown; reticulumChatEnabled: boolean; row: any }
>();

export const memberGroupsWithReticulumChatAtom = atom((get) => {
  const groups = get(memberGroupsAtom);
  const reticulumSummaries = get(reticulumChatSummariesAtom);
  const reticulumChatEnabled = get(reticulumChatEnabledAtom);
  if (!Array.isArray(groups) || !reticulumSummaries) return groups;
  return groups
    .map((group: any) => {
      const numericGroupId = Number(group?.groupId);
      const groupId =
        Number.isInteger(numericGroupId) && numericGroupId > 0
          ? String(numericGroupId)
          : String(group?.groupId ?? '');
      const summary = reticulumSummaries[groupId];
      const cachedRow =
        group && typeof group === 'object'
          ? memberGroupWithReticulumChatRows.get(group)
          : undefined;
      if (
        cachedRow &&
        cachedRow.summary === summary &&
        cachedRow.reticulumChatEnabled === reticulumChatEnabled
      ) {
        return cachedRow.row;
      }
      const row = memberGroupWithReticulumChatRow(
        group,
        summary,
        reticulumChatEnabled
      );
      if (group && typeof group === 'object') {
        memberGroupWithReticulumChatRows.set(group, {
          summary,
          reticulumChatEnabled,
          row,
        });
      }
      return row;
    })
    .sort((a: any, b: any) => {
      const timestampA = typeof a?.timestamp === 'number' ? a.timestamp : 0;
      const timestampB = typeof b?.timestamp === 'number' ? b.timestamp : 0;
      if (timestampA !== timestampB) return timestampB - timestampA;
      return String(a?.groupName || '').localeCompare(
        String(b?.groupName || '')
      );
    });
});

function memberGroupWithReticulumChatRow(
  group: any,
  summary: ReticulumChatSummaryAtomEntry | undefined,
  reticulumChatEnabled: boolean
): any {
  const lastEvent = summary?.lastEvent;
  const reticulumTimestamp =
    typeof summary?.updatedAt === 'number'
      ? summary.updatedAt
      : typeof lastEvent?.timestamp === 'number'
        ? lastEvent.timestamp
        : 0;
  if (reticulumChatEnabled) {
    return {
      ...group,
      data: reticulumTimestamp
        ? lastEvent?.encryptedPayload || 'reticulum-chat'
        : undefined,
      reticulumChatSummary: summary,
      sender: reticulumTimestamp ? lastEvent?.authorAddress : undefined,
      timestamp: reticulumTimestamp || undefined,
    };
  }
  const coreTimestamp =
    typeof group?.timestamp === 'number' ? group.timestamp : 0;
  if (!reticulumTimestamp || reticulumTimestamp < coreTimestamp) {
    return summary ? { ...group, reticulumChatSummary: summary } : group;
  }
  return {
    ...group,
    data: lastEvent?.encryptedPayload || group?.data || 'reticulum-chat',
    reticulumChatSummary: summary,
    sender: lastEvent?.authorAddress || group?.sender,
    timestamp: reticulumTimestamp,
  };
}

// When in Electron, use appStorage-backed persistence; otherwise Jotai uses localStorage (undefined = default).
const electronStorage = getElectronPersistentStorage();

export type { ReticulumChatTextScale };
// Read on init: the chat that opens first must not show one frame at Default.
const reticulumChatTextScaleStoredAtom = atomWithStorage<string>(
  'qortal_reticulum_chat_text_scale',
  'default',
  electronStorage as any,
  { getOnInit: true }
);
/**
 * Persisted, Reticulum-only chat reading size preference. A Medium or High
 * saved by an older build reads as Large until the next choice replaces it.
 */
export const reticulumChatTextScaleAtom = atom(
  (get): ReticulumChatTextScale =>
    normalizeReticulumChatTextScale(get(reticulumChatTextScaleStoredAtom)),
  (_get, set, next: ReticulumChatTextScale) => {
    set(reticulumChatTextScaleStoredAtom, next);
  }
);

/** Persisted, Reticulum-only preference for subtly distinguishing sent messages. */
export const reticulumHighlightOwnMessagesAtom = atomWithStorage<boolean>(
  'qortal_reticulum_highlight_own_messages',
  false,
  electronStorage as any
);

/** Persisted legacy UI preference. Disabled by default while Threads is retired. */
export const reticulumLegacyThreadsEnabledAtom = atomWithStorage<boolean>(
  'qortal_reticulum_legacy_threads_enabled',
  false,
  electronStorage as any
);

/** Persisted: true = Q-Wallets embedded workspace opens edge-to-edge. */
export const qWalletsWorkspaceFullScreenAtom = atomWithStorage<boolean>(
  'qortal_q_wallets_workspace_full_screen',
  false
);

/** Persisted: true = chat widget is closed (hidden). Reopen via right sidebar. */
export const chatWidgetClosedAtom = atomWithStorage<boolean>(
  'qortal_chat_widget_closed',
  false
);

export const disableDevLogsAtom = atomWithStorage<boolean>(
  'qortal_disable_dev_logs',
  true,
  electronStorage as any
);

/** Persisted: global chat widget position and size. Saved only on drag/resize end. */
export const globalChatWidgetBoundsAtom = atomWithStorage<{
  x: number;
  width: number;
  height: number;
} | null>('qortal_chat_widget_bounds', null, undefined, { getOnInit: true });

/** Persisted: group chat Q-Manager popup size. */
export const groupQManagerPopupSizeAtom = atomWithStorage<{
  width: number;
  height: number;
} | null>('qortal_group_q_manager_popup_size', null, undefined, {
  getOnInit: true,
});

/** Persisted: default microphone / speaker for 1v1 and group voice calls (`null` = OS default). */
export const CALL_AUDIO_DEVICES_STORAGE_KEY = 'qortal_call_audio_devices';
export type CallAudioDevicePrefs = {
  inputDeviceId: string | null;
  inputDeviceLabel?: string | null;
  inputDeviceGroupId?: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel?: string | null;
  outputDeviceGroupId?: string | null;
};
export const callAudioDevicesAtom = atomWithStorage<CallAudioDevicePrefs>(
  CALL_AUDIO_DEVICES_STORAGE_KEY,
  { inputDeviceId: null, outputDeviceId: null },
  electronStorage as any
);

/** Persisted: DM friends (see dmFriendsByAccountAtom / dmFriendsByAddressAtom). */
export const DM_FRIENDS_STORAGE_KEY = 'qortal_dm_friends';
export type DmFriendStored = {
  publicKey: string;
  name?: string;
  addedAt: number;
  /** Reticulum event announcing this side of the friendship. */
  eventId?: string;
};

/** Persisted: custom websocket notification subscriptions. Sent as a second subscribe action when the notifications socket connects. */
export type CustomWebsocketSubscription = {
  event: string;
  resourceFilter?: {
    service: string;
    identifier: string;
    name?: string;
    excludeBlocked?: boolean;
    mode?: string;
  };
  filters?: Record<string, string>;
  image?: string;
  link?: string;
  notificationId?: string;
  appName?: string;
  appService?: string;
  message?: Record<string, string>;
  [key: string]: unknown;
};

/** Persisted: custom WS subscriptions per user address (key: qortal_custom_ws_subscriptions). */
export const CUSTOM_WS_SUBSCRIPTIONS_STORAGE_KEY =
  'qortal_custom_ws_subscriptions';
export const customWebsocketSubscriptionsByAddressAtom = atomWithStorage<
  Record<string, CustomWebsocketSubscription[]>
>(CUSTOM_WS_SUBSCRIPTIONS_STORAGE_KEY, {}, electronStorage as any);

/** Persisted: keys of notifications already "seen in app" (excluded from unread count), by address then notification key. Keys older than this are pruned. */
export const NOTIFICATION_SEEN_IN_APP_STORAGE_KEY =
  'qortal_notification_seen_in_app';
const NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** Per-address record of notificationKey -> mark time (ms). Pruned to last 3 days when read/set. */
export type SeenInAppKeyRecord = Record<string, number>;
/** Stored shape: address -> notificationKey -> timestamp. */
export type SeenInAppRecordByAddress = Record<string, SeenInAppKeyRecord>;

export function parseSeenInAppStored(
  raw: string | null | unknown
): SeenInAppRecordByAddress {
  if (raw == null || raw === '') return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (Array.isArray(parsed)) return {};
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const result: SeenInAppRecordByAddress = {};
  for (const [addr, inner] of Object.entries(obj)) {
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const keyRecord: SeenInAppKeyRecord = {};
      for (const [k, t] of Object.entries(inner)) {
        if (typeof t === 'number') keyRecord[k] = t;
      }
      result[addr] = keyRecord;
    }
  }
  return result;
}

function filterSeenInAppKeyRecordByAge(
  record: SeenInAppKeyRecord
): SeenInAppKeyRecord {
  const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, t]) => typeof t === 'number' && t > cutoff
    )
  );
}

export function filterSeenInAppRecordByAge(
  record: SeenInAppRecordByAddress
): SeenInAppRecordByAddress {
  const out: SeenInAppRecordByAddress = {};
  for (const [addr, inner] of Object.entries(record)) {
    const pruned = filterSeenInAppKeyRecordByAge(inner);
    if (Object.keys(pruned).length > 0) out[addr] = pruned;
  }
  return out;
}

/** Keys for one address from the last 3 days. */
function seenInAppRecordToKeysForAddress(
  record: SeenInAppRecordByAddress,
  address: string | null | undefined
): string[] {
  if (!address) return [];
  const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  const byAddr = record[address] ?? {};
  return Object.keys(byAddr).filter(
    (k) => typeof byAddr[k] === 'number' && byAddr[k] > cutoff
  );
}

const seenInAppStorage = {
  getItem: (key: string): SeenInAppRecordByAddress => {
    const raw: string | null | unknown =
      electronStorage != null
        ? (electronStorage as any).getItem(key, null)
        : typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null;
    const record = parseSeenInAppStored(raw);
    return filterSeenInAppRecordByAge(record);
  },
  setItem: (key: string, value: string | SeenInAppRecordByAddress): void => {
    const record =
      typeof value === 'string' ? parseSeenInAppStored(value) : value;
    const pruned = filterSeenInAppRecordByAge(record);
    if (electronStorage != null) {
      (electronStorage as any).setItem(key, pruned);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(pruned));
    }
  },
  removeItem: (key: string): void => {
    if (electronStorage != null) {
      (electronStorage as any).removeItem?.(key);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },
};

export const notificationSeenInAppKeysRecordAtom =
  atomWithStorage<SeenInAppRecordByAddress>(
    NOTIFICATION_SEEN_IN_APP_STORAGE_KEY,
    {},
    seenInAppStorage as any
  );

/**
 * Keys for current user (from last 3 days). Set with string[] for current
 * address or { address, keys } to add missing keys marked "now" (existing
 * marks keep their time), or { address, keyTimes } to merge keys with their
 * real mark times (the newer time wins when a key already exists) — used when
 * seen state arrives from another device or from get.ts, which passes a
 * re-mark's new time this way.
 *
 * An update that changes nothing writes nothing: no storage write, no new
 * record, no re-render. Subscribers derive arrays from this record, so a
 * write with identical content would still look like a change to them.
 */
export const notificationSeenInAppKeysAtom = atom(
  (get) =>
    seenInAppRecordToKeysForAddress(
      get(notificationSeenInAppKeysRecordAtom) as SeenInAppRecordByAddress,
      get(userInfoAtom)?.address
    ),
  (
    get,
    set,
    update:
      | string[]
      | { address: string; keys: string[] }
      | { address: string; keyTimes: Record<string, number> }
  ) => {
    const full = get(
      notificationSeenInAppKeysRecordAtom
    ) as SeenInAppRecordByAddress;
    const isObjectUpdate =
      typeof update === 'object' && update !== null && !Array.isArray(update);
    const address = isObjectUpdate
      ? (update as { address: string }).address
      : get(userInfoAtom)?.address;
    if (!address) return;
    const keyTimes =
      isObjectUpdate && 'keyTimes' in update
        ? (update as { keyTimes: Record<string, number> }).keyTimes
        : null;
    const keys =
      isObjectUpdate && 'keys' in update
        ? (update as { keys: string[] }).keys
        : Array.isArray(update)
          ? update
          : null;
    if (!keyTimes && !Array.isArray(keys)) return;
    const next: SeenInAppKeyRecord = { ...(full[address] ?? {}) };
    const now = Date.now();
    let changed = false;
    if (keyTimes && typeof keyTimes === 'object') {
      for (const [k, t] of Object.entries(keyTimes)) {
        if (!k || typeof t !== 'number' || !Number.isFinite(t)) continue;
        const markedAt = Math.min(t, now);
        const existing = next[k];
        if (typeof existing === 'number' && existing >= markedAt) continue;
        next[k] = markedAt;
        changed = true;
      }
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (typeof k !== 'string' || !k) continue;
        // Never move an existing mark: a prefix key hides every resource
        // published before its time, so bumping it would silently mark newer
        // items as seen.
        if (typeof next[k] === 'number') continue;
        next[k] = now;
        changed = true;
      }
    }
    if (!changed) return;
    set(
      notificationSeenInAppKeysRecordAtom,
      filterSeenInAppRecordByAge({ ...full, [address]: next })
    );
  }
);

/** Current user: seen-in-app key → mark time (ms). Same ageing as notificationSeenInAppKeysAtom. */
export const notificationSeenInAppKeyTimesAtom = atom((get) => {
  const byAddress = get(
    notificationSeenInAppKeysRecordAtom
  ) as SeenInAppRecordByAddress;
  const address = get(userInfoAtom)?.address;
  if (!address) return {} as SeenInAppKeyRecord;
  return filterSeenInAppKeyRecordByAge(byAddress[address] ?? {});
});

/** Same field order as GeneralNotifications getNotificationTimestamp (for prefix cutoff). */
export function getNotificationSeenComparableTimeMs(notification: {
  data?: { created?: unknown; timestamp?: unknown };
  timestamp?: unknown;
}): number | null {
  const raw =
    notification?.data?.created ??
    notification?.data?.timestamp ??
    notification?.timestamp;
  if (raw == null || typeof raw !== 'number') return null;
  return raw < 1e12 ? raw * 1000 : raw;
}

/**
 * Full key: that exact notification is seen. Prefix key: seen only if resource time ≤ persisted mark time
 * (so new items after mark stay unread).
 */
export function isNotificationSeenInAppFromKeyTimes(
  notification: {
    event?: string;
    data?: {
      signature?: string;
      identifier?: string;
      created?: unknown;
      timestamp?: unknown;
    };
    appName?: string;
    appService?: string;
    notificationId?: string;
    timestamp?: unknown;
  },
  seenInAppByKey: SeenInAppKeyRecord | null | undefined
): boolean {
  if (!seenInAppByKey || Object.keys(seenInAppByKey).length === 0) return false;
  const fullKey = getNotificationSeenKey(notification);
  if (typeof seenInAppByKey[fullKey] === 'number') return true;
  const prefixKey = getNotificationSeenPrefixKey(notification);
  const markedAt = seenInAppByKey[prefixKey];
  if (typeof markedAt !== 'number') return false;
  const notifTs = getNotificationSeenComparableTimeMs(notification);
  if (notifTs == null) return false;
  return notifTs <= markedAt;
}

/** Stable key for a notification (for "seen in app" matching). */
export function getNotificationSeenKey(notification: {
  event?: string;
  data?: { signature?: string; identifier?: string; created?: unknown };
  appName?: string;
  appService?: string;
  notificationId?: string;
}): string {
  if (notification?.event === 'PAYMENT_RECEIVED') {
    return `PAYMENT_RECEIVED-${notification?.data?.signature ?? ''}`;
  }
  if (notification?.event === 'RESOURCE_PUBLISHED') {
    const appName = (notification?.appName ?? '').toLowerCase();
    const appService = notification?.appService ?? 'APP';
    const notificationId = notification?.notificationId ?? '';
    const id =
      notification?.data?.identifier ?? notification?.data?.created ?? '';
    return `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}-${id}`;
  }
  return `other-${notification?.event ?? ''}-${Date.now()}`;
}

/** Prefix key (app + notificationId only); when app marks by notificationId, we add this. */
export function getNotificationSeenPrefixKey(notification: {
  event?: string;
  appName?: string;
  appService?: string;
  notificationId?: string;
}): string {
  if (notification?.event === 'RESOURCE_PUBLISHED') {
    const appName = (notification?.appName ?? '').toLowerCase();
    const appService = notification?.appService ?? 'APP';
    const notificationId = notification?.notificationId ?? '';
    return `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}`;
  }
  return getNotificationSeenKey(notification as any);
}

/**
 * Persisted: notifications swiped out of the bell panel, by address then
 * dismissal key. The panel list itself is in-memory and the WebSocket history
 * replays the last 3 days on every (re)connect, so without this a swiped item
 * would come back. Entries older than 7 days are pruned.
 */
export const NOTIFICATION_PANEL_DISMISSED_STORAGE_KEY =
  'qortal_notification_panel_dismissed';
const NOTIFICATION_PANEL_DISMISSED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** When the item was swiped away; a mention card also keeps its count then. */
export type NotificationPanelDismissal = {
  at: number;
  mentionCount?: number;
};
export type NotificationPanelDismissals = Record<
  string,
  NotificationPanelDismissal
>;
export type NotificationPanelDismissalsByAddress = Record<
  string,
  NotificationPanelDismissals
>;

/** Parse the stored record, dropping malformed and expired entries. */
export function parseNotificationPanelDismissals(
  raw: unknown
): NotificationPanelDismissalsByAddress {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const cutoff = Date.now() - NOTIFICATION_PANEL_DISMISSED_MAX_AGE_MS;
  const result: NotificationPanelDismissalsByAddress = {};
  for (const [address, inner] of Object.entries(parsed)) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
    const entries: NotificationPanelDismissals = {};
    for (const [key, entry] of Object.entries(inner)) {
      const at = (entry as NotificationPanelDismissal)?.at;
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= cutoff) {
        continue;
      }
      const mentionCount = (entry as NotificationPanelDismissal)?.mentionCount;
      entries[key] =
        typeof mentionCount === 'number' && Number.isFinite(mentionCount)
          ? { at, mentionCount }
          : { at };
    }
    if (Object.keys(entries).length > 0) result[address] = entries;
  }
  return result;
}

/**
 * Stable key for swiping an item out of the bell panel, or null when the item
 * has nothing stable to key on (it then only leaves the in-memory list).
 */
export function getNotificationPanelDismissKey(notification: {
  event?: string;
  appName?: string;
  appService?: string;
  notificationId?: string;
  data?: {
    created?: unknown;
    groupId?: unknown;
    identifier?: string;
    qChatMention?: boolean;
    reticulumCalendarReminder?: boolean;
    reticulumDmCallId?: string;
    reticulumDmMissedCall?: boolean;
  };
}): string | null {
  const data = notification?.data;
  if (data?.qChatMention === true) {
    const groupId = Number(data?.groupId);
    return Number.isFinite(groupId) ? `q-chat-mention-${groupId}` : null;
  }
  if (data?.reticulumDmMissedCall === true) {
    return data?.reticulumDmCallId
      ? `reticulum-dm-call-${data.reticulumDmCallId}`
      : null;
  }
  if (data?.reticulumCalendarReminder === true) {
    return notification?.notificationId || null;
  }
  if (notification?.event === 'RESOURCE_PUBLISHED') {
    if (data?.identifier == null && data?.created == null) return null;
    return getNotificationSeenKey(notification as any);
  }
  if (notification?.event === 'PAYMENT_RECEIVED') {
    return (data as { signature?: string })?.signature
      ? getNotificationSeenKey(notification as any)
      : null;
  }
  return null;
}

export function isNotificationPanelDismissed(
  notification: Parameters<typeof getNotificationPanelDismissKey>[0] & {
    data?: { mentionCount?: unknown };
  },
  dismissals: NotificationPanelDismissals | null | undefined
): boolean {
  const key = getNotificationPanelDismissKey(notification);
  const entry = key ? dismissals?.[key] : undefined;
  if (!entry) return false;
  // One mention card stands for a whole group, so it comes back once the
  // group has more unread mentions than when it was swiped away.
  if (notification?.data?.qChatMention === true) {
    const mentionCount = Number(notification?.data?.mentionCount) || 0;
    return mentionCount <= (entry.mentionCount ?? 0);
  }
  return true;
}

const notificationPanelDismissalsStorage = {
  getItem: (key: string): NotificationPanelDismissalsByAddress =>
    parseNotificationPanelDismissals(
      electronStorage != null
        ? (electronStorage as any).getItem(key, null)
        : typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null
    ),
  setItem: (key: string, value: NotificationPanelDismissalsByAddress): void => {
    const pruned = parseNotificationPanelDismissals(value);
    if (electronStorage != null) {
      (electronStorage as any).setItem(key, pruned);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(pruned));
    }
  },
  removeItem: (key: string): void => {
    if (electronStorage != null) {
      (electronStorage as any).removeItem?.(key);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },
};

export const notificationPanelDismissalsRecordAtom =
  atomWithStorage<NotificationPanelDismissalsByAddress>(
    NOTIFICATION_PANEL_DISMISSED_STORAGE_KEY,
    {},
    notificationPanelDismissalsStorage as any
  );

/**
 * Current user's bell-panel dismissals. Write `{ type: 'dismiss' }` when an
 * item is swiped away (`dismissMany` for the panel's Clear all), and
 * `{ type: 'mentionCount' }` on every unread-mention sync so reading a group's
 * mentions lets the next new mention show again.
 */
export const notificationPanelDismissalsAtom = atom(
  (get): NotificationPanelDismissals => {
    const address = get(userInfoAtom)?.address;
    if (!address) return {};
    return get(notificationPanelDismissalsRecordAtom)[address] ?? {};
  },
  (
    get,
    set,
    action:
      | { type: 'dismiss'; key: string; mentionCount?: number }
      | {
          type: 'dismissMany';
          items: Array<{ key: string; mentionCount?: number }>;
        }
      | { type: 'mentionCount'; groupId: number; mentionCount: number }
  ) => {
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const record = get(notificationPanelDismissalsRecordAtom);
    const current = record[address] ?? {};
    let next: NotificationPanelDismissals;
    if (action.type === 'dismiss' || action.type === 'dismissMany') {
      const items = action.type === 'dismiss' ? [action] : action.items;
      if (!items.length) return;
      const at = Date.now();
      next = { ...current };
      for (const item of items) {
        if (!item?.key) continue;
        next[item.key] =
          typeof item.mentionCount === 'number'
            ? { at, mentionCount: item.mentionCount }
            : { at };
      }
    } else {
      const key = `q-chat-mention-${action.groupId}`;
      const entry = current[key];
      const mentionCount = Math.max(0, action.mentionCount);
      if (!entry || (entry.mentionCount ?? 0) <= mentionCount) return;
      const { [key]: _, ...rest } = current;
      next =
        mentionCount === 0
          ? rest
          : { ...rest, [key]: { ...entry, mentionCount } };
    }
    set(
      notificationPanelDismissalsRecordAtom,
      parseNotificationPanelDismissals({ ...record, [address]: next })
    );
  }
);

export const txListAtom = atomWithReset([]);

/** Notifications per user address (in-memory only; repopulated from WebSocket). */
export const notificationsByAddressAtom = atomWithReset<Record<string, any[]>>(
  {}
);

/** Persisted: timestamp when user last "saw all" notifications, per address (Electron: appStorage). */
export const SEEN_ALL_NOTIFICATIONS_STORAGE_KEY =
  'qortal_seen_all_notifications';
export const seenAllNotificationsByAddressAtom = atomWithStorage<
  Record<string, number | null>
>(SEEN_ALL_NOTIFICATIONS_STORAGE_KEY, {}, electronStorage as any);

/** Groups the current user is a member of – refreshed every 5 minutes. */
export const myMemberGroupsAtom = atomWithReset<any[]>([]);
/** Unix-ms timestamp of the last successful fetch for myMemberGroupsAtom. */
export const myMemberGroupsLastFetchedAtom = atomWithReset<number>(0);

/** Subscriptions the current user is subscribed to (fetched globally in the title bar). */
export const mySubscriptionsAtom = atomWithReset<any[]>([]);
/** Subscriptions belonging to groups the current user manages as admin. */
export const managedSubscriptionsAtom = atomWithReset<any[]>([]);
/** Whether the global subscription fetch is currently in progress. */
export const subscriptionsLoadingAtom = atomWithReset<boolean>(false);
/** Whether the global managed subscription fetch is currently in progress. */
export const managedSubscriptionsLoadingAtom = atomWithReset<boolean>(false);

export const isPublicNodeUnavailableAtom = atomWithReset(false);
export const isLoadingAuthenticateAtom = atomWithReset(false);
export const authenticatePasswordAtom = atomWithReset('');
export const extStateAtom = atomWithReset<extStates>('not-authenticated');
export const userInfoAtom = atomWithReset<any>(null);

/** Pre–per-account storage: flat friend map; merged into first logged-in user on migrate. */
export const DM_FRIENDS_LEGACY_BUCKET_KEY = '__legacy_dm_friends_flat_v1__';

function isDmFriendStoredEntry(v: unknown): v is DmFriendStored {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as DmFriendStored).publicKey === 'string' &&
    typeof (v as DmFriendStored).addedAt === 'number'
  );
}

function isLegacyFlatDmFriendsRoot(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).filter((k) => !k.startsWith('__'));
  if (keys.length === 0) return false;
  return keys.every((k) => isDmFriendStoredEntry(obj[k]));
}

/** Stored: authenticated address → friend address → metadata. */
export type DmFriendsByAccount = Record<string, Record<string, DmFriendStored>>;

export function parseDmFriendsPersisted(
  raw: string | null | unknown
): DmFriendsByAccount {
  if (raw == null || raw === '') return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;

  if (isLegacyFlatDmFriendsRoot(obj)) {
    const bucket: Record<string, DmFriendStored> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isDmFriendStoredEntry(v)) bucket[k] = v;
    }
    return { [DM_FRIENDS_LEGACY_BUCKET_KEY]: bucket };
  }

  const result: DmFriendsByAccount = {};
  for (const [accountKey, inner] of Object.entries(obj)) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
    const innerObj = inner as Record<string, unknown>;
    const friendMap: Record<string, DmFriendStored> = {};
    for (const [fk, fv] of Object.entries(innerObj)) {
      if (isDmFriendStoredEntry(fv)) friendMap[fk] = fv;
    }
    result[accountKey] = friendMap;
  }
  return result;
}

const dmFriendsByAccountStorage = {
  getItem: (key: string): DmFriendsByAccount => {
    const raw: string | null | unknown =
      electronStorage != null
        ? (electronStorage as any).getItem(key, null)
        : typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null;
    return parseDmFriendsPersisted(raw);
  },
  setItem: (key: string, value: string | DmFriendsByAccount): void => {
    const record =
      typeof value === 'string' ? parseDmFriendsPersisted(value) : value;
    if (electronStorage != null) {
      (electronStorage as any).setItem(key, record);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(record));
    }
  },
  removeItem: (key: string): void => {
    if (electronStorage != null) {
      (electronStorage as any).removeItem?.(key);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },
};

/** Persisted: DM friends per authenticated address (friend address → metadata). */
export const dmFriendsByAccountAtom = atomWithStorage<DmFriendsByAccount>(
  DM_FRIENDS_STORAGE_KEY,
  {},
  dmFriendsByAccountStorage as any
);

/** Current user's DM friends (derived from dmFriendsByAccountAtom). */
export const dmFriendsByAddressAtom = atom(
  (get) => {
    const byAccount = get(dmFriendsByAccountAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return {};
    return (byAccount[address] ?? {}) as Record<string, DmFriendStored>;
  },
  (
    get,
    set,
    update:
      | Record<string, DmFriendStored>
      | ((
          prev: Record<string, DmFriendStored>
        ) => Record<string, DmFriendStored>)
  ) => {
    const byAccount = get(dmFriendsByAccountAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAccount[address] ?? {}) as Record<string, DmFriendStored>;
    const next = typeof update === 'function' ? update(prev) : update;
    set(dmFriendsByAccountAtom, { ...byAccount, [address]: next });
  }
);

/** Current user's custom WS subscriptions (derived from customWebsocketSubscriptionsByAddressAtom by address). */
export const customWebsocketSubscriptionsAtom = atom(
  (get) => {
    const byAddress = get(customWebsocketSubscriptionsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return [];
    return (byAddress[address] ?? []) as CustomWebsocketSubscription[];
  },
  (
    get,
    set,
    update:
      | CustomWebsocketSubscription[]
      | ((prev: CustomWebsocketSubscription[]) => CustomWebsocketSubscription[])
  ) => {
    const byAddress = get(customWebsocketSubscriptionsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAddress[address] ?? []) as CustomWebsocketSubscription[];
    const next = typeof update === 'function' ? update(prev) : update;
    set(customWebsocketSubscriptionsByAddressAtom, {
      ...byAddress,
      [address]: next,
    });
  }
);

/** Current user's notifications (derived from notificationsByAddressAtom by address). */
export const paymentNotificationsAtom = atom(
  (get) => {
    const byAddress = get(notificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return [];
    return (byAddress[address] ?? []) as any[];
  },
  (get, set, update: any[] | ((prev: any[]) => any[])) => {
    const byAddress = get(notificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAddress[address] ?? []) as any[];
    const next = typeof update === 'function' ? update(prev) : update;
    set(notificationsByAddressAtom, { ...byAddress, [address]: next });
  }
);

/** Current user's "seen all notifications" timestamp (derived from seenAllNotificationsByAddressAtom by address). */
export const lastPaymentSeenTimestampAtom = atom(
  (get) => {
    const byAddress = get(seenAllNotificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return null;
    return (byAddress[address] ?? null) as number | null;
  },
  (get, set, value: number | null) => {
    const byAddress = get(seenAllNotificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    set(seenAllNotificationsByAddressAtom, { ...byAddress, [address]: value });
  }
);

export const notificationSeenInAppKeysByAddressAtom = atomWithStorage<
  Record<string, Record<string, number>>
>('qortal_notification_seen_in_app_by_address', {});

export const rawWalletAtom = atomWithReset<any>(null);
export const walletToBeDecryptedErrorAtom = atomWithReset<string>('');
export const balanceAtom = atomWithReset<any>(null);
export const qortBalanceLoadingAtom = atomWithReset<boolean>(false);
export const isOpenDialogResetApikey = atomWithReset<boolean>(false);
export const isOpenDialogCustomApikey = atomWithReset<boolean>(false);
export const isOpenCoreSetup = atomWithReset<boolean>(false);
export const isOpenSyncingDialogAtom = atomWithReset<boolean>(false);
export const isOpenSettingUpLocalCoreAtom = atomWithReset<any>({
  isShow: false,
});
export const enableAuthWhenSyncingAtom = atomWithReset<boolean>(false);
export const isOpenUrlInvalidAtom = atomWithReset<boolean>(false);
export const devServerDomainAtom = atomWithReset(LOCALHOST);
export const devServerPortAtom = atomWithReset('');
export const nodeInfosAtom = atomWithReset({});
export const selectedNodeInfoAtom = atomWithReset<ApiKey | null>({
  url: HTTPS_EXT_NODE_QORTAL_LINK,
  apikey: '',
});
export const statusesAtom = atomWithReset<Steps>({
  coreRunning: {
    status: 'idle',
    progress: 0,
    message: '',
  },
  downloadedCore: {
    status: 'idle',
    progress: 0,
    message: '',
  },
  hasJava: {
    status: 'idle',
    progress: 0,
    message: '',
  },
});

export const isNewTabWindowAtom = atomWithReset<boolean>(false);

// Global snack (reduces context re-renders when snack opens/closes)
export const openSnackGlobalAtom = atomWithReset<boolean>(false);
export const infoSnackGlobalAtom = atomWithReset<{
  message?: string;
  type?: string;
  duration?: number | null;
  compact?: boolean;
  dismissible?: boolean;
  sourceId?: string;
  actionLabel?: string;
  actionEvent?: string;
  /** Tapping the popup runs this (e.g. open or share a saved file). */
  onTap?: () => void;
  tapHint?: string;
} | null>(null);

// Tutorial state (reduces context re-renders for tutorial UI)
export const openTutorialModalAtom = atomWithReset<any>(null);
export const shownTutorialsAtom = atomWithReset<Record<string, boolean> | null>(
  null
);
export const hasSeenGettingStartedAtom = atom((get) => {
  const shown = get(shownTutorialsAtom);
  return shown === null ? null : !!(shown || {})['getting-started'];
});

// Block list (reduces context re-renders; useBlockedAddresses reads/writes these)
export const blockedAddressesAtom = atomWithReset<Record<string, boolean>>({});
export const blockedNamesAtom = atomWithReset<Record<string, boolean>>({});

/** Time window (ms) for unread chat notifications – keep in sync with groupConstants */
const TIME_DIFF_UNREAD_CHATS_MS = 900000;

/** Derived: any group chat has unread. Subscribe here instead of memberGroupsAtom to avoid re-renders on list change. */
export const groupChatHasUnreadAtom = atom((get) => {
  const groups = get(memberGroupsWithReticulumChatAtom);
  const myAddress = get(userInfoAtom)?.address;
  const groupChatTimestamps = get(groupChatTimestampsAtom);
  const timestampEnterData = get(timestampEnterDataAtom) || {};
  const reticulumChatEnabled = get(reticulumChatEnabledAtom);
  if (!groups?.length || !myAddress) return false;
  return groups.some((group: any) => {
    if (group?.groupId === '0') return false;
    if (reticulumChatEnabled) {
      return (
        group?.reticulumChatSummary?.hasUnreadMention === true ||
        (group?.reticulumChatSummary?.mentionCount ?? 0) > 0 ||
        (group?.reticulumChatSummary?.unreadCount ?? 0) > 0
      );
    }
    return (
      group?.data &&
      group?.sender !== myAddress &&
      group?.timestamp &&
      groupChatTimestamps[group?.groupId] &&
      ((!timestampEnterData[group?.groupId] &&
        Date.now() - group?.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[group?.groupId] < group?.timestamp)
    );
  });
});

/** Derived: any group announcement has unread. */
export const groupsAnnHasUnreadAtom = atom((get) => {
  const groups = get(memberGroupsAtom);
  const groupAnnouncements = get(groupAnnouncementsAtom);
  if (!groups?.length) return false;
  return groups.some(
    (group: any) =>
      groupAnnouncements[group?.groupId] &&
      !groupAnnouncements[group?.groupId]?.seentimestamp
  );
});

/** Combined: groups tab has any unread (chat or announcements). */
export const hasUnreadGroupsAtom = atom((get) => {
  if (get(reticulumChatEnabledAtom)) return get(groupChatHasUnreadAtom);
  return get(groupChatHasUnreadAtom) || get(groupsAnnHasUnreadAtom);
});

/** Derived: any direct message chat has unread. */
export const directChatHasUnreadAtom = atom((get) => {
  const myAddress = get(userInfoAtom)?.address;
  if (get(reticulumChatEnabledAtom)) {
    const summaries = get(reticulumDirectSummariesAtom) || {};
    return Object.entries(summaries).some(([peerAddress, summary]) => {
      if (myAddress && peerAddress === myAddress) return false;
      return (
        Number((summary as { unreadCount?: number })?.unreadCount || 0) > 0
      );
    });
  }
  const directs = get(memberDirectsAtom);
  const timestampEnterData = get(timestampEnterDataAtom) || {};
  if (!directs?.length || !myAddress) return false;
  return directs.some(
    (direct: any) =>
      direct?.sender !== myAddress &&
      direct?.timestamp &&
      ((!timestampEnterData[direct?.address] &&
        Date.now() - direct.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[direct?.address] < direct.timestamp)
  );
});

/** Derived: any non-muted group chat has unread (respects push mute list). */
export const groupChatHasUnreadExcludingMutedAtom = atom((get) => {
  const groups = get(memberGroupsAtom);
  const myAddress = get(userInfoAtom)?.address;
  const groupChatTimestamps = get(groupChatTimestampsAtom);
  const timestampEnterData = get(timestampEnterDataAtom) || {};
  const mutedGroups = get(mutedGroupsAtom) || [];
  const mutedSet = new Set([...mutedGroups, '0']);
  if (!groups?.length || !myAddress) return false;
  return groups.some(
    (group: any) =>
      !mutedSet.has(group?.groupId) &&
      group?.groupId !== '0' &&
      group?.data &&
      group?.sender !== myAddress &&
      group?.timestamp &&
      groupChatTimestamps[group?.groupId] &&
      ((!timestampEnterData[group?.groupId] &&
        Date.now() - group?.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[group?.groupId] < group.timestamp)
  );
});

/** Derived: is the selected group's chat unread? Key: selectedGroupId (string) or empty. */
export const isUnreadChatAtomFamily = atomFamily((selectedGroupId: string) =>
  atom((get) => {
    if (!selectedGroupId) return false;
    const groups = get(memberGroupsWithReticulumChatAtom);
    const myAddress = get(userInfoAtom)?.address;
    const groupChatTimestamps = get(groupChatTimestampsAtom);
    const timestampEnterData = get(timestampEnterDataAtom) || {};
    const reticulumChatEnabled = get(reticulumChatEnabledAtom);
    const findGroup = groups?.find((g: any) => g?.groupId === selectedGroupId);
    if (reticulumChatEnabled) {
      return (
        findGroup?.reticulumChatSummary?.hasUnreadMention === true ||
        (findGroup?.reticulumChatSummary?.mentionCount ?? 0) > 0 ||
        (findGroup?.reticulumChatSummary?.unreadCount ?? 0) > 0
      );
    }
    if (!findGroup?.data || !findGroup?.timestamp) return false;
    if (findGroup?.sender === myAddress) return false;
    return !!(
      groupChatTimestamps[findGroup?.groupId] &&
      ((!timestampEnterData[selectedGroupId] &&
        Date.now() - findGroup.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[selectedGroupId] < findGroup.timestamp)
    );
  })
);

// Atom Families (replacing selectorFamily)
export const resourceKeySelector = atomFamily((key) =>
  atom((get) => get(resourceDownloadControllerAtom)[key] || null)
);

export const blobKeySelector = atomFamily((key) =>
  atom((get) => get(blobControllerAtom)[key] || null)
);

export const addressInfoKeySelector = atomFamily((key) =>
  atom((get) => get(addressInfoControllerAtom)[key] || null)
);

export const groupsOwnerNamesSelector = atomFamily((key) =>
  atom((get) => get(groupsOwnerNamesAtom)[key] || null)
);

export const groupAnnouncementSelector = atomFamily((key) =>
  atom((get) => get(groupAnnouncementsAtom)[key] || null)
);

export const groupPropertySelector = atomFamily((key) =>
  atom((get) => get(groupsPropertiesAtom)[key] || null)
);

export const groupChatTimestampSelector = atomFamily((key) =>
  atom((get) => get(groupChatTimestampsAtom)[key] || null)
);

export const timestampEnterDataSelector = atomFamily((key) =>
  atom((get) => get(timestampEnterDataAtom)[key] || null)
);

export function useGetResourceStatus() {
  return useAtomCallback(async (get, _set, id: string) => {
    const resources = get(resourceDownloadControllerAtom);
    return resources?.[id];
  });
}

/**
 * Qortino agent sheet visibility.
 * - open: Dialog is shown
 * - parked: session kept alive while user browses a Q-App; first Home restores it
 */
export const qortinoAgentOpenAtom = atom(false);
export const qortinoAgentParkedAtom = atom(false);

/** Controls visibility of the support chat panel (toggled via sidebar icon). */
export const supportChatOpenAtom = atom(false);

/** Controls visibility of the group call panel (separate from 1v1 support chat). */
export const groupChatOpenAtom = atom(false);

/** Qortal group voice: full-screen stage hidden; slim rail next to group list. */
export const qortalGroupVoiceCallMinimizedAtom = atom(false);

/**
 * P2P mesh hint: groupId (string) → at least one participant may be in a voice call
 * for `gcall-qortal-<id>`. Updated from Electron main (debounced); not cryptographically verified.
 */
export const qortalGroupMeshCallActiveAtom = atom<Record<string, boolean>>({});

/** P2P mesh hint: groupId (string) → latest advertised participant count for a group call. */
export const qortalGroupMeshCallParticipantCountAtom = atom<
  Record<string, number>
>({});

/** P2P mesh hint: groupId (string) → advertised max participant count for a group call. */
export const qortalGroupMeshCallMaxParticipantsAtom = atom<
  Record<string, number>
>({});

/** Local user's active Qortal group call room id (`gcall-qortal-<n>`), or null. */
export const qortalGroupSelfGcallRoomIdAtom = atom<string | null>(null);

/** UI-only address → primaryName cache for active Qortal group call participants. */
export const qortalGroupCallPrimaryNamesAtom = atom<Record<string, string>>({});
