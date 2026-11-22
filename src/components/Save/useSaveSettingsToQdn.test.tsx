import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

const qdn = vi.hoisted(() => ({
  record: { hasPublishRecord: false, timestamp: 0 },
  settings: null as unknown,
  asked: 0,
  read: 0,
}));

/** Whether the question before publishing is answered with Cancel. */
const ui = vi.hoisted(() => ({ cancel: false }));

const sent = vi.hoisted(() => ({
  calls: [] as { action: string; payload: Record<string, unknown> }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../App', async () => {
  const { createContext } = await import('react');
  return {
    QORTAL_APP_CONTEXT: createContext({
      show: async () => {
        if (ui.cancel) throw { isCanceled: true };
      },
    }),
    getBaseApiReact: () => 'http://127.0.0.1:12391',
    getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
  };
});

vi.mock('../../background/background', () => ({
  getFee: async () => ({ fee: '0.01' }),
}));

vi.mock('../../qdn/encryption/group-encryption', () => ({
  objectToBase64: async (value: unknown) => JSON.stringify(value),
}));

vi.mock('../../hooks/qdnSavedSettings', () => ({
  getExtSavedSettingsRecord: async () => {
    qdn.asked += 1;
    return qdn.record;
  },
  getExtSavedSettings: async () => {
    qdn.read += 1;
    return qdn.settings;
  },
}));

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import {
  pinnedAppsStorageKey,
  setPinnedAppsAccount,
} from '../../utils/pinnedAppsStorage';
import {
  forgetSettingsCopies,
  rememberSettingsCopy,
} from '../../hooks/qdnSettingsCopy';
import {
  emptySavedApps,
  olderFieldsOf,
  recordStores,
  type SavedApps,
  toSavedAppsField,
} from '../Apps/AppsLauncher/savedApps';
import {
  saveSavedAppsBase,
  saveSavedAppsReplica,
} from '../Apps/AppsLauncher/savedAppsSync';
import { useRevertSettings } from './useRevertSettings';
import { useSaveSettingsToQdn } from './useSaveSettingsToQdn';

const ADDRESS = 'Qaddress';
const NAME = 'simon';

const pin = (name: string) => ({ name, service: 'APP' });

/**
 * Saving and reverting, with the pins this device has. `result.current` is
 * read at each call, since both follow what the atoms hold now.
 */
const renderSettings = (pins: unknown[]) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  const { result } = renderHook(
    () => ({
      save: useSaveSettingsToQdn(ADDRESS, NAME),
      revert: useRevertSettings(ADDRESS),
    }),
    { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> }
  );
  return { store, result };
};

/** The pin list that went into the publish. */
const publishedPins = () => {
  const call = sent.calls.find((entry) => entry.action === 'ENCRYPT_DATA');
  return JSON.parse(String(call?.payload?.data64)).sortablePinnedApps;
};

/** Saved apps holding these pins, each changed at `at`. */
const savedWith = (pins: unknown[], at: number) =>
  recordStores(
    emptySavedApps(),
    { pins: pins as never, data: null, order: null },
    () => at
  ).apps;

/** This device read QDN's copy of `apps` at sign-in (QDN's time 100). */
const signedInWith = (apps: SavedApps) => {
  saveSavedAppsBase(ADDRESS, { updated: 100, hasCopy: true, apps });
  saveSavedAppsReplica(ADDRESS, { seen: 100, apps });
};

/** A copy saved by a Hub that knows saved apps. */
const copyOf = (apps: SavedApps) => ({
  ...olderFieldsOf(apps),
  savedApps: toSavedAppsField(apps),
});

/** What went into the publish. */
const publishedSettings = () => {
  const call = sent.calls.find((entry) => entry.action === 'ENCRYPT_DATA');
  return JSON.parse(String(call?.payload?.data64));
};

/** The pin list this device kept. */
const keptHere = () =>
  JSON.parse(localStorage.getItem(pinnedAppsStorageKey(ADDRESS)) || 'null')
    ?.sortablePinnedApps;

