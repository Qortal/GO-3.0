import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  customWebsocketSubscriptionsAtom,
  lastPaymentSeenTimestampAtom,
  reticulumChatEnabledAtom,
} from '../../atoms/global';
import {
  addSeenInAppKeysForAddress,
  applySyncedCustomSubscriptions,
  getSeenInAppKeyTimesForAddress,
} from '../../qortal/get';
import {
  getNotificationOsPushDisabledMap,
  getNotificationPermissionKey,
  getPermission,
  getQortalRequestPermissions,
  parseNotificationPermissionKey,
  setNotificationOsPushDisabled,
  setPermission,
} from '../../qortal/qortal-requests';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  buildDesiredState,
  canonicalCacheValue,
  classifyStateKey,
  desiredRuleEntry,
  desiredSeenEntry,
  diffAgainstCache,
  executeRemotePlan,
  filterPublishItemsByLww,
  isNotifStateKey,
  isPlanEmpty,
  NOTIF_MENTIONS_KEY,
  NOTIF_RULE_PREFIX,
  NOTIF_SEENALL_KEY,
  NOTIF_STATE_PREFIX,
  normalizeAppName,
  osPushStateKey,
  parseFlagValue,
  parseRuleValue,
  permStateKey,
  planRemoteApply,
  prunePlanAgainstLocal,
  ruleStateKey,
  serialiseFlag,
  serialiseMentions,
  serialiseSeenAll,
  tombstonesForRemovals,
  type DeviceStateRecord,
  type LocalSnapshot,
  type PublishItem,
  type RemoteApplyDeps,
  type RuleRef,
  type SyncRule,
} from '../../utils/notificationStateSync';
import {
  getQChatMentionNotificationsEnabled,
  QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT,
  setQChatMentionNotificationsEnabled,
} from '../../utils/qChatMentionNotifications';

const READINESS_POLL_MS = 5000;
const PUSH_RETRY_MS = 5000;
const PUSH_MAX_ATTEMPTS = 12;
const REMOTE_BATCH_MS = 150;
const SYNC_NOTICE_SETTING_KEY = 'notification-sync-notice-shown';

type ReadinessStatus = {
  state: 'idle' | 'starting' | 'ready' | 'failed';
  revision: number;
};

type DeviceStateChange = {
  ownerAddress: string;
  key: string;
  value: string | null;
  signedAt: number;
  expiresAt: number | null;
  source: 'local' | 'remote';
};

/**
 * The engine API is added by the Electron preload / mobile bridge; every call
 * is optional so a build without it simply behaves as "engine not ready".
 */
type EngineApi = {
  getReadinessStatus?: () => Promise<ReadinessStatus>;
  onReadinessChanged?: (cb: (status: ReadinessStatus) => void) => () => void;
  setDeviceState?: (
    ownerAddress: string,
    key: string,
    value: string | null,
    options?: { ttlMs?: number }
  ) => Promise<{ success: boolean; error?: string }>;
  getDeviceStates?: (
    ownerAddress: string,
    keyPrefix?: string
  ) => Promise<DeviceStateRecord[]>;
  onDeviceStateChanged?: (
    cb: (change: DeviceStateChange) => void
  ) => () => void;
};

function getEngine(): EngineApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { reticulumChat?: EngineApi }).reticulumChat;
}

type PendingPush = PublishItem & { attempts: number };

type ControllerOptions = {
  myAddress: string;
  getRules: () => SyncRule[];
  getSeenAll: () => number | null;
  setSeenAll: (ms: number) => void;
  translate: (key: string) => string;
};

class NotificationStateSyncController {
  private readonly cache = new Map<string, string | null>();
  private readonly pending = new Map<string, PendingPush>();
  private readonly preHydrateLocalKeys = new Set<string>();
  private preHydrateTombstones: PublishItem[] = [];
  private remoteBuffer: DeviceStateRecord[] = [];
  private remoteFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readinessTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeReadiness: (() => void) | null = null;
  private unsubscribeDeviceState: (() => void) | null = null;
  private localQueue: Promise<unknown> = Promise.resolve();
  private hydrated = false;
  private hydrating = false;
  private hydratedRevision = -1;
  private noticeChecked = false;
  private disposed = false;
  private lastSeenAll: number | null = null;
  private previousRuleValues = new Map<string, string>();
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(private readonly options: ControllerOptions) {}

