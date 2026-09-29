/**
 * Cross-device notification state sync (pure logic).
 *
 * Q-app / website notification state is mirrored between the user's own
 * devices (Qortal Hub ⇄ Qortal GO) through the Reticulum chat engine's
 * device-state records (`window.reticulumChat.setDeviceState` & co). The
 * owner of every record is the current account address, and the key layout
 * is (keys are ≤ 48 chars, so anything containing a name is hashed with
 * sha256 hex truncated to 24 chars):
 *
 * | key                                                | value                              |
 * |----------------------------------------------------|------------------------------------|
 * | notif.rule.<h(appService|appName|notificationId)>  | JSON of the stored subscription    |
 * |                                                    | (tombstone `null` on removal)      |
 * | notif.perm.<h(appName)>                            | JSON [flag, appName], 1 = granted  |
 * | notif.ospush.<h(appName)>                          | JSON [flag, appName], 1 = disabled |
 * | notif.mentions                                     | "1" enabled / "0" disabled         |
 * | notif.seenall                                      | "<ms>" (apply only if greater)     |
 * | notif.seen.<h(fullKey)>                            | JSON [markTimeMs, fullKey], 4d TTL |
 *
 * Out of scope (deliberately not synced): `disable-push-notifications` (a
 * device preference), `mutedGroups` (legacy on-chain path) and
 * `appUpdateSeenVersionAtom` (per install).
 *
 * The OS-push map has no address dimension locally, so it is published and
 * applied only while the record owner is the current account; a change made
 * under one account still bleeds into the other accounts of that device, the
 * same way it does without sync.
 *
 * This module holds only the pure parts (keys, serialisation, diffing, apply
 * planning and ordering) so they can be unit tested; the React component
 * `NotificationStateSync` wires them to storage, the event bus and the engine.
 */

export const NOTIF_STATE_PREFIX = 'notif.';
export const NOTIF_RULE_PREFIX = 'notif.rule.';
export const NOTIF_PERM_PREFIX = 'notif.perm.';
export const NOTIF_OSPUSH_PREFIX = 'notif.ospush.';
export const NOTIF_MENTIONS_KEY = 'notif.mentions';
export const NOTIF_SEENALL_KEY = 'notif.seenall';
export const NOTIF_SEEN_PREFIX = 'notif.seen.';

/** Seen keys are only kept 3 days locally; the record outlives that slightly. */
export const NOTIF_SEEN_TTL_MS = 4 * 24 * 60 * 60 * 1000;
const NOTIF_SEEN_MIN_TTL_MS = 60_000;
/** Engine limit for a device-state value (UTF-8 bytes). */
export const NOTIF_MAX_VALUE_BYTES = 2048;
export const NOTIF_HASH_LENGTH = 24;

export const RESOURCE_PUBLISHED_EVENT = 'RESOURCE_PUBLISHED';

export type NotifStateKind =
  | 'perm'
  | 'rule'
  | 'ospush'
  | 'mentions'
  | 'seenall'
  | 'seen';

/** Order in which remote records are applied (permissions gate rules). */
export const NOTIF_APPLY_ORDER: NotifStateKind[] = [
  'perm',
  'rule',
  'ospush',
  'mentions',
  'seenall',
  'seen',
];

export type RuleRef = {
  notificationId: string;
  appName: string;
  appService: string;
};

export type SyncRule = RuleRef & {
  event: string;
  resourceFilter?: Record<string, unknown>;
  image?: string;
  link?: string;
  message?: Record<string, string>;
};

export type DeviceStateRecord = {
  key: string;
  value: string | null;
  signedAt?: number;
  expiresAt?: number | null;
};

export type DesiredEntry = { value: string; ttlMs?: number };

export type LocalSnapshot = {
  rules: SyncRule[];
  /** Explicit grants (true) and revocations (false) of the current address. */
  permissions: Array<{ appName: string; granted: boolean }>;
  /** appName → OS push disabled. */
  osPushDisabled: Record<string, boolean>;
  mentionsEnabled: boolean | null;
  seenAll: number | null;
  /** seen-in-app key → mark time (ms). */
  seenKeyTimes: Record<string, number>;
};

