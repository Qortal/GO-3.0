import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: 'android' }));
const calls = vi.hoisted(() => [] as string[]);
const plugin = vi.hoisted(() => ({
  begin: vi.fn(async ({ nodeUrl }: { nodeUrl: string }) => {
    calls.push(`begin:${nodeUrl}`);
    return { upload: 'u1' };
  }),
  append: vi.fn(async ({ chunk }: { upload: string; chunk: string }) => {
    calls.push(`append:${chunk.length}`);
  }),
  finish: vi.fn(async () => {
    calls.push('finish');
    return { id: '8eTqYyGvDdPyprD1pJ1CbMr3eWwg3vN4VBuuwqsYtZd5', files: 2 };
  }),
  has: vi.fn(async () => ({ kept: true })),
  release: vi.fn(async () => undefined),
  retain: vi.fn(async ({ ids }: { ids: string[] }) => {
    calls.push(`retain:${ids.join(',')}`);
  }),
  clear: vi.fn(async () => {
    calls.push('clear');
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform },
  registerPlugin: () => plugin,
}));

const PAGE_RESET_MARK = '__qortalPrivateQappHostPageReset';
const ID = '8eTqYyGvDdPyprD1pJ1CbMr3eWwg3vN4VBuuwqsYtZd5';

/** Loads the module the way a freshly (re)loaded page does. */
const loadOnNewPage = async () => {
  delete (globalThis as Record<string, unknown>)[PAGE_RESET_MARK];
  vi.resetModules();
  return import('./PrivateQappHost');
};

describe('PrivateQappHost', () => {
  beforeEach(() => {
    native.platform = 'android';
    calls.length = 0;
  });

  it('drops what an earlier page kept, once per page', async () => {
    await loadOnNewPage();
    expect(calls).toEqual(['clear']);
    vi.resetModules();
    await import('./PrivateQappHost');
    expect(calls).toEqual(['clear']);
  });

  it('builds on Android only', async () => {
    const android = await loadOnNewPage();
    expect(android.canBuildPrivateAppsOnDevice()).toBe(true);
    native.platform = 'electron';
    const desktop = await loadOnNewPage();
    expect(desktop.canBuildPrivateAppsOnDevice()).toBe(false);
    native.platform = 'web';
    calls.length = 0;
    const web = await loadOnNewPage();
    expect(web.canBuildPrivateAppsOnDevice()).toBe(false);
    web.retainPrivateAppsOnDevice(['a']);
    expect(calls).toEqual([]);
  });

  it('sends the zip in whole base64 pieces and returns the app address on the node', async () => {
    const host = await loadOnNewPage();
    calls.length = 0;
    const size = host.PRIVATE_APP_CHUNK_CHARS * 2 + 8;
    const zip = 'A'.repeat(size);
    const built = await host.buildPrivateAppOnDevice(
      'https://ext-node.qortal.link/',
      `data:application/zip;base64,${zip.slice(0, 10)}\n${zip.slice(10)}`
    );
    expect(built).toEqual({
      id: ID,
      url: `https://ext-node.qortal.link/render/hash/${ID}`,
    });
    expect(calls).toEqual([
      'begin:https://ext-node.qortal.link/',
      `append:${host.PRIVATE_APP_CHUNK_CHARS}`,
      `append:${host.PRIVATE_APP_CHUNK_CHARS}`,
      'append:8',
      'finish',
    ]);
    expect(host.PRIVATE_APP_CHUNK_CHARS % 4).toBe(0);
  });

  it('refuses an empty app before asking the native side', async () => {
    const host = await loadOnNewPage();
    calls.length = 0;
    await expect(
      host.buildPrivateAppOnDevice('https://ext-node.qortal.link', ' \n')
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('reads the app id only from an app address', async () => {
    const host = await loadOnNewPage();
    expect(
      host.privateAppIdFromUrl(`https://ext-node.qortal.link/render/hash/${ID}`)
    ).toBe(ID);
    expect(
      host.privateAppIdFromUrl(
        `http://127.0.0.1:12391/render/hash/${ID}/?theme=dark&lang=en`
      )
    ).toBe(ID);
    expect(
      host.privateAppIdFromUrl(
        `https://ext-node.qortal.link/render/hash/${ID}/index.html`
      )
    ).toBeNull();
    expect(
      host.privateAppIdFromUrl('https://ext-node.qortal.link/render/APP/Q-Tube')
    ).toBeNull();
    expect(host.privateAppIdFromUrl('not a url')).toBeNull();
    expect(host.privateAppIdFromUrl(undefined)).toBeNull();
  });

  it('lets the native side keep only the apps open tabs show', async () => {
    const host = await loadOnNewPage();
    calls.length = 0;
    host.retainPrivateAppsOnDevice([ID]);
    await Promise.resolve();
    expect(calls).toEqual([`retain:${ID}`]);
  });

  it('cleans a zip that came as a data URL', async () => {
    const host = await loadOnNewPage();
    expect(host.cleanZipBase64('data:application/zip;base64,UEsD\nBA==')).toBe(
      'UEsDBA=='
    );
    expect(host.cleanZipBase64('UEsDBA==')).toBe('UEsDBA==');
  });
});
