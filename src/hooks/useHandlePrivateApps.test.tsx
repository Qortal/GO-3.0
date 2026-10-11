import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'https://ext-node.qortal.link';
const DEVICE_ID = '8eTqYyGvDdPyprD1pJ1CbMr3eWwg3vN4VBuuwqsYtZd5';

const mocks = vi.hoisted(() => ({
  onDevice: true,
  snacks: [] as Array<{ type: string; message: string }>,
  events: [] as Array<{ name: string; detail: any }>,
  build: vi.fn(),
  pinned: [] as any[],
  settingsUpdated: 0,
}));

vi.mock('../App', () => ({ getBaseApiReact: () => NODE }));
vi.mock('../background/background.ts', () => ({
  // createEndpoint adds the node's API key; a preview address must not carry it.
  createEndpoint: vi.fn(async (path: string) => `${NODE}${path}&apiKey=KEY`),
}));
vi.mock('../plugins/PrivateQappHost', () => ({
  canBuildPrivateAppsOnDevice: () => mocks.onDevice,
  buildPrivateAppOnDevice: mocks.build,
}));
vi.mock('../atoms/global', () => ({
  infoSnackGlobalAtom: 'info',
  openSnackGlobalAtom: 'open',
  settingsLocalLastUpdatedAtom: 'updated',
  sortablePinnedAppsAtom: 'pinned',
}));
vi.mock('jotai', () => ({
  useAtom: (atom: string) => [
    null,
    atom === 'info'
      ? (snack: { type: string; message: string }) => mocks.snacks.push(snack)
      : () => {},
  ],
  useSetAtom: (atom: string) =>
    atom === 'pinned'
      ? (update: (prev: any[]) => any[]) => {
          mocks.pinned = update(mocks.pinned);
        }
      : atom === 'updated'
        ? () => {
            mocks.settingsUpdated += 1;
          }
        : () => {},
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../utils/events', () => ({
  executeEvent: (name: string, detail: any) =>
    mocks.events.push({ name, detail }),
}));
vi.mock('../components/Apps/AppsNavBarDesktop', () => ({
  saveToLocalStorage: vi.fn(),
}));
vi.mock('../qdn/encryption/group-encryption', () => ({
  base64ToUint8Array: (b64: string) =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
}));
vi.mock('../encryption/encryption.ts', () => ({
  uint8ArrayToObject: (bytes: Uint8Array) =>
    JSON.parse(new TextDecoder().decode(bytes)),
}));

import { useHandlePrivateApps } from './useHandlePrivateApps';

const APP = {
  service: 'DOCUMENT',
  name: 'Alice',
  identifier: 'team-app',
  groupId: 42,
};
const ENCRYPTED = 'MDAwMDAwMDAwMTAwMm5vbmNl';
const ZIP = 'UEsDBBQAAAAIAA==';
const decrypted = btoa(JSON.stringify({ app: ZIP, name: 'Team App' }));

type Route = (url: string, init?: RequestInit) => Response;

function stubNode(route: Route) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    route(url, init)
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const downloadOk: Route = () => new Response(`${ENCRYPTED}\n`, { status: 200 });

async function open(addToPinnedApps = false) {
  const { result } = renderHook(() => useHandlePrivateApps());
  await result.current.openApp(APP, addToPinnedApps, undefined);
}

const lastSnack = () => mocks.snacks[mocks.snacks.length - 1];
const addedTab = () =>
  mocks.events.find((event) => event.name === 'addTab')?.detail?.data;

