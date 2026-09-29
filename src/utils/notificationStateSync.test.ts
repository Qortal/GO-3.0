import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildDesiredState,
  canonicalCacheValue,
  classifyStateKey,
  diffAgainstCache,
  executeRemotePlan,
  filterPublishItemsByLww,
  hashForStateKey,
  NOTIF_HASH_LENGTH,
  NOTIF_MENTIONS_KEY,
  NOTIF_SEEN_TTL_MS,
  NOTIF_SEENALL_KEY,
  osPushStateKey,
  parseFlagValue,
  parseRuleValue,
  parseSeenValue,
  permStateKey,
  planRemoteApply,
  prunePlanAgainstLocal,
  ruleIdentity,
  ruleStateKey,
  seenStateKey,
  serialiseFlag,
  serialiseRule,
  serialiseSeen,
  sortRecordsForApply,
  tombstonesForRemovals,
  type LocalSnapshot,
  type RemoteApplyDeps,
  type SyncRule,
} from './notificationStateSync';

beforeAll(() => {
  // jsdom does not ship SubtleCrypto; use Node's WebCrypto for hashing.
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto);
  }
});

const rule = (overrides: Partial<SyncRule> = {}): SyncRule => ({
  event: 'RESOURCE_PUBLISHED',
  resourceFilter: { service: 'DOCUMENT', identifier: 'post-', mode: 'ALL' },
  link: 'qortal://APP/Q-Blog',
  notificationId: 'new-post',
  appName: 'q-blog',
  appService: 'APP',
  message: { en: 'New post' },
  ...overrides,
});

const emptySnapshot = (
  overrides: Partial<LocalSnapshot> = {}
): LocalSnapshot => ({
  rules: [],
  permissions: [],
  osPushDisabled: {},
  mentionsEnabled: null,
  seenAll: null,
  seenKeyTimes: {},
  ...overrides,
});