export type RemoteApplyPlan = {
  permissions: Array<{ appName: string; granted: boolean }>;
  ruleUpserts: SyncRule[];
  ruleRemovals: RuleRef[];
  osPush: Array<{ appName: string; disabled: boolean }>;
  mentionsEnabled: boolean | null;
  seenAll: number | null;
  seenEntries: Array<[number, string]>;
};

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

const utf8Encoder = new TextEncoder();

function getSubtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle ?? null;
}

/** sha256 hex of a UTF-8 string, truncated to NOTIF_HASH_LENGTH chars. */
export async function hashForStateKey(input: string): Promise<string> {
  const subtle = getSubtle();
  if (!subtle) {
    throw new Error('crypto.subtle unavailable');
  }
  const digest = await subtle.digest('SHA-256', utf8Encoder.encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length && hex.length < NOTIF_HASH_LENGTH; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, NOTIF_HASH_LENGTH);
}

export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function normalizeAppName(appName: unknown): string {
  return String(appName ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeRuleRef(ref: {
  notificationId?: unknown;
  appName?: unknown;
  appService?: unknown;
}): RuleRef {
  return {
    notificationId: String(ref?.notificationId ?? '').trim(),
    appName: normalizeAppName(ref?.appName),
    appService: String(ref?.appService ?? 'APP') || 'APP',
  };
}

/** `appService|appName|notificationId` — the hashed identity of a rule. */
export function ruleIdentity(ref: RuleRef): string {
  const n = normalizeRuleRef(ref);
  return `${n.appService}|${n.appName}|${n.notificationId}`;
}

export async function ruleStateKey(ref: RuleRef): Promise<string> {
  return NOTIF_RULE_PREFIX + (await hashForStateKey(ruleIdentity(ref)));
}

export async function permStateKey(appName: string): Promise<string> {
  return NOTIF_PERM_PREFIX + (await hashForStateKey(normalizeAppName(appName)));
}

export async function osPushStateKey(appName: string): Promise<string> {
  return (
    NOTIF_OSPUSH_PREFIX + (await hashForStateKey(normalizeAppName(appName)))
  );
}

export async function seenStateKey(fullKey: string): Promise<string> {
  return NOTIF_SEEN_PREFIX + (await hashForStateKey(fullKey));
}

export function classifyStateKey(key: string): NotifStateKind | null {
  if (typeof key !== 'string') return null;
  if (key === NOTIF_MENTIONS_KEY) return 'mentions';
  if (key === NOTIF_SEENALL_KEY) return 'seenall';
  if (key.startsWith(NOTIF_RULE_PREFIX)) return 'rule';
  if (key.startsWith(NOTIF_PERM_PREFIX)) return 'perm';
  if (key.startsWith(NOTIF_OSPUSH_PREFIX)) return 'ospush';
  if (key.startsWith(NOTIF_SEEN_PREFIX)) return 'seen';
  return null;
}

export function isNotifStateKey(key: unknown): key is string {
  return typeof key === 'string' && classifyStateKey(key) !== null;
}

// ---------------------------------------------------------------------------
// Serialisation (canonical, so equal state always yields equal strings)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sortedObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v === undefined) continue;
    out[key] = isPlainObject(v) ? sortedObject(v) : v;
  }
  return out;
}

/** Canonical JSON of a stored subscription object. */
export function serialiseRule(rule: SyncRule): string {
  const ref = normalizeRuleRef(rule);
  const payload: Record<string, unknown> = {
    event:
      typeof rule.event === 'string' ? rule.event : RESOURCE_PUBLISHED_EVENT,
    resourceFilter: isPlainObject(rule.resourceFilter)
      ? sortedObject(rule.resourceFilter)
      : {},
    link: typeof rule.link === 'string' ? rule.link : '',
    notificationId: ref.notificationId,
    appName: ref.appName,
    appService: ref.appService,
    message: isPlainObject(rule.message) ? sortedObject(rule.message) : {},
  };
  if (typeof rule.image === 'string' && rule.image) payload.image = rule.image;
  return JSON.stringify(payload);
}

