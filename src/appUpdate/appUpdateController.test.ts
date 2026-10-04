import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: true }));
const node = vi.hoisted(() => ({
  apiKey: 'NODE_KEY' as string | undefined,
  base: 'https://node.example',
}));
const plugin = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: vi.fn() })),
  canInstall: vi.fn(async () => ({ allowed: true })),
  download: vi.fn(async () => ({ bytes: 10, path: '/cache/updates/go.apk' })),
  install: vi.fn(async () => undefined),
  requestInstallPermission: vi.fn(async () => undefined),
}));
const qdn = vi.hoisted(() => ({
  listPublishedBuilds: vi.fn(),
  lookUpLatestPublishedBuild: vi.fn(),
  readResourceStatus: vi.fn(async () => ({
    percentLoaded: 100,
    status: 'READY',
  })),
  requestResourceBuild: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: '0.0.12' }) },
}));
vi.mock('../plugins/QortalAppUpdate', () => ({ QortalAppUpdate: plugin }));
vi.mock('./qdnAppUpdate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qdnAppUpdate')>()),
  ...qdn,
  buildDownloadRequest: async (_service: string, identifier: string) => ({
    ...(node.apiKey ? { apiKey: node.apiKey } : {}),
    url: `${node.base}/${identifier}`,
  }),
}));
import i18n from '../i18n/i18n';

import {
  appUpdateCheckAtom,
  appUpdateDismissedVersionAtom,
  appUpdateFileAtom,
  appUpdateInstalledVersionAtom,
  appUpdateProgressAtom,
  appUpdateReleaseAtom,
  appUpdateReleaseListAtom,
  appUpdateSeenVersionAtom,
  appUpdateTargetAtom,
  appUpdateWindowOpenAtom,
} from './appUpdateAtoms';
import {
  checkForUpdatesNow,
  dismissAppUpdate,
  loadPublishedReleases,
  openAppUpdateWindow,
  resetAppUpdateControllerForTests,
  resetAppUpdateProgress,
  startAppUpdateDownload,
} from './appUpdateController';
import type { AppRelease } from './qdnAppUpdate';

const store = getDefaultStore();

const build = (version: string, publishedAt: number): AppRelease => ({
  filename: `GO 3.0 v${version}.apk`,
  identifier: `file-${version}`,
  notes: '',
  notesHtml: `<p>${version}</p>`,
  publishedAt,
  service: 'FILE',
  shareIdentifier: `share-${version}_metadata`,
  size: 1000,
  title: `GO 3.0 v${version}`,
  version,
});

const v13 = build('0.0.13', 4000);
const v12 = build('0.0.12', 3000);
const v9 = build('0.0.9', 1000);

const publish = (...releases: AppRelease[]) =>
  qdn.listPublishedBuilds.mockImplementation(async (onRelease) => {
    onRelease?.(releases);
    return { missing: 0, reachable: true, releases };
  });

