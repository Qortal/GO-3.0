import { describe, expect, it } from 'vitest';
import {
  appNameForPrewarm,
  appNameFromTabKey,
  buildQdnAvatarPrewarmPlan,
  prewarmableName,
  QDN_AVATAR_PREWARM_FEATURED_APPS,
} from './prewarmPlan';

const ADDRESS_ME = 'QMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeMeM';
const ADDRESS_A = 'QAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDRESS_B = 'QBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ADDRESS_C = 'QCccccccccccccccccccccccccccccccccc'.slice(0, 34);

const names = (plan: ReturnType<typeof buildQdnAvatarPrewarmPlan>) =>
  plan.map((entry) => (typeof entry === 'string' ? entry : entry.name));

describe('prewarm plan helpers', () => {
  it('accepts registered names and rejects addresses and junk', () => {
    expect(prewarmableName('  Q-Tube ')).toBe('Q-Tube');
    expect(prewarmableName(ADDRESS_A)).toBe('');
    expect(prewarmableName('')).toBe('');
    expect(prewarmableName(42)).toBe('');
    expect(prewarmableName('x'.repeat(41))).toBe('');
  });

  it('reads app names from tabs, skipping private and internal ones', () => {
    expect(appNameForPrewarm({ service: 'APP', name: 'Q-Mail' })).toBe(
      'Q-Mail'
    );
    expect(appNameForPrewarm({ internal: 'wallets', name: 'x' })).toBe('');
    expect(appNameForPrewarm({ name: 'Secret', isPrivate: true })).toBe('');
    expect(
      appNameForPrewarm({ name: 'Secret', privateAppProperties: {} })
    ).toBe('');
    expect(appNameFromTabKey('APP|Q-Tube')).toBe('Q-Tube');
    expect(appNameFromTabKey('WEBSITE|My Site|home')).toBe('My Site');
    expect(appNameFromTabKey('internal:wallets')).toBe('');
    expect(appNameFromTabKey('nonsense')).toBe('');
  });

  it('never reads a publisher name from a private Q-App key', () => {
    // getOpenTabKey: private apps are `APP|<publisher>|<identifier>`.
    expect(appNameFromTabKey('APP|Publisher|private-app-id')).toBe('');
    expect(appNameFromTabKey('DOCUMENT|Someone')).toBe('');
    expect(appNameFromTabKey('website|My Site|home')).toBe('My Site');
  });
});