beforeEach(() => {
  localStorage.clear();
  forgetSettingsCopies();
  setPinnedAppsAccount(ADDRESS);
  qdn.record = { hasPublishRecord: false, timestamp: 0 };
  qdn.settings = null;
  qdn.asked = 0;
  qdn.read = 0;
  ui.cancel = false;
  sent.calls = [];
  (window as unknown as { sendMessage: unknown }).sendMessage = vi.fn(
    async (action: string, payload: Record<string, unknown>) => {
      sent.calls.push({ action, payload });
      return action === 'publishOnQDN'
        ? { identifier: 'ext_saved_settings' }
        : { encrypted: 'encrypted' };
    }
  );
});

afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
});

describe('saving the settings to QDN', () => {
  it('keeps an app pinned on another device', async () => {
    const atSignIn = savedWith([pin('Q-Tube')], 50);
    signedInWith(atSignIn);
    // Another device pinned Q-Mail and saved.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = copyOf(
      recordStores(
        atSignIn,
        { pins: [pin('Q-Tube'), pin('Q-Mail')], data: null, order: null },
        () => 450
      ).apps
    );
    // This device pinned Q-Share since.
    const { store, result } = renderSettings([pin('Q-Tube'), pin('Q-Share')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    const all = [pin('Q-Tube'), pin('Q-Mail'), pin('Q-Share')];
    expect(publishedPins()).toEqual(all);
    expect(store.get(sortablePinnedAppsAtom)).toEqual(all);
    // What is saved now, so the Save button has nothing left to offer.
    expect(store.get(oldPinnedAppsAtom)).toEqual(all);
    // And on this device, for the next sign-in.
    expect(keptHere()).toEqual(all);
  });

  it('keeps an app removed on another device removed', async () => {
    // Real times: removals older than 180 days aren't kept.
    const hourAgo = Date.now() - 3_600_000;
    const atSignIn = savedWith([pin('Q-Tube'), pin('Q-Mail')], hourAgo);
    signedInWith(atSignIn);
    // Another device removed Q-Mail and saved.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = copyOf(
      recordStores(
        atSignIn,
        { pins: [pin('Q-Tube')], data: null, order: null },
        () => hourAgo + 1000
      ).apps
    );
    // This device still had Q-Mail, and pinned Q-Share since.
    const { store, result } = renderSettings([
      pin('Q-Tube'),
      pin('Q-Mail'),
      pin('Q-Share'),
    ]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(publishedPins()).toEqual([pin('Q-Tube'), pin('Q-Share')]);
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      pin('Q-Tube'),
      pin('Q-Share'),
    ]);
    expect(publishedSettings().savedApps.pins).toContainEqual({
      k: 'APP|q-mail|',
      removed: true,
      at: hourAgo + 1000,
    });
  });

  it("takes in an older Hub's save over the saved apps, and saves them again", async () => {
    signedInWith(savedWith([pin('Q-Tube'), pin('Q-Mail')], 50));
    // An older Hub unpinned Q-Mail and saved its list alone.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Tube')] };
    const { result } = renderSettings([
      pin('Q-Tube'),
      pin('Q-Mail'),
      pin('Q-Share'),
    ]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(publishedPins()).toEqual([pin('Q-Tube'), pin('Q-Share')]);
    const saved = publishedSettings();
    expect(saved.savedApps.v).toBe(1);
    expect(saved.appBookmarks).toEqual({
      version: 1,
      folders: [],
      bookmarks: [],
    });
    expect(saved.launcherOrder).toEqual(['APP-Q-Tube', 'APP-Q-Share']);
  });

  it("publishes this device's list when told to write over", async () => {
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Mail')] };
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save({ overwrite: true })).toBe('saved');
    });

    expect(qdn.asked).toBe(0);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
  });

  it('leaves the list alone when nothing newer was saved', async () => {
    const { store, result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(qdn.asked).toBe(1);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    expect(keptHere()).toBeUndefined();
  });

  it('keeps a remote pin through Cancel, Revert and a later save', async () => {
    // Another device pinned Q-Mail and saved.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Mail')] };
    const { store, result } = renderSettings([pin('Q-Tube')]);

    // The question before publishing is answered with Cancel.
    ui.cancel = true;
    await act(async () => {
      expect(await result.current.save()).toBe('canceled');
    });
    // Those settings are what Revert goes back to now.
    expect(store.get(oldPinnedAppsAtom)).toEqual([pin('Q-Mail')]);

    ui.cancel = false;
    await act(async () => {
      await result.current.revert();
    });
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Mail')]);

    sent.calls = [];
    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    // That version is known, so it is not read or merged a second time.
    expect(qdn.read).toBe(1);
    // And the app pinned on the other device is still there.
    expect(publishedPins()).toEqual([pin('Q-Mail')]);
  });
});