  start(): void {
    this.lastSeenAll = this.options.getSeenAll();
    // Seed the rule baseline through the local queue so the first
    // `onRulesChanged` (fired on mount) diffs against it instead of an empty
    // map, and rule edits made before hydrate are recorded as local wins.
    this.enqueueLocal(async () => {
      if (this.hydrated || this.disposed) return;
      this.previousRuleValues = await this.ruleValueMap(
        this.options.getRules()
      );
    });
    this.subscribeBusEvents();
    this.subscribeEngine();
    this.checkReadiness();
    this.readinessTimer = setInterval(() => {
      if (!this.unsubscribeDeviceState) this.subscribeEngine();
      this.checkReadiness();
    }, READINESS_POLL_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.readinessTimer) clearInterval(this.readinessTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.remoteFlushTimer) clearTimeout(this.remoteFlushTimer);
    this.readinessTimer = null;
    this.retryTimer = null;
    this.remoteFlushTimer = null;
    this.unsubscribeReadiness?.();
    this.unsubscribeDeviceState?.();
    this.unsubscribeReadiness = null;
    this.unsubscribeDeviceState = null;
    for (const [name, listener] of this.listeners) {
      unsubscribeFromEvent(name, listener);
    }
    this.listeners.length = 0;
  }

  // -------------------------------------------------------------------------
  // Readiness / hydration
  // -------------------------------------------------------------------------

  private subscribeEngine(): void {
    const engine = getEngine();
    if (!engine) return;
    if (!this.unsubscribeReadiness && engine.onReadinessChanged) {
      try {
        this.unsubscribeReadiness = engine.onReadinessChanged((status) =>
          this.onReadiness(status)
        );
      } catch {
        this.unsubscribeReadiness = null;
      }
    }
    if (!this.unsubscribeDeviceState && engine.onDeviceStateChanged) {
      try {
        this.unsubscribeDeviceState = engine.onDeviceStateChanged((change) =>
          this.onDeviceStateChanged(change)
        );
      } catch {
        this.unsubscribeDeviceState = null;
      }
    }
  }

  private checkReadiness(): void {
    const engine = getEngine();
    if (!engine?.getReadinessStatus) return;
    engine
      .getReadinessStatus()
      .then((status) => this.onReadiness(status))
      .catch(() => undefined);
  }

  private onReadiness(status: ReadinessStatus | null | undefined): void {
    if (this.disposed || !status || status.state !== 'ready') return;
    const revision = Number(status.revision) || 0;
    if (this.hydrating || revision === this.hydratedRevision) return;
    void this.hydrate(revision);
  }

  private async hydrate(revision: number): Promise<void> {
    const engine = getEngine();
    if (!engine?.getDeviceStates) return;
    this.hydrating = true;
    try {
      const records = await engine.getDeviceStates(
        this.options.myAddress,
        NOTIF_STATE_PREFIX
      );
      if (this.disposed) return;
      if (!Array.isArray(records)) return;

      // The engine is the source of truth for the cache; local-only values
      // are pushed below once they are found to differ.
      this.cache.clear();
      for (const record of records) {
        if (!record || !isNotifStateKey(record.key)) continue;
        this.cache.set(
          record.key,
          canonicalCacheValue(record.key, record.value ?? null)
        );
      }

      // Local changes made while the engine was starting win over the stored
      // engine value for that key: skip those records, they are published
      // by the diff below instead.
      const skip = new Set<string>(this.preHydrateLocalKeys);
      for (const tomb of this.preHydrateTombstones) skip.add(tomb.key);
      const toApply = records.filter(
        (r) => r && isNotifStateKey(r.key) && !skip.has(r.key)
      );
      const applied = await this.applyRemoteRecords(toApply);
      if (this.disposed) return;

      this.hydrated = true;
      this.hydratedRevision = revision;
      this.previousRuleValues = await this.ruleValueMap(
        this.options.getRules()
      );

      // Explicit removals made while the engine was starting; skip the ones
      // the engine already holds as tombstones (for example rules dropped by
      // a remote permission revoke applied during this hydrate).
      const tombstones = this.preHydrateTombstones.filter(
        (item) => !this.cache.has(item.key) || this.cache.get(item.key) !== null
      );
      this.preHydrateTombstones = [];
      this.preHydrateLocalKeys.clear();
      await this.publish(tombstones);
      await this.pushLocalDiff();

      if (applied > 0) {
        executeEvent('notification-settings-changed', {});
        void this.maybeShowNotice();
      }
      if (this.remoteBuffer.length > 0) this.scheduleRemoteFlush();
    } catch (error) {
      console.warn('[notification-sync] hydrate failed:', error);
    } finally {
      this.hydrating = false;
    }
  }

