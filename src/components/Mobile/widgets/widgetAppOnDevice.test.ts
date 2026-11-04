import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredZip } from '../../../test/readStoredZip';

const host = vi.hoisted(() => ({
  android: true,
  builds: 0,
  build: vi.fn(),
  keep: vi.fn(),
}));

vi.mock('../../../plugins/PrivateQappHost', () => ({
  buildPrivateAppOnDevice: host.build,
  canBuildPrivateAppsOnDevice: () => host.android,
  keepWidgetAppOnDevice: host.keep,
}));
vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'https://ext-node.qortal.link',
}));

import {
  WIDGET_APP_CHECK_EVERY_MS,
  WIDGET_APP_MAX_FILES,
  WIDGET_APP_RETRY_MS,
  downloadWidgetApp,
  openWidgetAppOnDevice,
  pruneWidgetAppsOnDevice,
  readStoredWidgetApp,
  refreshWidgetAppOnDevice,
  resetWidgetAppsOnDeviceForTests,
  widgetAppFilePaths,
} from './widgetAppOnDevice';

const NODE = 'https://ext-node.qortal.link';
const CLOCK = { name: 'Clock', identifier: null };
const CLOCK_KEY = 'Clock\u0000';

const text = (value: string) => new TextEncoder().encode(value);

/** A node with the Clock widget: `files` by path, or an HTTP status for one that fails. */
function fakeNode({
  files = {
    'index.html': text('<!doctype html><p>12:00</p>'),
    'assets/clock.js': text('tick()'),
  } as Record<string, Uint8Array | number>,
  listed,
  updated = 1000,
}: {
  files?: Record<string, Uint8Array | number>;
  listed?: string[];
  updated?: number;
} = {}) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === '/arbitrary/resources/search') {
      return Response.json([
        { name: 'Clock', service: 'APP', identifier: 'default', updated },
      ]);
    }
    if (parsed.pathname === '/arbitrary/metadata/APP/Clock/default') {
      return Response.json({ files: listed ?? Object.keys(files) });
    }
    if (parsed.pathname === '/arbitrary/APP/Clock/default') {
      const file = files[parsed.searchParams.get('filepath') ?? ''];
      if (file === undefined) return new Response('', { status: 404 });
      if (typeof file === 'number') return new Response('', { status: file });
      return new Response(file.slice().buffer);
    }
    return new Response('', { status: 404 });
  });
  const fileCalls = () =>
    calls.filter((url) => url.includes('/arbitrary/APP/')).length;
  return { fetcher, calls, fileCalls };
}