export function parseRuleValue(
  value: string | null | undefined
): SyncRule | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) return null;
    const ref = normalizeRuleRef(parsed as RuleRef);
    if (!ref.notificationId || !ref.appName) return null;
    const rule: SyncRule = {
      event:
        typeof parsed.event === 'string' && parsed.event
          ? parsed.event
          : RESOURCE_PUBLISHED_EVENT,
      resourceFilter: isPlainObject(parsed.resourceFilter)
        ? { ...parsed.resourceFilter }
        : {},
      link: typeof parsed.link === 'string' ? parsed.link : '',
      notificationId: ref.notificationId,
      appName: ref.appName,
      appService: ref.appService,
      message: isPlainObject(parsed.message)
        ? ({ ...parsed.message } as Record<string, string>)
        : {},
    };
    if (typeof parsed.image === 'string' && parsed.image) {
      rule.image = parsed.image;
    }
    return rule;
  } catch {
    return null;
  }
}

export function serialiseFlag(flag: 0 | 1, appName: string): string {
  return JSON.stringify([flag, normalizeAppName(appName)]);
}

export function parseFlagValue(
  value: string | null | undefined
): { flag: 0 | 1; appName: string } | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    const flag = Number(parsed[0]);
    const appName = normalizeAppName(parsed[1]);
    if ((flag !== 0 && flag !== 1) || !appName) return null;
    return { flag: flag as 0 | 1, appName };
  } catch {
    return null;
  }
}

export function serialiseMentions(enabled: boolean): string {
  return enabled ? '1' : '0';
}

export function parseMentionsValue(
  value: string | null | undefined
): boolean | null {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export function serialiseSeenAll(ms: number): string {
  return String(Math.floor(ms));
}

export function parseSeenAllValue(
  value: string | null | undefined
): number | null {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function serialiseSeen(markTimeMs: number, fullKey: string): string {
  return JSON.stringify([Math.floor(markTimeMs), fullKey]);
}

export function parseSeenValue(
  value: string | null | undefined
): { markTime: number; fullKey: string } | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    const markTime = Number(parsed[0]);
    const fullKey = parsed[1];
    if (!Number.isSafeInteger(markTime) || markTime <= 0) return null;
    if (typeof fullKey !== 'string' || !fullKey) return null;
    return { markTime, fullKey };
  } catch {
    return null;
  }
}

/**
 * The value the cache should hold for an engine record: rules are re-encoded
 * canonically so a locally re-serialised rule compares equal to the cached
 * remote one (and never echoes back to the engine).
 */