describe("the settings GO doesn't write", () => {
  /** Home's layout and the side panel as a desktop Hub saves them. */
  const desktopFields = {
    homeLayout: { v: 1, layout: { hidden: ['feed'] }, changedAt: 70 },
    sidePanel: { v: 1, settings: { show: 'hover' }, changedAt: 70 },
    // A field newer than this GO.
    somethingNew: { kept: true },
  };

  it('keeps every field of a newer copy it reads', async () => {
    signedInWith(savedWith([pin('Q-Tube')], 50));
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = {
      ...copyOf(savedWith([pin('Q-Tube'), pin('Q-Mail')], 450)),
      ...desktopFields,
    };
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    const saved = publishedSettings();
    expect(saved.homeLayout).toEqual(desktopFields.homeLayout);
    expect(saved.sidePanel).toEqual(desktopFields.sidePanel);
    expect(saved.somethingNew).toEqual({ kept: true });
    // GO's own fields are written from its saved apps.
    expect(publishedPins()).toEqual([pin('Q-Tube'), pin('Q-Mail')]);
    expect(saved.savedApps.v).toBe(1);
  });

  it('keeps them from the copy read at sign-in, without reading it again', async () => {
    const apps = savedWith([pin('Q-Tube')], 50);
    signedInWith(apps);
    // What sign-in read (QDN's time 100, as the saved apps know it).
    rememberSettingsCopy(ADDRESS, {
      settings: { ...copyOf(apps), ...desktopFields },
      updated: 100,
    });
    qdn.record = { hasPublishRecord: true, timestamp: 100 };
    const { result } = renderSettings([pin('Q-Tube'), pin('Q-Share')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(qdn.read).toBe(0);
    const saved = publishedSettings();
    expect(saved.homeLayout).toEqual(desktopFields.homeLayout);
    expect(saved.sidePanel).toEqual(desktopFields.sidePanel);
    expect(publishedPins()).toEqual([pin('Q-Tube'), pin('Q-Share')]);
  });

  it('reads the copy once more when it has none to keep them from', async () => {
    const apps = savedWith([pin('Q-Tube')], 50);
    // The saved apps read QDN's copy before; this run hasn't kept it.
    signedInWith(apps);
    qdn.record = { hasPublishRecord: true, timestamp: 100 };
    qdn.settings = { ...copyOf(apps), ...desktopFields };
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(qdn.read).toBe(1);
    expect(publishedSettings().homeLayout).toEqual(desktopFields.homeLayout);
  });

  it('keeps the newer copy it holds when the node answers with an older one', async () => {
    const apps = savedWith([pin('Q-Tube')], 50);
    signedInWith(apps);
    rememberSettingsCopy(ADDRESS, {
      settings: { ...copyOf(apps), ...desktopFields },
      updated: 100,
    });
    // A node that is behind.
    qdn.record = { hasPublishRecord: true, timestamp: 90 };
    qdn.settings = { ...copyOf(apps), homeLayout: { old: true } };
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(qdn.read).toBe(0);
    expect(publishedSettings().homeLayout).toEqual(desktopFields.homeLayout);
  });

  it("doesn't publish over settings it can't read", async () => {
    signedInWith(savedWith([pin('Q-Tube')], 50));
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = null;
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      await expect(result.current.save()).rejects.toThrow(
        'core:message.error.save_qdn'
      );
    });

    expect(sent.calls.some((entry) => entry.action === 'publishOnQDN')).toBe(
      false
    );
  });

  it('keeps the fields of the copy it holds when told to write over', async () => {
    rememberSettingsCopy(ADDRESS, {
      settings: { sortablePinnedApps: [pin('Q-Mail')], ...desktopFields },
      updated: 100,
    });
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save({ overwrite: true })).toBe('saved');
    });

    expect(qdn.asked).toBe(0);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
    expect(publishedSettings().homeLayout).toEqual(desktopFields.homeLayout);
  });
});