describe('widget apps kept on the phone', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetWidgetAppsOnDeviceForTests();
    host.android = true;
    host.builds = 0;
    host.build.mockReset();
    host.build.mockImplementation(async (nodeUrl: string) => {
      host.builds += 1;
      return {
        id: `id${host.builds}`,
        url: `${nodeUrl}/render/hash/id${host.builds}`,
      };
    });
    host.keep.mockReset();
  });

  it('reads the file list from the metadata, the way the app was published', () => {
    expect(
      widgetAppFilePaths({
        files: [
          'index.html',
          'assets\\index-B0g1.css',
          './assets/app.js',
          '/favicon.ico',
          'index.html',
          '.qortal/cache',
        ],
      })
    ).toEqual([
      'index.html',
      'assets/index-B0g1.css',
      'assets/app.js',
      'favicon.ico',
    ]);
  });

  it('takes no file list that would leave the app, or none at all', () => {
    expect(widgetAppFilePaths({ files: ['index.html', '../etc'] })).toBeNull();
    expect(widgetAppFilePaths({ files: ['a//b'] })).toBeNull();
    expect(widgetAppFilePaths({ files: [7] })).toBeNull();
    expect(widgetAppFilePaths({ files: [] })).toBeNull();
    expect(widgetAppFilePaths({ error: 1401 })).toBeNull();
    expect(
      widgetAppFilePaths({
        files: Array.from(
          { length: WIDGET_APP_MAX_FILES + 1 },
          (_, i) => `f${i}.js`
        ),
      })
    ).toBeNull();
  });

  it('fetches every file the app published and packs them', async () => {
    const node = fakeNode();
    const { zip, files } = await downloadWidgetApp(CLOCK, NODE, node.fetcher);
    expect(files).toBe(2);
    const entries = readStoredZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      'index.html',
      'assets/clock.js',
    ]);
    expect(new TextDecoder().decode(entries[1].data)).toBe('tick()');
    expect(node.calls).toContain(
      `${NODE}/arbitrary/APP/Clock/default?filepath=assets%2Fclock.js`
    );
  });

  it('keeps nothing when a file does not come', async () => {
    const node = fakeNode({
      files: { 'index.html': text('x'), 'assets/clock.js': 404 },
    });
    await expect(downloadWidgetApp(CLOCK, NODE, node.fetcher)).rejects.toThrow(
      'file 404'
    );
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: node.fetcher,
        now: 0,
      })
    ).toBe(false);
    expect(await readStoredWidgetApp(CLOCK_KEY)).toBeNull();
  });

  it('keeps a copy, then updates it only for a newer publish', async () => {
    const node = fakeNode({ updated: 1000 });
    const options = { baseUrl: NODE, fetcher: node.fetcher };
    expect(await refreshWidgetAppOnDevice(CLOCK, { ...options, now: 0 })).toBe(
      true
    );
    const kept = await readStoredWidgetApp(CLOCK_KEY);
    expect(kept?.version).toBe(1000);
    expect(kept?.files).toBe(2);
    const fetched = node.fileCalls();

    // Within the hour: not even asked.
    const searches = node.calls.length;
    expect(
      await refreshWidgetAppOnDevice(CLOCK, { ...options, now: 1000 })
    ).toBe(false);
    expect(node.calls.length).toBe(searches);

    // An hour on, the same publish: asked, nothing fetched.
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        ...options,
        now: WIDGET_APP_CHECK_EVERY_MS + 1,
      })
    ).toBe(false);
    expect(node.fileCalls()).toBe(fetched);

    // A newer publish: fetched again.
    const newer = fakeNode({ updated: 5000 });
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: newer.fetcher,
        now: 3 * WIDGET_APP_CHECK_EVERY_MS,
      })
    ).toBe(true);
    expect((await readStoredWidgetApp(CLOCK_KEY))?.version).toBe(5000);
  });

  it('keeps the copy it has when the node no longer has the app', async () => {
    const options = { baseUrl: NODE, now: 0 };
    await refreshWidgetAppOnDevice(CLOCK, {
      ...options,
      fetcher: fakeNode({ updated: 1000 }).fetcher,
    });
    const gone = fakeNode({
      updated: 9000,
      files: { 'index.html': 404, 'assets/clock.js': 404 },
    });
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: gone.fetcher,
        now: 2 * WIDGET_APP_CHECK_EVERY_MS,
      })
    ).toBe(false);
    expect((await readStoredWidgetApp(CLOCK_KEY))?.version).toBe(1000);
  });

  it('asks again soon while it has no copy yet', async () => {
    const missing = fakeNode({
      files: { 'index.html': 503, 'assets/clock.js': 503 },
    });
    await refreshWidgetAppOnDevice(CLOCK, {
      baseUrl: NODE,
      fetcher: missing.fetcher,
      now: 0,
    });
    const node = fakeNode();
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: node.fetcher,
        now: WIDGET_APP_RETRY_MS - 1,
      })
    ).toBe(false);
    expect(node.calls).toHaveLength(0);
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: node.fetcher,
        now: WIDGET_APP_RETRY_MS + 1,
      })
    ).toBe(true);
  });

  it('serves a kept copy from the phone, built once per page', async () => {
    expect(await openWidgetAppOnDevice(CLOCK, NODE)).toBeNull();

    await refreshWidgetAppOnDevice(CLOCK, {
      baseUrl: NODE,
      fetcher: fakeNode().fetcher,
      now: 0,
    });
    expect(await openWidgetAppOnDevice(CLOCK, NODE)).toBe(
      `${NODE}/render/hash/id1`
    );
    // The zip went to the phone's app host, as a private app's does.
    const [nodeUrl, zip] = host.build.mock.calls[0];
    expect(nodeUrl).toBe(NODE);
    const entries = readStoredZip(
      Uint8Array.from(atob(zip), (c) => c.charCodeAt(0))
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      'index.html',
      'assets/clock.js',
    ]);
    expect(host.keep).toHaveBeenCalledWith('id1', true);

    expect(await openWidgetAppOnDevice(CLOCK, NODE)).toBe(
      `${NODE}/render/hash/id1`
    );
    expect(host.build).toHaveBeenCalledTimes(1);
  });

  it('builds a newer copy and lets the old one go', async () => {
    await refreshWidgetAppOnDevice(CLOCK, {
      baseUrl: NODE,
      fetcher: fakeNode({ updated: 1000 }).fetcher,
      now: 0,
    });
    await openWidgetAppOnDevice(CLOCK, NODE);
    await refreshWidgetAppOnDevice(CLOCK, {
      baseUrl: NODE,
      fetcher: fakeNode({ updated: 2000 }).fetcher,
      now: 2 * WIDGET_APP_CHECK_EVERY_MS,
    });
    expect(await openWidgetAppOnDevice(CLOCK, NODE)).toBe(
      `${NODE}/render/hash/id2`
    );
    expect(host.keep).toHaveBeenCalledWith('id1', false);
    expect(host.keep).toHaveBeenCalledWith('id2', true);
  });

  it('forgets the app of a widget taken away', async () => {
    await refreshWidgetAppOnDevice(CLOCK, {
      baseUrl: NODE,
      fetcher: fakeNode().fetcher,
      now: 0,
    });
    await openWidgetAppOnDevice(CLOCK, NODE);
    await pruneWidgetAppsOnDevice([CLOCK_KEY]);
    expect(await readStoredWidgetApp(CLOCK_KEY)).not.toBeNull();

    await pruneWidgetAppsOnDevice([]);
    expect(await readStoredWidgetApp(CLOCK_KEY)).toBeNull();
    expect(host.keep).toHaveBeenCalledWith('id1', false);
  });

  it('does nothing off Android', async () => {
    host.android = false;
    const node = fakeNode();
    expect(
      await refreshWidgetAppOnDevice(CLOCK, {
        baseUrl: NODE,
        fetcher: node.fetcher,
        now: 0,
      })
    ).toBe(false);
    expect(await openWidgetAppOnDevice(CLOCK, NODE)).toBeNull();
    expect(node.calls).toHaveLength(0);
  });
});