describe('buildQdnAvatarPrewarmPlan', () => {
  it('starts with the own name and the Home featured Q-Apps', () => {
    const plan = buildQdnAvatarPrewarmPlan({ ownNames: ['Alice'] });
    expect(plan).toEqual(['Alice', ...QDN_AVATAR_PREWARM_FEATURED_APPS]);
    expect(QDN_AVATAR_PREWARM_FEATURED_APPS).toEqual([
      'Q-Tube',
      'Quitter',
      'Q-Mail',
      'SubWire',
      'Q-Trade',
    ]);
  });

  it('orders tabs, folders, most opened apps and pins, without duplicates', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      featuredApps: ['Q-Tube'],
      openTabs: [
        { service: 'APP', name: 'Q-Blog' },
        { service: 'APP', name: 'q-tube' },
        { internal: 'wallets' },
        { service: 'APP', name: 'Hidden', isPrivate: true },
      ],
      tabFolders: {
        folders: [
          { tabKeys: ['APP|Second'], order: 1, row: 0 },
          {
            tabKeys: ['APP|First', 'APP|Private|id', 'internal:home'],
            order: 0,
            row: 0,
          },
          { tabKeys: ['WEBSITE|Row Two'], order: 0, row: 1 },
        ],
        savedTabs: {
          'APP|Private|id': { name: 'Private', isPrivate: true },
          'APP|First': { service: 'APP', name: 'First' },
        },
      },
      pinnedApps: [{ service: 'APP', name: 'Pinned' }],
      appOpenCounts: {
        'APP|Rare': 1,
        'APP|Often': 9,
        'internal:wallets': 50,
        'APP|Zero': 0,
      },
    });
    // Open tabs come before the Home featured apps now; 'q-tube' is the
    // same avatar as 'Q-Tube' (names are case-insensitive).
    expect(names(plan)).toEqual([
      'Q-Blog',
      'q-tube',
      'First',
      'Second',
      'Row Two',
      'Often',
      'Rare',
      'Pinned',
    ]);
  });

  it('puts people and groups before featured apps, pins and bundled icons', () => {
    const bundled = new Set(['q-tube', 'quitter', 'q-mail', 'q-blog']);
    const plan = buildQdnAvatarPrewarmPlan({
      ownNames: ['Alice'],
      featuredApps: ['Q-Tube', 'Quitter', 'Q-Mail'],
      openTabs: [
        { service: 'APP', name: 'Q-Blog' },
        { service: 'APP', name: 'Own Tab' },
      ],
      directs: [{ address: ADDRESS_A, name: 'Anna', timestamp: 1 }],
      groups: [{ groupId: 9, timestamp: 1 }],
      groupOwnerNames: { '9': 'Founder' },
      pinnedApps: [{ service: 'APP', name: 'Pinned' }],
      hasSeed: (name) => bundled.has(name.toLowerCase()),
    });
    expect(plan).toEqual([
      'Alice',
      'Own Tab',
      'Anna',
      { name: 'Founder', identifier: 'qortal_group_avatar_9' },
      'Pinned',
      // Bundled icons last, in their original order.
      'Q-Blog',
      'Q-Tube',
      'Quitter',
      'Q-Mail',
    ]);
  });

  it('never treats a group avatar as a bundled icon', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      featuredApps: [],
      groups: [{ groupId: 3 }],
      groupOwnerNames: { '3': 'Q-Tube' },
      hasSeed: () => true,
    });
    expect(plan).toEqual([
      { name: 'Q-Tube', identifier: 'qortal_group_avatar_3' },
    ]);
  });

  it('skips private Q-Apps among the most opened and folder apps', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      featuredApps: [],
      tabFolders: {
        folders: [{ tabKeys: ['APP|Folder Publisher|folder-id', 'APP|Kept'] }],
        savedTabs: {
          // A saved record wins over the key, even for a two-part key.
          'APP|Saved Private': {
            service: 'APP',
            name: 'Saved Private',
            privateAppProperties: { name: 'Saved Private' },
          },
        },
      },
      appOpenCounts: {
        'APP|Publisher|private-app-id': 50,
        'APP|Saved Private': 40,
        'APP|Public': 3,
      },
    });
    expect(names(plan)).toEqual(['Kept', 'Public']);
  });

  it('adds recent DM partners by last activity and skips the own chat', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      ownAddress: ADDRESS_ME,
      featuredApps: [],
      directs: [
        { address: ADDRESS_A, name: 'Anna', timestamp: 100 },
        { address: ADDRESS_ME, name: 'Me', timestamp: 999 },
        { address: ADDRESS_B, name: ADDRESS_B, timestamp: 50 },
      ],
      directSummaries: {
        [ADDRESS_B]: { peerAddress: ADDRESS_B, updatedAt: 300 },
        [ADDRESS_C]: { peerAddress: ADDRESS_C, lastEvent: { timestamp: 200 } },
        QUnknownUnknownUnknownUnknownUnkno: { updatedAt: 400 },
      },
      knownNamesByAddress: { [ADDRESS_B]: 'Bert', [ADDRESS_C]: 'Carl' },
      isCachedAvatar: () => true,
    });
    expect(names(plan)).toEqual(['Bert', 'Carl', 'Anna']);
  });

  it('refreshes Reticulum-only partners only when GO showed their avatar before', () => {
    const input = {
      featuredApps: [],
      directs: [{ address: ADDRESS_A, name: 'Anna', timestamp: 100 }],
      directSummaries: {
        // Also a node chat partner: the node already knows this one.
        [ADDRESS_A]: { peerAddress: ADDRESS_A, updatedAt: 500 },
        [ADDRESS_B]: { peerAddress: ADDRESS_B, updatedAt: 300 },
        [ADDRESS_C]: { peerAddress: ADDRESS_C, updatedAt: 200 },
      },
      knownNamesByAddress: { [ADDRESS_B]: 'Bert', [ADDRESS_C]: 'Carl' },
    };
    expect(names(buildQdnAvatarPrewarmPlan(input))).toEqual(['Anna']);
    expect(
      names(
        buildQdnAvatarPrewarmPlan({
          ...input,
          isCachedAvatar: (name) => name === 'Carl',
        })
      )
    ).toEqual(['Anna', 'Carl']);
    expect(
      names(
        buildQdnAvatarPrewarmPlan({
          ...input,
          isCachedAvatar: () => {
            throw new Error('broken');
          },
        })
      )
    ).toEqual(['Anna']);
  });

  it('caps the people list', () => {
    const directs = Array.from({ length: 40 }, (_, i) => ({
      address: `Q${String(i).padStart(33, 'x')}`,
      name: `Person ${i}`,
      timestamp: i,
    }));
    const plan = buildQdnAvatarPrewarmPlan(
      { featuredApps: [], directs },
      { people: 30 }
    );
    expect(plan).toHaveLength(30);
    expect(plan[0]).toBe('Person 39');
  });

  it('adds group avatars by owner name, most active first', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      featuredApps: [],
      groups: [
        { groupId: 1, timestamp: 10 },
        { groupId: '2', timestamp: 5 },
        { groupId: 3, timestamp: 1 },
        { groupId: '0', timestamp: 99 },
        { groupId: 4, timestamp: 50 },
      ],
      groupSummaries: { '3': { updatedAt: 20 } },
      groupOwnerNames: { '1': 'Owner One', '3': 'Owner Three' },
      groupProperties: { '2': { ownerPrimaryName: 'Owner Two' } },
    });
    expect(plan).toEqual([
      { name: 'Owner Three', identifier: 'qortal_group_avatar_3' },
      { name: 'Owner One', identifier: 'qortal_group_avatar_1' },
      { name: 'Owner Two', identifier: 'qortal_group_avatar_2' },
    ]);
  });

  it('keeps a group avatar apart from the owner own avatar', () => {
    const plan = buildQdnAvatarPrewarmPlan({
      featuredApps: [],
      ownNames: ['Owner'],
      groups: [{ groupId: 7 }],
      groupOwnerNames: { '7': 'Owner' },
    });
    expect(plan).toEqual([
      'Owner',
      { name: 'Owner', identifier: 'qortal_group_avatar_7' },
    ]);
  });

  it('respects the total cap and survives broken input', () => {
    const plan = buildQdnAvatarPrewarmPlan(
      {
        ownNames: [null, undefined, ''],
        openTabs: null,
        tabFolders: { folders: [null as any, { tabKeys: 'x' }] },
        pinnedApps: [null as any],
        appOpenCounts: null,
        directs: [null as any],
        directSummaries: { a: undefined },
        groups: [null as any],
      },
      { total: 3 }
    );
    expect(plan).toEqual(['Q-Tube', 'Quitter', 'Q-Mail']);
  });
});