describe('GO 3.0 Updates controller', () => {
  beforeEach(() => {
    native.value = true;
    node.apiKey = 'NODE_KEY';
    node.base = 'https://node.example';
    localStorage.clear();
    resetAppUpdateControllerForTests();
    store.set(appUpdateInstalledVersionAtom, '');
    store.set(appUpdateReleaseAtom, null);
    store.set(appUpdateTargetAtom, null);
    store.set(appUpdateDismissedVersionAtom, null);
    store.set(appUpdateSeenVersionAtom, null);
    store.set(appUpdateWindowOpenAtom, false);
    store.set(appUpdateProgressAtom, { percent: 0, phase: 'idle' });
    store.set(appUpdateCheckAtom, { checkedAt: 0, status: 'idle' });
    store.set(appUpdateReleaseListAtom, {
      loadedAt: 0,
      missing: 0,
      releases: [],
      status: 'idle',
    });
    Object.values(plugin).forEach((fn) => fn.mockClear());
    plugin.download.mockImplementation(async () => ({
      bytes: 10,
      path: '/cache/updates/go.apk',
    }));
    plugin.install.mockImplementation(async () => undefined);
    qdn.requestResourceBuild.mockClear();
    qdn.listPublishedBuilds.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the versions and puts a newer one on offer', async () => {
    publish(v13, v12, v9);
    await loadPublishedReleases();

    expect(store.get(appUpdateReleaseListAtom)).toMatchObject({
      releases: [v13, v12, v9],
      status: 'ready',
    });
    expect(store.get(appUpdateReleaseAtom)).toEqual(v13);
    expect(store.get(appUpdateCheckAtom).status).toBe('available');

    // A fresh list is reused when the screen is reopened.
    await loadPublishedReleases();
    expect(qdn.listPublishedBuilds).toHaveBeenCalledTimes(1);
  });

  it('says up to date when the newest build is the one installed', async () => {
    publish(v12, v9);
    await checkForUpdatesNow();
    expect(store.get(appUpdateReleaseAtom)).toBeNull();
    expect(store.get(appUpdateCheckAtom).status).toBe('up-to-date');
  });

  it('reports a node that cannot answer, keeping what was listed', async () => {
    publish(v13, v12);
    await loadPublishedReleases();
    qdn.listPublishedBuilds.mockResolvedValue({
      missing: 0,
      reachable: false,
      releases: [],
    });
    await checkForUpdatesNow();
    expect(store.get(appUpdateCheckAtom).status).toBe('unreachable');
    expect(store.get(appUpdateReleaseListAtom)).toMatchObject({
      releases: [v13, v12],
      status: 'unreachable',
    });
  });

  it('keeps a version put off with Later quiet until Check for updates', async () => {
    publish(v13, v12);
    await loadPublishedReleases();
    store.set(appUpdateWindowOpenAtom, false);
    dismissAppUpdate();
    expect(store.get(appUpdateReleaseAtom)).toBeNull();
    expect(store.get(appUpdateDismissedVersionAtom)).toBe('0.0.13');

    // Opening the screen lists it, but does not ring the bell again.
    store.set(appUpdateReleaseListAtom, (list) => ({ ...list, loadedAt: 0 }));
    await loadPublishedReleases();
    expect(store.get(appUpdateReleaseAtom)).toBeNull();
    expect(store.get(appUpdateCheckAtom).status).toBe('available');

    await checkForUpdatesNow();
    expect(store.get(appUpdateReleaseAtom)).toEqual(v13);
  });

  it('marks the offered update seen when the screen opens', async () => {
    publish(v13, v12);
    await loadPublishedReleases();
    expect(store.get(appUpdateSeenVersionAtom)).toBeNull();
    openAppUpdateWindow();
    expect(store.get(appUpdateWindowOpenAtom)).toBe(true);
    expect(store.get(appUpdateSeenVersionAtom)).toBe('0.0.13');
  });

  it('downloads a newer build and hands it to the installer', async () => {
    vi.useFakeTimers();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    const done = startAppUpdateDownload(v13);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    expect(store.get(appUpdateTargetAtom)).toEqual(v13);
    expect(qdn.requestResourceBuild).toHaveBeenCalledWith(
      'FILE',
      'file-0.0.13'
    );
    // The node key goes beside the URL (an X-API-KEY header natively).
    expect(plugin.download).toHaveBeenCalledWith({
      apiKey: 'NODE_KEY',
      filename: 'GO 3.0 v0.0.13.apk',
      url: 'https://node.example/file-0.0.13',
    });
    expect(plugin.install).toHaveBeenCalledWith({
      path: '/cache/updates/go.apk',
    });
    expect(store.get(appUpdateProgressAtom).phase).toBe('installing');

    resetAppUpdateProgress();
    expect(store.get(appUpdateTargetAtom)).toBeNull();
    expect(store.get(appUpdateProgressAtom).phase).toBe('idle');
  });

  it('never installs the running build or an older one', async () => {
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    await startAppUpdateDownload(v12);
    await startAppUpdateDownload(v9);
    expect(store.get(appUpdateTargetAtom)).toBeNull();
    expect(plugin.download).not.toHaveBeenCalled();
  });

  it('refuses a plain-HTTP node before asking QDN for the build', async () => {
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    node.base = 'http://192.168.1.20:12391';
    await startAppUpdateDownload(v13);

    expect(qdn.requestResourceBuild).not.toHaveBeenCalled();
    expect(plugin.download).not.toHaveBeenCalled();
    expect(store.get(appUpdateProgressAtom)).toMatchObject({
      error: i18n.t('core:go_updates.error.insecure_node'),
      phase: 'error',
    });
    expect(store.get(appUpdateProgressAtom).error).toContain('HTTPS');
  });

  it('still updates over plain HTTP from a node on this phone', async () => {
    vi.useFakeTimers();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    node.apiKey = undefined;
    node.base = 'http://127.0.0.1:12391';
    const done = startAppUpdateDownload(v13);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    expect(plugin.download).toHaveBeenCalledWith({
      filename: 'GO 3.0 v0.0.13.apk',
      url: 'http://127.0.0.1:12391/file-0.0.13',
    });
    expect(plugin.install).toHaveBeenCalled();
  });

  it('shows why the plugin refused a downloaded build', async () => {
    vi.useFakeTimers();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    plugin.download.mockImplementation(async () => {
      throw Object.assign(new Error('signer mismatch'), {
        code: 'UPDATE_WRONG_SIGNER',
      });
    });
    const done = startAppUpdateDownload(v13);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    expect(plugin.install).not.toHaveBeenCalled();
    expect(store.get(appUpdateProgressAtom)).toMatchObject({
      error: i18n.t('core:go_updates.error.wrong_signer'),
      phase: 'error',
    });
  });

  it('ends the attempt when the installer step is refused', async () => {
    vi.useFakeTimers();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    plugin.install.mockImplementation(async () => {
      throw Object.assign(new Error('not GO'), {
        code: 'UPDATE_WRONG_PACKAGE',
      });
    });
    const done = startAppUpdateDownload(v13);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    expect(store.get(appUpdateFileAtom)).toBeNull();
    expect(store.get(appUpdateProgressAtom)).toMatchObject({
      error: i18n.t('core:go_updates.error.not_go_build'),
      phase: 'error',
    });
  });

  it('never shows a URL query (which can hold the key) in an error', async () => {
    vi.useFakeTimers();
    store.set(appUpdateInstalledVersionAtom, '0.0.12');
    plugin.download.mockImplementation(async () => {
      throw new Error(
        'Failed to download the update: https://node.example/x?apiKey=NODE_KEY'
      );
    });
    const done = startAppUpdateDownload(v13);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    const { error } = store.get(appUpdateProgressAtom);
    expect(error).toBe('Failed to download the update: https://node.example/x');
  });

  it('installs nothing outside the Android app', async () => {
    native.value = false;
    await startAppUpdateDownload(v13);
    expect(store.get(appUpdateTargetAtom)).toBeNull();
    expect(plugin.download).not.toHaveBeenCalled();
  });
});