  private async readLocalSnapshot(): Promise<LocalSnapshot> {
    const myAddress = this.options.myAddress;
    const permissions: LocalSnapshot['permissions'] = [];
    try {
      const perms = await getQortalRequestPermissions();
      for (const [key, value] of Object.entries(perms ?? {})) {
        const parsed = parseNotificationPermissionKey(key);
        if (!parsed || parsed.address !== myAddress) continue;
        if (value !== true && value !== false) continue;
        permissions.push({ appName: parsed.appName, granted: value === true });
      }
    } catch {
      /* ignore */
    }
    let osPushDisabled: Record<string, boolean> = {};
    try {
      const map = await getNotificationOsPushDisabledMap();
      for (const [app, disabled] of Object.entries(map ?? {})) {
        osPushDisabled[app] = disabled === true;
      }
    } catch {
      osPushDisabled = {};
    }
    let mentionsEnabled: boolean | null = null;
    try {
      mentionsEnabled = await getQChatMentionNotificationsEnabled();
    } catch {
      mentionsEnabled = null;
    }
    return {
      rules: this.options.getRules(),
      permissions,
      osPushDisabled,
      mentionsEnabled,
      seenAll: this.options.getSeenAll(),
      seenKeyTimes: getSeenInAppKeyTimesForAddress(myAddress),
    };
  }

  private async pushLocalDiff(): Promise<void> {
    const snapshot = await this.readLocalSnapshot();
    if (this.disposed) return;
    const desired = await buildDesiredState(snapshot);
    await this.publish(
      filterPublishItemsByLww(diffAgainstCache(desired, this.cache), this.cache)
    );
  }

  // -------------------------------------------------------------------------
  // Local → engine
  // -------------------------------------------------------------------------

  private async publish(items: PublishItem[]): Promise<void> {
    if (this.disposed || items.length === 0) return;
    for (const item of items) {
      this.cache.set(item.key, item.value);
      this.pending.delete(item.key);
      const ok = await this.trySetDeviceState(item);
      if (this.disposed) return;
      if (!ok) {
        this.pending.set(item.key, { ...item, attempts: 1 });
      }
    }
    if (this.pending.size > 0) this.scheduleRetry();
  }

  private async trySetDeviceState(item: PublishItem): Promise<boolean> {
    const engine = getEngine();
    if (!engine?.setDeviceState) return false;
    try {
      const options =
        typeof item.ttlMs === 'number' && item.ttlMs > 0
          ? { ttlMs: Math.floor(item.ttlMs) }
          : undefined;
      const result = await engine.setDeviceState(
        this.options.myAddress,
        item.key,
        item.value,
        options
      );
      if (result?.success) return true;
      if (result?.error === 'key-too-long') {
        console.warn('[notification-sync] value too large for', item.key);
        this.cache.delete(item.key);
        this.pending.delete(item.key);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryPending();
    }, PUSH_RETRY_MS);
  }

  private async retryPending(): Promise<void> {
    if (this.disposed) return;
    for (const [key, item] of Array.from(this.pending.entries())) {
      if (this.pending.get(key) !== item) continue;
      const ok = await this.trySetDeviceState(item);
      if (this.disposed) return;
      if (this.pending.get(key) !== item) continue;
      if (ok) {
        this.pending.delete(key);
      } else if (item.attempts + 1 >= PUSH_MAX_ATTEMPTS) {
        this.pending.delete(key);
        // Forget the optimistic cache entry so a later local change (or the
        // next hydrate) publishes it again.
        if (this.cache.get(key) === item.value) this.cache.delete(key);
        console.warn('[notification-sync] giving up on', key);
      } else {
        item.attempts += 1;
      }
    }
    if (this.pending.size > 0) this.scheduleRetry();
  }

  private enqueueLocal(task: () => Promise<void>): void {
    this.localQueue = this.localQueue
      .then(task, task)
      .catch((error) =>
        console.warn('[notification-sync] local change failed:', error)
      );
  }