describe('key building and hashing', () => {
  it('hashes to a 24 char hex prefix of sha256', async () => {
    const hash = await hashForStateKey('abc');
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223…
    expect(hash).toBe('ba7816bf8f01cfea414140de'.slice(0, NOTIF_HASH_LENGTH));
    expect(hash).toHaveLength(NOTIF_HASH_LENGTH);
  });

  it('builds keys under 48 chars from the hashed identity', async () => {
    const r = rule({ appName: 'Q-Blog' });
    expect(ruleIdentity(r)).toBe('APP|q-blog|new-post');
    const key = await ruleStateKey(r);
    expect(key.startsWith('notif.rule.')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(48);
    expect(key).toBe(await ruleStateKey(rule({ appName: 'q-blog' })));

    const perm = await permStateKey('Q-Blog');
    expect(perm).toBe(await permStateKey('q-blog'));
    expect(perm.startsWith('notif.perm.')).toBe(true);
    expect((await osPushStateKey('q-blog')).startsWith('notif.ospush.')).toBe(
      true
    );
    const seen = await seenStateKey('RESOURCE_PUBLISHED-q-blog-APP-new-post');
    expect(seen.startsWith('notif.seen.')).toBe(true);
    expect(seen.length).toBeLessThanOrEqual(48);
  });

  it('classifies every key kind', async () => {
    expect(classifyStateKey(await ruleStateKey(rule()))).toBe('rule');
    expect(classifyStateKey(await permStateKey('a'))).toBe('perm');
    expect(classifyStateKey(await osPushStateKey('a'))).toBe('ospush');
    expect(classifyStateKey(NOTIF_MENTIONS_KEY)).toBe('mentions');
    expect(classifyStateKey(NOTIF_SEENALL_KEY)).toBe('seenall');
    expect(classifyStateKey(await seenStateKey('x'))).toBe('seen');
    expect(classifyStateKey('notif.other')).toBeNull();
    expect(classifyStateKey('read.x')).toBeNull();
  });
});

describe('serialisation', () => {
  it('round-trips a rule canonically (lowercased app, sorted objects)', () => {
    const original = rule({
      appName: 'Q-Blog',
      image: 'qortal://THUMBNAIL/x',
      message: { fr: 'Nouveau', en: 'New post' },
    });
    const value = serialiseRule(original);
    const parsed = parseRuleValue(value);
    expect(parsed).not.toBeNull();
    expect(parsed?.appName).toBe('q-blog');
    expect(parsed?.image).toBe('qortal://THUMBNAIL/x');
    expect(parsed?.message).toEqual({ en: 'New post', fr: 'Nouveau' });
    expect(serialiseRule(parsed as SyncRule)).toBe(value);
    // Key order in the source object does not matter.
    const reordered = {
      ...original,
      message: { en: 'New post', fr: 'Nouveau' },
    };
    expect(serialiseRule(reordered)).toBe(value);
    expect(canonicalCacheValue('notif.rule.x', value)).toBe(value);
    expect(parseRuleValue('{"notificationId":""}')).toBeNull();
    expect(parseRuleValue('nope')).toBeNull();
  });

  it('round-trips flags and seen entries', () => {
    expect(parseFlagValue(serialiseFlag(1, 'Q-Blog'))).toEqual({
      flag: 1,
      appName: 'q-blog',
    });
    expect(parseFlagValue('[2,"x"]')).toBeNull();
    expect(
      parseSeenValue(serialiseSeen(1700000000000, 'RESOURCE_PUBLISHED-a'))
    ).toEqual({
      markTime: 1700000000000,
      fullKey: 'RESOURCE_PUBLISHED-a',
    });
    expect(parseSeenValue('["x","y"]')).toBeNull();
  });
});

describe('diff computation (local → engine)', () => {
  it('publishes only entries that differ from the cache and never tombstones absent keys', async () => {
    const now = 1_700_000_000_000;
    const r = rule();
    const desired = await buildDesiredState(
      emptySnapshot({
        rules: [r],
        permissions: [{ appName: 'q-blog', granted: true }],
        osPushDisabled: { 'q-blog': true },
        mentionsEnabled: false,
        seenAll: now - 1000,
        seenKeyTimes: {
          'RESOURCE_PUBLISHED-q-blog-APP-new-post': now - 60_000,
          'RESOURCE_PUBLISHED-q-blog-APP-old': now - NOTIF_SEEN_TTL_MS - 1,
        },
      }),
      now
    );
    const ruleKey = await ruleStateKey(r);
    const seenKey = await seenStateKey(
      'RESOURCE_PUBLISHED-q-blog-APP-new-post'
    );
    const expiredSeenKey = await seenStateKey(
      'RESOURCE_PUBLISHED-q-blog-APP-old'
    );
    expect(desired.has(ruleKey)).toBe(true);
    expect(desired.has(seenKey)).toBe(true);
    expect(desired.has(expiredSeenKey)).toBe(false);
    expect(desired.get(seenKey)?.ttlMs).toBe(NOTIF_SEEN_TTL_MS - 60_000);
    expect(desired.get(NOTIF_MENTIONS_KEY)?.value).toBe('0');
    expect(desired.get(NOTIF_SEENALL_KEY)?.value).toBe(String(now - 1000));

    const cache = new Map<string, string | null>([
      [ruleKey, serialiseRule(r)],
      [await permStateKey('q-blog'), serialiseFlag(0, 'q-blog')],
      [
        'notif.rule.staleentryonlyinengine',
        serialiseRule(rule({ notificationId: 'x' })),
      ],
    ]);
    const diff = diffAgainstCache(desired, cache);
    const keys = diff.map((d) => d.key);
    expect(keys).not.toContain(ruleKey);
    expect(keys).toContain(await permStateKey('q-blog'));
    expect(keys).toContain(await osPushStateKey('q-blog'));
    expect(keys).toContain(NOTIF_MENTIONS_KEY);
    expect(keys).toContain(NOTIF_SEENALL_KEY);
    expect(keys).toContain(seenKey);
    expect(diff.every((d) => d.value !== null)).toBe(true);
    expect(keys).not.toContain('notif.rule.staleentryonlyinengine');
  });

  it('tombstones come only from explicit removals', async () => {
    const items = await tombstonesForRemovals([
      { notificationId: 'new-post', appName: 'Q-Blog', appService: 'APP' },
      { notificationId: 'new-post', appName: 'q-blog', appService: 'APP' },
      { notificationId: '', appName: 'q-blog', appService: 'APP' },
    ]);
    expect(items).toEqual([{ key: await ruleStateKey(rule()), value: null }]);
  });

  it('never lets an older seen time overwrite a newer engine value', async () => {
    const seenKey = await seenStateKey('k');
    const cache = new Map<string, string | null>([
      [seenKey, serialiseSeen(2000, 'k')],
      [NOTIF_SEENALL_KEY, '5000'],
    ]);
    const kept = filterPublishItemsByLww(
      [
        { key: seenKey, value: serialiseSeen(1000, 'k') },
        { key: NOTIF_SEENALL_KEY, value: '4000' },
        { key: NOTIF_MENTIONS_KEY, value: '1' },
      ],
      cache
    );
    expect(kept.map((k) => k.key)).toEqual([NOTIF_MENTIONS_KEY]);
    const newer = filterPublishItemsByLww(
      [
        { key: seenKey, value: serialiseSeen(3000, 'k') },
        { key: NOTIF_SEENALL_KEY, value: '6000' },
      ],
      cache
    );
    expect(newer).toHaveLength(2);
  });
});

describe('apply ordering and planning (engine → local)', () => {
  it('sorts perm before rule before ospush, mentions, seenall, seen', async () => {
    const sorted = sortRecordsForApply([
      { key: await seenStateKey('a'), value: '' },
      { key: NOTIF_SEENALL_KEY, value: '' },
      { key: NOTIF_MENTIONS_KEY, value: '' },
      { key: await osPushStateKey('a'), value: '' },
      { key: await ruleStateKey(rule()), value: '' },
      { key: await permStateKey('a'), value: '' },
    ]);
    expect(sorted.map((r) => classifyStateKey(r.key))).toEqual([
      'perm',
      'rule',
      'ospush',
      'mentions',
      'seenall',
      'seen',
    ]);
  });

  it('skips rules of apps whose engine permission is 0 and removes local rules on revoke', async () => {
    const blogRule = rule();
    const tubeRule = rule({ appName: 'q-tube', notificationId: 'video' });
    const localRules = [
      { rule: blogRule, key: await ruleStateKey(blogRule) },
      { rule: tubeRule, key: await ruleStateKey(tubeRule) },
    ];
    const plan = await planRemoteApply(
      [
        { key: await ruleStateKey(blogRule), value: serialiseRule(blogRule) },
        { key: await ruleStateKey(tubeRule), value: serialiseRule(tubeRule) },
        {
          key: await permStateKey('q-blog'),
          value: serialiseFlag(0, 'q-blog'),
        },
        {
          key: await permStateKey('q-mail'),
          value: serialiseFlag(1, 'q-mail'),
        },
      ],
      {
        localRules,
        localSeenAll: null,
        enginePermFlags: new Map([[await permStateKey('q-tube'), 0]]),
      }
    );
    expect(plan.ruleUpserts).toEqual([]);
    expect(plan.ruleRemovals).toEqual([
      { notificationId: 'new-post', appName: 'q-blog', appService: 'APP' },
    ]);
    expect(plan.permissions).toEqual([
      { appName: 'q-blog', granted: false },
      { appName: 'q-mail', granted: true },
    ]);
  });

  it('applies rule tombstones only when the rule exists locally', async () => {
    const blogRule = rule();
    const key = await ruleStateKey(blogRule);
    const withLocal = await planRemoteApply([{ key, value: null }], {
      localRules: [{ rule: blogRule, key }],
      localSeenAll: null,
    });
    expect(withLocal.ruleRemovals).toHaveLength(1);
    const withoutLocal = await planRemoteApply([{ key, value: null }], {
      localRules: [],
      localSeenAll: null,
    });
    expect(withoutLocal.ruleRemovals).toHaveLength(0);
  });

  it('applies seenall only as a max and drops expired records', async () => {
    const now = 1_700_000_000_000;
    const plan = await planRemoteApply(
      [
        { key: NOTIF_SEENALL_KEY, value: '1000' },
        {
          key: await seenStateKey('gone'),
          value: serialiseSeen(1, 'gone'),
          expiresAt: now - 1,
        },
        {
          key: await seenStateKey('kept'),
          value: serialiseSeen(now - 5, 'kept'),
          expiresAt: now + 1,
        },
      ],
      { localRules: [], localSeenAll: 2000, now }
    );
    expect(plan.seenAll).toBeNull();
    expect(plan.seenEntries).toEqual([[now - 5, 'kept']]);
    const larger = await planRemoteApply(
      [{ key: NOTIF_SEENALL_KEY, value: '3000' }],
      { localRules: [], localSeenAll: 2000, now }
    );
    expect(larger.seenAll).toBe(3000);
  });

  it('prunes items that would not change local state, preserving seen mark times', async () => {
    const blogRule = rule();
    const snapshot = emptySnapshot({
      rules: [blogRule],
      permissions: [{ appName: 'q-blog', granted: true }],
      osPushDisabled: { 'q-blog': false },
      mentionsEnabled: true,
      seenAll: 100,
      seenKeyTimes: { newer: 500, older: 100 },
    });
    const pruned = await prunePlanAgainstLocal(
      {
        permissions: [
          { appName: 'q-blog', granted: true },
          { appName: 'q-tube', granted: true },
        ],
        ruleUpserts: [blogRule, rule({ notificationId: 'other' })],
        ruleRemovals: [
          { notificationId: 'new-post', appName: 'q-blog', appService: 'APP' },
          { notificationId: 'ghost', appName: 'q-blog', appService: 'APP' },
        ],
        osPush: [
          { appName: 'q-blog', disabled: false },
          { appName: 'q-blog', disabled: true },
        ],
        mentionsEnabled: true,
        seenAll: 50,
        seenEntries: [
          [400, 'newer'],
          [300, 'older'],
        ],
      },
      snapshot,
      [{ rule: blogRule, key: await ruleStateKey(blogRule) }]
    );
    expect(pruned.permissions).toEqual([{ appName: 'q-tube', granted: true }]);
    expect(pruned.ruleUpserts.map((r) => r.notificationId)).toEqual(['other']);
    expect(pruned.ruleRemovals.map((r) => r.notificationId)).toEqual([
      'new-post',
    ]);
    expect(pruned.osPush).toEqual([{ appName: 'q-blog', disabled: true }]);
    expect(pruned.mentionsEnabled).toBeNull();
    expect(pruned.seenAll).toBeNull();
    // The remote mark time (300) is applied as-is, never replaced by "now".
    expect(pruned.seenEntries).toEqual([[300, 'older']]);
  });

  it('executes a plan in order: permission, rules, ospush, mentions, seenall, seen', async () => {
    const calls: string[] = [];
    const deps: RemoteApplyDeps = {
      getPermission: async () => null,
      setPermission: async (app, granted) => {
        calls.push(`perm:${app}:${granted}`);
      },
      reconnectNotifications: () => calls.push('reconnect'),
      getEngineRulesForApp: async () => [
        rule({ notificationId: 'from-engine' }),
      ],
      applyRules: async (upserts, removals) => {
        calls.push(
          `rules:${upserts.map((u) => u.notificationId).join(',')}:${removals
            .map((r) => r.notificationId)
            .join(',')}`
        );
      },
      unsubscribeRules: (removals) =>
        calls.push(`unsub:${removals.map((r) => r.notificationId).join(',')}`),
      setOsPushDisabled: async (app, disabled) => {
        calls.push(`ospush:${app}:${disabled}`);
      },
      setMentionsEnabled: async (enabled) => {
        calls.push(`mentions:${enabled}`);
      },
      setSeenAll: (ms) => calls.push(`seenall:${ms}`),
      addSeenEntries: (entries) =>
        calls.push(`seen:${entries.map(([t, k]) => `${k}@${t}`).join(',')}`),
    };
    const applied = await executeRemotePlan(
      {
        permissions: [{ appName: 'q-blog', granted: true }],
        ruleUpserts: [rule()],
        ruleRemovals: [
          { notificationId: 'gone', appName: 'q-blog', appService: 'APP' },
        ],
        osPush: [{ appName: 'q-blog', disabled: true }],
        mentionsEnabled: false,
        seenAll: 4242,
        seenEntries: [[1234, 'RESOURCE_PUBLISHED-q-blog-APP-new-post']],
      },
      deps
    );
    expect(calls).toEqual([
      'perm:q-blog:true',
      'reconnect',
      'rules:new-post,from-engine:gone',
      'unsub:gone',
      'ospush:q-blog:true',
      'mentions:false',
      'seenall:4242',
      'seen:RESOURCE_PUBLISHED-q-blog-APP-new-post@1234',
    ]);
    expect(applied).toBeGreaterThan(0);
  });
});