describe('useHandlePrivateApps', () => {
  beforeEach(() => {
    mocks.onDevice = true;
    mocks.snacks.length = 0;
    mocks.events.length = 0;
    mocks.pinned = [];
    mocks.settingsUpdated = 0;
    mocks.build.mockReset();
    mocks.build.mockImplementation(async (nodeUrl: string) => ({
      id: DEVICE_ID,
      url: `${nodeUrl}/render/hash/${DEVICE_ID}`,
    }));
    (window as any).sendMessage = vi.fn(async (action: string) =>
      action === 'DECRYPT_QORTAL_GROUP_DATA' ? decrypted : null
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says the node does not have the app instead of failing in atob', async () => {
    stubNode(
      () =>
        new Response(
          '{"error":1401,"message":"Data unavailable. Please try again later."}',
          { status: 404 }
        )
    );
    await open();
    expect(lastSnack()).toEqual({
      type: 'error',
      message: 'core:message.error.private_app_not_available',
    });
    expect((window as any).sendMessage).not.toHaveBeenCalled();
    expect(addedTab()).toBeUndefined();
  });

  it('shows the decrypt error (such as a missing group key) as it is', async () => {
    stubNode(downloadOk);
    (window as any).sendMessage = vi.fn(async () => ({
      error: 'Could not download the group key',
    }));
    await open();
    expect(lastSnack()).toEqual({
      type: 'error',
      message: 'Could not download the group key',
    });
  });

  it('builds the app on the phone and never posts it to the node', async () => {
    const fetchMock = stubNode(downloadOk);
    await open();
    expect((window as any).sendMessage).toHaveBeenCalledWith(
      'DECRYPT_QORTAL_GROUP_DATA',
      { base64: ENCRYPTED, groupId: 42 }
    );
    expect(mocks.build).toHaveBeenCalledWith(NODE, ZIP);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${NODE}/arbitrary/DOCUMENT/Alice/team-app?encoding=base64`
    );
    expect(addedTab()).toMatchObject({
      url: `${NODE}/render/hash/${DEVICE_ID}`,
      isPreview: true,
      isPrivate: true,
      service: 'DOCUMENT',
      name: 'Alice',
      identifier: 'team-app',
      label: 'Team App',
    });
    expect(lastSnack()).toEqual({
      type: 'success',
      message: 'core:message.generic.opened',
    });
  });

  it('refresh builds the app again at a new address', async () => {
    stubNode(downloadOk);
    await open();
    mocks.build.mockImplementation(async (nodeUrl: string) => ({
      id: 'NEW',
      url: `${nodeUrl}/render/hash/NEW`,
    }));
    addedTab().refreshFunc('tab-9');
    await vi.waitFor(() =>
      expect(
        mocks.events.find((event) => event.name === 'updateAppUrl')?.detail
      ).toEqual({ tabId: 'tab-9', url: `${NODE}/render/hash/NEW` })
    );
  });

  it('pins a private app once, however often it is added', async () => {
    stubNode(downloadOk);
    await open(true);
    await open(true);
    expect(mocks.pinned).toHaveLength(1);
    expect(mocks.pinned[0]).toMatchObject({
      isPrivate: true,
      privateAppProperties: {
        name: 'Alice',
        identifier: 'team-app',
        groupId: 42,
      },
    });
    expect(mocks.settingsUpdated).toBe(1);
  });

  it('reports a build failure on the phone', async () => {
    stubNode(downloadOk);
    mocks.build.mockRejectedValue(new Error('invalid app: no files'));
    await open();
    expect(lastSnack()).toEqual({
      type: 'error',
      message: 'core:message.error.build_app',
    });
    expect(addedTab()).toBeUndefined();
  });

  describe('away from the phone (the node builds a preview)', () => {
    beforeEach(() => {
      mocks.onDevice = false;
    });

    it('explains that a node without its API key cannot build it', async () => {
      stubNode((url) =>
        url.includes('/zip?preview=true')
          ? new Response(
              '{"error":4,"message":"Missing \'X-API-KEY\' header"}',
              {
                status: 403,
              }
            )
          : downloadOk(url)
      );
      await open();
      expect(lastSnack()).toEqual({
        type: 'error',
        message: 'core:message.error.private_app_needs_own_node',
      });
    });

    it("opens the node's preview without the API key in the frame address", async () => {
      const fetchMock = stubNode((url) =>
        url.includes('/zip?preview=true')
          ? new Response('/render/hash/HASH58?secret=SECRET58', { status: 200 })
          : downloadOk(url)
      );
      await open();
      const post = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/zip?preview=true')
      );
      expect(post?.[0]).toBe(
        `${NODE}/arbitrary/APP/Alice/zip?preview=true&apiKey=KEY`
      );
      expect(post?.[1]).toMatchObject({ method: 'POST', body: ZIP });
      expect(addedTab()?.url).toBe(
        `${NODE}/render/hash/HASH58?secret=SECRET58`
      );
    });

    it('does not open a page the node sent instead of a preview address', async () => {
      stubNode((url) =>
        url.includes('/zip?preview=true')
          ? new Response('Unable to generate preview URL', { status: 200 })
          : downloadOk(url)
      );
      await open();
      expect(lastSnack()).toEqual({
        type: 'error',
        message: 'core:message.error.build_app',
      });
      expect(addedTab()).toBeUndefined();
    });
  });
});
