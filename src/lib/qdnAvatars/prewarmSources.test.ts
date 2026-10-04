import { createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dmFriendsByAddressAtom,
  groupsOwnerNamesAtom,
  memberDirectsAtom,
  memberGroupsAtom,
  reticulumDirectSummariesAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { emptyOrganization } from '../../components/Mobile/mobileTabOrganization';
import { mobileTabOrganizationStateAtom } from '../../components/Mobile/mobileTabOrganizationStore';
import {
  clearQdnAvatarPrewarmPeerNames,
  collectQdnAvatarPrewarmEntries,
  readQdnAvatarPrewarmInput,
  rememberQdnAvatarPrewarmPeerNames,
} from './prewarmSources';

const ME = 'QfX9KhXnoB78v2D36j7nocKaYtzUYcyQyH';
const OTHER = 'QOtherOtherOtherOtherOtherOtherOth';
const PEER_A = 'QAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PEER_B = 'QBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PEER_C = 'QCcccccccccccccccccccccccccccccccc';

const noStorage = {
  loadTabOrganization: async () => emptyOrganization(),
  loadAppOpenCounts: async () => ({}),
};

const names = (entries: Awaited<ReturnType<typeof collect>>) =>
  entries.map((entry) => (typeof entry === 'string' ? entry : entry.name));

const collect = collectQdnAvatarPrewarmEntries;

afterEach(() => {
  clearQdnAvatarPrewarmPeerNames();
});

describe('prewarm sources', () => {
  it('collects nothing before login or for another account', async () => {
    const store = createStore();
    await expect(collect(store, ME, noStorage)).resolves.toEqual([]);
    store.set(userInfoAtom, { address: OTHER, name: 'Other' });
    await expect(collect(store, ME, noStorage)).resolves.toEqual([]);
    await expect(collect(store, '', noStorage)).resolves.toEqual([]);
  });

  it('gives up when the account changes while storage is read', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    const result = await readQdnAvatarPrewarmInput(store, ME, {
      ...noStorage,
      loadAppOpenCounts: async () => {
        store.set(userInfoAtom, { address: OTHER, name: 'Other' });
        return {};
      },
    });
    expect(result).toBeNull();
  });

  it('reads the own name, tabs, pins, most opened apps, DMs and groups', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    store.set(sortablePinnedAppsAtom, [{ service: 'APP', name: 'Pinned' }]);
    store.set(memberDirectsAtom, [
      { address: PEER_A, name: 'Anna', timestamp: 10 },
    ]);
    store.set(reticulumDirectSummariesAtom, {
      [PEER_B]: { peerAddress: PEER_B, updatedAt: 30 },
      [PEER_C]: { peerAddress: PEER_C, updatedAt: 20 },
    });
    store.set(dmFriendsByAddressAtom, {
      [PEER_B]: { publicKey: 'pk', name: 'Bert', addedAt: 1 },
    });
    rememberQdnAvatarPrewarmPeerNames({ [PEER_C]: 'Carl', [PEER_A]: '' });
    store.set(memberGroupsAtom, [{ groupId: 12, timestamp: 5 }]);
    store.set(groupsOwnerNamesAtom, { '12': 'Founder' });

    const entries = await collect(store, ME, {
      loadTabOrganization: async () => ({
        ...emptyOrganization(),
        folders: [
          { id: 'f', name: 'Library', tabKeys: ['APP|Q-Blog'], order: 0 },
        ],
      }),
      loadAppOpenCounts: async () => ({ 'APP|Q-Fund': 3 }),
      getOpenTabs: () => [{ service: 'APP', name: 'Open App' }],
      // Bert's avatar was shown on this device before; Carl's never was.
      isCachedAvatar: (name) => name === 'Bert',
    });
    expect(names(entries)).toEqual([
      'Me',
      'Open App',
      'Bert',
      'Anna',
      'Founder',
      'Pinned',
      // Q-Blog, Q-Fund and the featured Q-Apps ship a bundled icon: last.
      'Q-Blog',
      'Q-Fund',
      'Q-Tube',
      'Quitter',
      'Q-Mail',
      'SubWire',
      'Q-Trade',
    ]);
    expect(entries[4]).toEqual({
      name: 'Founder',
      identifier: 'qortal_group_avatar_12',
    });
  });

  it('leaves Reticulum-only DM partners out without a cache record', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: '' });
    store.set(sortablePinnedAppsAtom, []);
    store.set(memberDirectsAtom, [
      { address: PEER_A, name: 'Anna', timestamp: 10 },
    ]);
    store.set(reticulumDirectSummariesAtom, {
      [PEER_B]: { peerAddress: PEER_B, updatedAt: 30 },
    });
    store.set(dmFriendsByAddressAtom, {
      [PEER_B]: { publicKey: 'pk', name: 'Bert', addedAt: 1 },
    });
    const entries = await collect(store, ME, noStorage);
    expect(names(entries)).toContain('Anna');
    expect(names(entries)).not.toContain('Bert');
  });

  it('uses the loaded Tabs folders of this wallet without reading storage', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: '' });
    store.set(sortablePinnedAppsAtom, []);
    store.set(mobileTabOrganizationStateAtom, {
      walletAddress: ME,
      ready: true,
      organization: {
        ...emptyOrganization(),
        folders: [{ id: 'f', name: 'Hub', tabKeys: ['APP|Loaded'], order: 0 }],
      },
    });
    const loadTabOrganization = vi.fn(async () => emptyOrganization());
    const entries = await collect(store, ME, {
      ...noStorage,
      loadTabOrganization,
    });
    expect(loadTabOrganization).not.toHaveBeenCalled();
    expect(names(entries)).toContain('Loaded');
  });

  it('reads another wallet folders from storage, not the loaded ones', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: '' });
    store.set(sortablePinnedAppsAtom, []);
    store.set(mobileTabOrganizationStateAtom, {
      walletAddress: OTHER,
      ready: true,
      organization: {
        ...emptyOrganization(),
        folders: [{ id: 'f', name: 'Hub', tabKeys: ['APP|Theirs'], order: 0 }],
      },
    });
    const entries = await collect(store, ME, {
      loadTabOrganization: async () => ({
        ...emptyOrganization(),
        folders: [{ id: 'f', name: 'Hub', tabKeys: ['APP|Mine'], order: 0 }],
      }),
      loadAppOpenCounts: async () => {
        throw new Error('storage broken');
      },
    });
    expect(names(entries)).toContain('Mine');
    expect(names(entries)).not.toContain('Theirs');
  });

  it('keeps at most 300 peer name hints', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 320; i += 1) many[`Q${i}`] = `Name ${i}`;
    rememberQdnAvatarPrewarmPeerNames(many);
    rememberQdnAvatarPrewarmPeerNames(null);
    rememberQdnAvatarPrewarmPeerNames({ Q0: 'Renamed' });
    // Nothing to assert directly: the hints feed the plan. Check via a read.
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: '' });
    return readQdnAvatarPrewarmInput(store, ME, noStorage).then((input) => {
      const known = input?.knownNamesByAddress ?? {};
      expect(Object.keys(known)).toHaveLength(300);
      expect(known.Q0).toBe('Renamed');
      expect(known.Q19).toBeUndefined();
      expect(known.Q319).toBe('Name 319');
    });
  });
});