  private async publishLocal(items: PublishItem[]): Promise<void> {
    if (this.disposed || items.length === 0) return;
    if (!this.hydrated) {
      // Before the engine is ready we only remember explicit removals and the
      // keys the user changed, so hydrate does not undo an edit made while
      // the engine was starting; the local diff that runs right after hydrate
      // publishes them. Seen keys need no protection (mark times merge).
      for (const item of items) {
        const kind = classifyStateKey(item.key);
        if (item.value === null) {
          this.preHydrateTombstones.push(item);
        } else if (
          kind === 'rule' ||
          kind === 'perm' ||
          kind === 'ospush' ||
          kind === 'mentions' ||
          kind === 'seenall'
        ) {
          this.preHydrateLocalKeys.add(item.key);
        }
      }
      return;
    }
    const changed = items.filter(
      (item) =>
        !this.cache.has(item.key) || this.cache.get(item.key) !== item.value
    );
    await this.publish(filterPublishItemsByLww(changed, this.cache));
  }

  private async ruleValueMap(rules: SyncRule[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const rule of rules ?? []) {
      const entry = await desiredRuleEntry(rule);
      if (entry) out.set(entry.key, entry.value);
    }
    return out;
  }

  onRulesChanged(rules: SyncRule[]): void {
    this.enqueueLocal(async () => {
      // Runs before hydrate too: the changed keys are then recorded so the
      // engine's older copy is not applied over the local edit.
      const next = await this.ruleValueMap(rules);
      if (this.disposed) return;
      const items: PublishItem[] = [];
      for (const [key, value] of next) {
        if (this.previousRuleValues.get(key) !== value) {
          items.push({ key, value });
        }
      }
      this.previousRuleValues = next;
      // Adds and updates only — a rule missing from the list is never a
      // tombstone; those come from `custom-ws-subscriptions-removed`.
      await this.publishLocal(items);
    });
  }

  onSeenAllChanged(value: number | null): void {
    const previous = this.lastSeenAll;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (previous != null && value <= previous) return;
    this.lastSeenAll = value;
    this.enqueueLocal(async () => {
      await this.publishLocal([
        { key: NOTIF_SEENALL_KEY, value: serialiseSeenAll(value) },
      ]);
    });
  }