export function canonicalCacheValue(
  key: string,
  value: string | null
): string | null {
  if (value == null) return null;
  if (classifyStateKey(key) === 'rule') {
    const rule = parseRuleValue(value);
    return rule ? serialiseRule(rule) : value;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local → engine: desired state and diff
// ---------------------------------------------------------------------------

/** Every record the engine should hold for the given local state. */
export async function buildDesiredState(
  snapshot: LocalSnapshot,
  now: number = Date.now()
): Promise<Map<string, DesiredEntry>> {
  const desired = new Map<string, DesiredEntry>();
  for (const rule of snapshot.rules ?? []) {
    const entry = await desiredRuleEntry(rule);
    if (entry) desired.set(entry.key, { value: entry.value });
  }
  for (const perm of snapshot.permissions ?? []) {
    const appName = normalizeAppName(perm.appName);
    if (!appName) continue;
    desired.set(await permStateKey(appName), {
      value: serialiseFlag(perm.granted ? 1 : 0, appName),
    });
  }
  for (const [rawApp, disabled] of Object.entries(
    snapshot.osPushDisabled ?? {}
  )) {
    const appName = normalizeAppName(rawApp);
    if (!appName) continue;
    desired.set(await osPushStateKey(appName), {
      value: serialiseFlag(disabled ? 1 : 0, appName),
    });
  }
  if (typeof snapshot.mentionsEnabled === 'boolean') {
    desired.set(NOTIF_MENTIONS_KEY, {
      value: serialiseMentions(snapshot.mentionsEnabled),
    });
  }
  if (typeof snapshot.seenAll === 'number' && snapshot.seenAll > 0) {
    desired.set(NOTIF_SEENALL_KEY, {
      value: serialiseSeenAll(snapshot.seenAll),
    });
  }
  for (const [fullKey, markTime] of Object.entries(
    snapshot.seenKeyTimes ?? {}
  )) {
    const entry = await desiredSeenEntry(fullKey, markTime, now);
    if (entry) desired.set(entry.key, entry.entry);
  }
  return desired;
}

export async function desiredRuleEntry(
  rule: SyncRule
): Promise<{ key: string; value: string } | null> {
  const ref = normalizeRuleRef(rule);
  if (!ref.notificationId || !ref.appName) return null;
  const value = serialiseRule(rule);
  if (utf8ByteLength(value) > NOTIF_MAX_VALUE_BYTES) return null;
  return { key: await ruleStateKey(ref), value };
}

export async function desiredSeenEntry(
  fullKey: string,
  markTime: number,
  now: number = Date.now()
): Promise<{ key: string; entry: DesiredEntry } | null> {
  if (typeof fullKey !== 'string' || !fullKey) return null;
  if (typeof markTime !== 'number' || !Number.isFinite(markTime)) return null;
  const remaining = markTime + NOTIF_SEEN_TTL_MS - now;
  // The engine rejects TTLs under a minute (its signing clock may run ahead
  // of the wall clock); an entry that close to expiry is not worth syncing.
  if (remaining < NOTIF_SEEN_MIN_TTL_MS) return null;
  const value = serialiseSeen(markTime, fullKey);
  if (utf8ByteLength(value) > NOTIF_MAX_VALUE_BYTES) return null;
  return {
    key: await seenStateKey(fullKey),
    entry: { value, ttlMs: remaining },
  };
}

export type PublishItem = { key: string; value: string | null; ttlMs?: number };

/**
 * Entries whose value differs from what the engine holds (cache). Absence in
 * the cache counts as different; keys missing from `desired` are NEVER
 * tombstoned here — tombstones only come from explicit removals.
 */
export function diffAgainstCache(
  desired: Map<string, DesiredEntry>,
  cache: Map<string, string | null>
): PublishItem[] {
  const out: PublishItem[] = [];
  for (const [key, entry] of desired) {
    if (!cache.has(key) || cache.get(key) !== entry.value) {
      out.push({ key, value: entry.value, ttlMs: entry.ttlMs });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine → local: ordering and apply plan
// ---------------------------------------------------------------------------

export function sortRecordsForApply<T extends { key: string }>(
  records: T[]
): T[] {
  const rank = (key: string) => {
    const kind = classifyStateKey(key);
    const idx = kind ? NOTIF_APPLY_ORDER.indexOf(kind) : -1;
    return idx < 0 ? NOTIF_APPLY_ORDER.length : idx;
  };
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const d = rank(a.record.key) - rank(b.record.key);
      return d !== 0 ? d : a.index - b.index;
    })
    .map((x) => x.record);
}

export type PlanContext = {
  /** Rules currently stored locally, with their state keys. */
  localRules: Array<{ rule: SyncRule; key: string }>;
  localSeenAll: number | null;
  /**
   * Permission flags the engine holds (perm key → flag), for rule records that
   * arrive without their perm record in the same batch. Records in the batch
   * take precedence over this map.
   */
  enginePermFlags?: Map<string, 0 | 1>;
  now?: number;
};

/**
 * Turn a batch of remote records into local actions, in apply order. Rule
 * records of apps whose permission is `0` (in the batch or in the engine) are
 * skipped, and a `0` permission also removes that app's local rules.
 */
export async function planRemoteApply(
  records: DeviceStateRecord[],
  ctx: PlanContext
): Promise<RemoteApplyPlan> {
  const now = ctx.now ?? Date.now();
  const plan: RemoteApplyPlan = {
    permissions: [],
    ruleUpserts: [],
    ruleRemovals: [],
    osPush: [],
    mentionsEnabled: null,
    seenAll: null,
    seenEntries: [],
  };
  const sorted = sortRecordsForApply(
    (records ?? []).filter(
      (r) =>
        r &&
        isNotifStateKey(r.key) &&
        (r.expiresAt == null || r.expiresAt > now)
    )
  );
  const permFlagByKey = new Map<string, 0 | 1>(ctx.enginePermFlags ?? []);
  const revokedApps = new Set<string>();
  const removalIds = new Set<string>();
  const addRemoval = (ref: RuleRef) => {
    const id = ruleIdentity(ref);
    if (removalIds.has(id)) return;
    removalIds.add(id);
    plan.ruleRemovals.push(normalizeRuleRef(ref));
  };

  for (const record of sorted) {
    const kind = classifyStateKey(record.key);
    switch (kind) {
      case 'perm': {
        const flag = parseFlagValue(record.value);
        if (!flag) break;
        permFlagByKey.set(record.key, flag.flag);
        plan.permissions.push({
          appName: flag.appName,
          granted: flag.flag === 1,
        });
        if (flag.flag === 0) {
          revokedApps.add(flag.appName);
          for (const local of ctx.localRules) {
            if (normalizeAppName(local.rule.appName) === flag.appName) {
              addRemoval(local.rule);
            }
          }
        }
        break;
      }
      case 'rule': {
        if (record.value == null) {
          const local = ctx.localRules.find((l) => l.key === record.key);
          if (local) addRemoval(local.rule);
          break;
        }
        const rule = parseRuleValue(record.value);
        if (!rule) break;
        if (revokedApps.has(rule.appName)) break;
        const permKey = await permStateKey(rule.appName);
        if (permFlagByKey.get(permKey) === 0) break;
        plan.ruleUpserts.push(rule);
        break;
      }
      case 'ospush': {
        const flag = parseFlagValue(record.value);
        if (!flag) break;
        plan.osPush.push({ appName: flag.appName, disabled: flag.flag === 1 });
        break;
      }
      case 'mentions': {
        const enabled = parseMentionsValue(record.value);
        if (enabled !== null) plan.mentionsEnabled = enabled;
        break;
      }
      case 'seenall': {
        const ms = parseSeenAllValue(record.value);
        if (ms == null) break;
        const local = ctx.localSeenAll ?? 0;
        if (ms > local && ms > (plan.seenAll ?? 0)) plan.seenAll = ms;
        break;
      }
      case 'seen': {
        const seen = parseSeenValue(record.value);
        if (!seen) break;
        plan.seenEntries.push([seen.markTime, seen.fullKey]);
        break;
      }
      default:
        break;
    }
  }
  return plan;
}

/**
 * Drop plan items that would not change local state, so `executeRemotePlan`
 * only touches storage (and the "arrived from another device" notice only
 * fires) for real changes.
 */
export async function prunePlanAgainstLocal(
  plan: RemoteApplyPlan,
  snapshot: LocalSnapshot,
  localRules: Array<{ rule: SyncRule; key: string }>
): Promise<RemoteApplyPlan> {
  const localRuleValueById = new Map<string, string>();
  for (const local of localRules) {
    localRuleValueById.set(ruleIdentity(local.rule), serialiseRule(local.rule));
  }
  const localPermByApp = new Map<string, boolean>();
  for (const perm of snapshot.permissions ?? []) {
    localPermByApp.set(normalizeAppName(perm.appName), perm.granted);
  }
  return {
    permissions: plan.permissions.filter(
      (p) => localPermByApp.get(normalizeAppName(p.appName)) !== p.granted
    ),
    ruleUpserts: plan.ruleUpserts.filter(
      (rule) =>
        localRuleValueById.get(ruleIdentity(rule)) !== serialiseRule(rule)
    ),
    ruleRemovals: plan.ruleRemovals.filter((ref) =>
      localRuleValueById.has(ruleIdentity(ref))
    ),
    osPush: plan.osPush.filter(
      (item) =>
        (snapshot.osPushDisabled?.[item.appName] === true) !== item.disabled
    ),
    mentionsEnabled:
      plan.mentionsEnabled === null ||
      plan.mentionsEnabled === snapshot.mentionsEnabled
        ? null
        : plan.mentionsEnabled,
    seenAll:
      plan.seenAll !== null && plan.seenAll > (snapshot.seenAll ?? 0)
        ? plan.seenAll
        : null,
    seenEntries: plan.seenEntries.filter(([markTime, fullKey]) => {
      const local = snapshot.seenKeyTimes?.[fullKey];
      return typeof local !== 'number' || local < markTime;
    }),
  };
}

/**
 * Keys with a time semantic (seen-all, seen keys) are only published when the
 * local time is newer than what the engine holds, so an older local value can
 * never overwrite a newer remote one.
 */
export function filterPublishItemsByLww(
  items: PublishItem[],
  cache: Map<string, string | null>
): PublishItem[] {
  return items.filter((item) => {
    if (item.value === null) return true;
    const kind = classifyStateKey(item.key);
    const cached = cache.get(item.key);
    if (cached == null) return true;
    if (kind === 'seenall') {
      const local = parseSeenAllValue(item.value) ?? 0;
      const remote = parseSeenAllValue(cached) ?? 0;
      return local > remote;
    }
    if (kind === 'seen') {
      const local = parseSeenValue(item.value)?.markTime ?? 0;
      const remote = parseSeenValue(cached)?.markTime ?? 0;
      return local > remote;
    }
    return true;
  });
}

export function isPlanEmpty(plan: RemoteApplyPlan): boolean {
  return (
    plan.permissions.length === 0 &&
    plan.ruleUpserts.length === 0 &&
    plan.ruleRemovals.length === 0 &&
    plan.osPush.length === 0 &&
    plan.mentionsEnabled === null &&
    plan.seenAll === null &&
    plan.seenEntries.length === 0
  );
}

/** Side-effect hooks the component supplies to execute a plan, in order. */
export type RemoteApplyDeps = {
  /** Current local permission value for an app (true/false/null). */
  getPermission: (appName: string) => Promise<boolean | null>;
  setPermission: (appName: string, granted: boolean) => Promise<void>;
  /** Called after a permission grant so the socket re-evaluates its filter. */
  reconnectNotifications: () => void;
  /** Rules the engine holds for an app (used after a grant to pick up rules dropped earlier). */
  getEngineRulesForApp?: (appName: string) => Promise<SyncRule[]>;
  applyRules: (upserts: SyncRule[], removals: RuleRef[]) => Promise<void>;
  unsubscribeRules: (removals: RuleRef[]) => void;
  setOsPushDisabled: (appName: string, disabled: boolean) => Promise<void>;
  setMentionsEnabled: (enabled: boolean) => Promise<void>;
  setSeenAll: (ms: number) => void;
  addSeenEntries: (entries: Array<[number, string]>) => void;
};

/**
 * Execute a plan: permissions, then rules, then OS push, mentions, seen-all
 * and finally seen keys (rules are awaited first because the notifications
 * socket prunes seen keys whose rule is not in the atom yet).
 * Returns the number of records that changed local state.
 */
export async function executeRemotePlan(
  plan: RemoteApplyPlan,
  deps: RemoteApplyDeps
): Promise<number> {
  let applied = 0;
  const upserts = [...plan.ruleUpserts];
  const upsertIds = new Set(upserts.map(ruleIdentity));

  for (const perm of plan.permissions) {
    const current = await deps.getPermission(perm.appName).catch(() => null);
    if (current === perm.granted) continue;
    await deps.setPermission(perm.appName, perm.granted);
    applied += 1;
    if (perm.granted) {
      deps.reconnectNotifications();
      if (deps.getEngineRulesForApp) {
        const extra = await deps
          .getEngineRulesForApp(perm.appName)
          .catch(() => [] as SyncRule[]);
        for (const rule of extra) {
          const id = ruleIdentity(rule);
          if (upsertIds.has(id)) continue;
          upsertIds.add(id);
          upserts.push(rule);
        }
      }
    }
  }

  if (upserts.length > 0 || plan.ruleRemovals.length > 0) {
    await deps.applyRules(upserts, plan.ruleRemovals);
    if (plan.ruleRemovals.length > 0) {
      deps.unsubscribeRules(plan.ruleRemovals);
    }
    applied += upserts.length + plan.ruleRemovals.length;
  }

  for (const item of plan.osPush) {
    await deps.setOsPushDisabled(item.appName, item.disabled);
    applied += 1;
  }

  if (plan.mentionsEnabled !== null) {
    await deps.setMentionsEnabled(plan.mentionsEnabled);
    applied += 1;
  }

  if (plan.seenAll !== null) {
    deps.setSeenAll(plan.seenAll);
    applied += 1;
  }

  if (plan.seenEntries.length > 0) {
    deps.addSeenEntries(plan.seenEntries);
    applied += plan.seenEntries.length;
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Tombstones (explicit removals only)
// ---------------------------------------------------------------------------

export async function tombstonesForRemovals(
  removals: RuleRef[]
): Promise<PublishItem[]> {
  const out: PublishItem[] = [];
  const seen = new Set<string>();
  for (const ref of removals ?? []) {
    const n = normalizeRuleRef(ref);
    if (!n.notificationId || !n.appName) continue;
    const key = await ruleStateKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, value: null });
  }
  return out;
}