  private subscribeBusEvents(): void {
    const myAddress = this.options.myAddress;
    const on = (name: string, handler: (detail: any) => void) => {
      const listener = ((event: CustomEvent) => {
        handler(event?.detail);
      }) as EventListener;
      subscribeToEvent(name, listener);
      this.listeners.push([name, listener]);
    };

    on('custom-ws-subscriptions-removed', (detail) => {
      if (!detail || detail.address !== myAddress) return;
      const items = Array.isArray(detail.items) ? detail.items : [];
      if (items.length === 0) return;
      this.enqueueLocal(async () => {
        await this.publishLocal(await tombstonesForRemovals(items));
      });
    });

    on('notification-permission-updated', (detail) => {
      const parsed = parseNotificationPermissionKey(detail?.key);
      if (!parsed || parsed.address !== myAddress) return;
      const value = detail?.value;
      if (value !== true && value !== false) return;
      this.enqueueLocal(async () => {
        const items: PublishItem[] = [
          {
            key: await permStateKey(parsed.appName),
            value: serialiseFlag(value ? 1 : 0, parsed.appName),
          },
        ];
        if (!value) {
          const rules = this.options
            .getRules()
            .filter((r) => normalizeAppName(r?.appName) === parsed.appName);
          // A revoke applied from a remote record fires this listener too;
          // the remote device already published those rule tombstones, so
          // skip the keys the engine is known to hold as null.
          items.push(
            ...(await tombstonesForRemovals(rules)).filter(
              (item) =>
                !this.cache.has(item.key) || this.cache.get(item.key) !== null
            )
          );
        }
        await this.publishLocal(items);
      });
    });

    on('notification-os-push-updated', (detail) => {
      const appName = normalizeAppName(detail?.appName);
      if (!appName) return;
      const disabled = detail?.disabled === true;
      this.enqueueLocal(async () => {
        await this.publishLocal([
          {
            key: await osPushStateKey(appName),
            value: serialiseFlag(disabled ? 1 : 0, appName),
          },
        ]);
      });
    });

    on(QCHAT_MENTION_NOTIFICATIONS_UPDATED_EVENT, (detail) => {
      if (typeof detail?.enabled !== 'boolean') return;
      const enabled = detail.enabled;
      this.enqueueLocal(async () => {
        await this.publishLocal([
          { key: NOTIF_MENTIONS_KEY, value: serialiseMentions(enabled) },
        ]);
      });
    });

    on('notification-seen-in-app-updated', (detail) => {
      if (!detail || detail.address !== myAddress) return;
      const keyTimes = detail.keyTimes;
      if (!keyTimes || typeof keyTimes !== 'object') return;
      this.enqueueLocal(async () => {
        const items: PublishItem[] = [];
        const now = Date.now();
        for (const [fullKey, markTime] of Object.entries(keyTimes)) {
          const entry = await desiredSeenEntry(fullKey, Number(markTime), now);
          if (entry) items.push({ key: entry.key, ...entry.entry });
        }
        await this.publishLocal(items);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Engine → local
  // -------------------------------------------------------------------------

  private onDeviceStateChanged(change: DeviceStateChange): void {
    if (this.disposed || !change) return;
    if (change.ownerAddress !== this.options.myAddress) return;
    if (!isNotifStateKey(change.key)) return;
    if (change.source === 'local') {
      // Our own publish; the cache was set when it was queued.
      if (!this.cache.has(change.key)) {
        this.cache.set(
          change.key,
          canonicalCacheValue(change.key, change.value ?? null)
        );
      }
      return;
    }
    this.remoteBuffer.push({
      key: change.key,
      value: change.value ?? null,
      signedAt: change.signedAt,
      expiresAt: change.expiresAt ?? null,
    });
    if (this.hydrated) this.scheduleRemoteFlush();
  }

  private scheduleRemoteFlush(): void {
    if (this.remoteFlushTimer || this.disposed) return;
    this.remoteFlushTimer = setTimeout(() => {
      this.remoteFlushTimer = null;
      this.enqueueLocal(() => this.flushRemote());
    }, REMOTE_BATCH_MS);
  }

  private async flushRemote(): Promise<void> {
    if (this.disposed || !this.hydrated) return;
    const batch = this.remoteBuffer;
    this.remoteBuffer = [];
    if (batch.length === 0) return;
    const byKey = new Map<string, DeviceStateRecord>();
    for (const record of batch) byKey.set(record.key, record);
    const records = Array.from(byKey.values());
    for (const record of records) {
      this.cache.set(record.key, canonicalCacheValue(record.key, record.value));
      // A remote value supersedes a local publish that never got through.
      this.pending.delete(record.key);
    }
    const applied = await this.applyRemoteRecords(records);
    if (this.disposed) return;
    this.previousRuleValues = await this.ruleValueMap(this.options.getRules());
    if (applied > 0) {
      executeEvent('notification-settings-changed', {});
      void this.maybeShowNotice();
    }
  }

  private async applyRemoteRecords(
    records: DeviceStateRecord[]
  ): Promise<number> {
    if (records.length === 0) return 0;
    const snapshot = await this.readLocalSnapshot();
    if (this.disposed) return 0;
    const localRules: Array<{ rule: SyncRule; key: string }> = [];
    for (const rule of snapshot.rules) {
      try {
        localRules.push({ rule, key: await ruleStateKey(rule) });
      } catch {
        /* skip malformed rule */
      }
    }
    const enginePermFlags = new Map<string, 0 | 1>();
    for (const [key, value] of this.cache) {
      if (classifyStateKey(key) !== 'perm') continue;
      const flag = parseFlagValue(value);
      if (flag) enginePermFlags.set(key, flag.flag);
    }
    const rawPlan = await planRemoteApply(records, {
      localRules,
      localSeenAll: snapshot.seenAll,
      enginePermFlags,
    });
    const plan = await prunePlanAgainstLocal(rawPlan, snapshot, localRules);
    if (isPlanEmpty(plan)) return 0;
    return executeRemotePlan(plan, this.remoteDeps());
  }

  private remoteDeps(): RemoteApplyDeps {
    const myAddress = this.options.myAddress;
    return {
      getPermission: async (appName) => {
        const value = await getPermission(
          getNotificationPermissionKey(appName, myAddress)
        );
        return value === true ? true : value === false ? false : null;
      },
      setPermission: async (appName, granted) => {
        await setPermission(
          getNotificationPermissionKey(appName, myAddress),
          granted
        );
      },
      reconnectNotifications: () => {
        executeEvent('notifications-websocket-reconnect', undefined);
      },
      getEngineRulesForApp: async (appName) => {
        const engine = getEngine();
        if (!engine?.getDeviceStates) return [];
        const records = await engine.getDeviceStates(
          myAddress,
          NOTIF_RULE_PREFIX
        );
        if (!Array.isArray(records)) return [];
        const rules: SyncRule[] = [];
        for (const record of records) {
          if (!record || record.value == null) continue;
          const rule = parseRuleValue(record.value);
          if (!rule || rule.appName !== normalizeAppName(appName)) continue;
          this.cache.set(
            record.key,
            canonicalCacheValue(record.key, record.value)
          );
          rules.push(rule);
        }
        return rules;
      },
      applyRules: async (upserts, removals) => {
        await applySyncedCustomSubscriptions(myAddress, upserts, removals);
      },
      unsubscribeRules: (removals: RuleRef[]) => {
        executeEvent('custom-ws-unsubscribe', removals);
      },
      setOsPushDisabled: async (appName, disabled) => {
        await setNotificationOsPushDisabled(appName, disabled);
      },
      setMentionsEnabled: async (enabled) => {
        await setQChatMentionNotificationsEnabled(enabled);
      },
      setSeenAll: (ms) => {
        this.lastSeenAll = Math.max(this.lastSeenAll ?? 0, ms);
        this.options.setSeenAll(ms);
      },
      addSeenEntries: (entries) => {
        addSeenInAppKeysForAddress(myAddress, entries);
      },
    };
  }

  private async maybeShowNotice(): Promise<void> {
    if (this.noticeChecked || this.disposed) return;
    this.noticeChecked = true;
    try {
      const shown = await window
        .sendMessage?.('getUserSettings', { key: SYNC_NOTICE_SETTING_KEY })
        .catch(() => null);
      if (shown === true || this.disposed) return;
      executeEvent('openGlobalSnackBar', {
        message: this.options.translate(
          'core:message.generic.notification_sync_arrived'
        ),
        type: 'info',
        duration: 6000,
      });
      await window.sendMessage?.('addUserSettings', {
        keyValue: { key: SYNC_NOTICE_SETTING_KEY, value: true },
      });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Mounted once for the authenticated user. Keeps the Q-app notification state
 * of this device in step with the user's other devices through the Reticulum
 * chat engine's device-state records (see `utils/notificationStateSync.ts`).
 */
export function NotificationStateSync({
  myAddress,
}: {
  myAddress?: string | null;
}) {
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const rules = useAtomValue(customWebsocketSubscriptionsAtom);
  const seenAll = useAtomValue(lastPaymentSeenTimestampAtom);
  const setSeenAll = useSetAtom(lastPaymentSeenTimestampAtom);
  const { t } = useTranslation(['core']);

  const rulesRef = useRef(rules);
  const seenAllRef = useRef(seenAll);
  const setSeenAllRef = useRef(setSeenAll);
  const tRef = useRef(t);
  const controllerRef = useRef<NotificationStateSyncController | null>(null);
  rulesRef.current = rules;
  seenAllRef.current = seenAll;
  setSeenAllRef.current = setSeenAll;
  tRef.current = t;

  useEffect(() => {
    if (!myAddress || !reticulumChatEnabled) return;
    const controller = new NotificationStateSyncController({
      myAddress,
      getRules: () => (rulesRef.current ?? []) as SyncRule[],
      getSeenAll: () => seenAllRef.current ?? null,
      setSeenAll: (ms) => {
        const current = seenAllRef.current;
        if (typeof current === 'number' && current >= ms) return;
        setSeenAllRef.current(ms);
      },
      translate: (key) => tRef.current(key),
    });
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [myAddress, reticulumChatEnabled]);

  useEffect(() => {
    controllerRef.current?.onRulesChanged((rules ?? []) as SyncRule[]);
  }, [rules]);

  useEffect(() => {
    controllerRef.current?.onSeenAllChanged(seenAll ?? null);
  }, [seenAll]);

  return null;
}
