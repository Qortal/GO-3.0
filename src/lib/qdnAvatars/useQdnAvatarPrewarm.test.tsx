import { renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPublicNodeUnavailableAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { executeEvent } from '../../utils/events';
import { setQdnAvatarCacheForTests } from './defaultCache';
import { getQdnAvatarSnapshot } from './index';
import { resetQdnAvatarPrewarmStateForTests } from './prewarmScheduler';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  PNG_BYTES,
  type RequestKind,
} from './testHarness';
import { seedOwnQdnAvatarFromWalletCache } from './prewarmRuntime';
import { useQdnAvatarPrewarm } from './useQdnAvatarPrewarm';

const walletAvatar = vi.hoisted(() => ({
  entry: null as null | { dataUrl: string; primaryName: string },
}));

vi.mock('../../utils/walletAvatarCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/walletAvatarCache')>()),
  getWalletAvatarCache: vi.fn(async () => walletAvatar.entry),
}));

const ME = 'QfX9KhXnoB78v2D36j7nocKaYtzUYcyQyH';
const OTHER = 'QbPDbE1qEC6p8DJHRXrrj9tPHqgPEuohgs';
const FAST = {
  initialDelayMs: 0,
  attemptGapMs: 0,
  followUpDelayMs: 60 * 60 * 1000,
  busyDelayMs: 20,
  quietCheckMs: 5,
};

const statusOf = (h: ReturnType<typeof setup>['h'], name: string) =>
  h.cache.getSnapshot(h.cache.keyFor(name));

const pngDataUrl = () =>
  `data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`;

function setup(
  handler: (
    url: string,
    info: { kind: RequestKind; name: string }
  ) => Response | Promise<Response> = () => imageResponse()
) {
  const h = createAvatarTestHarness({ handler });
  setQdnAvatarCacheForTests(h.cache);
  const store = createStore();
  store.set(sortablePinnedAppsAtom, []);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children);
  return { h, store, wrapper };
}

beforeEach(() => {
  resetQdnAvatarPrewarmStateForTests();
  walletAvatar.entry = null;
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('useQdnAvatarPrewarm', () => {
  it('does nothing before login', async () => {
    const { h, store, wrapper } = setup();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    renderHook(
      () => useQdnAvatarPrewarm({ enabled: false, address: ME, timing: FAST }),
      { wrapper }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.calls).toEqual([]);
  });

  it('prewarms the own avatar and open tabs first, bundled Q-Apps last', async () => {
    const { h, store, wrapper } = setup();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    renderHook(
      () => useQdnAvatarPrewarm({ enabled: true, address: ME, timing: FAST }),
      { wrapper }
    );
    executeEvent('setTabsToNav', {
      data: { tabs: [{ service: 'APP', name: 'Open App' }] },
    });
    await waitFor(() => expect(h.calls).toHaveLength(7));
    expect(h.calls.map((call) => call.name)).toEqual([
      'Me',
      'Open App',
      'Q-Tube',
      'Quitter',
      'Q-Mail',
      'SubWire',
      'Q-Trade',
    ]);
    expect(h.calls.every((call) => call.kind === 'async')).toBe(true);
  });

  it('still reaches the other avatars when the ones Home shows fail on a slow node', async () => {
    const hanging: Array<() => void> = [];
    const slow = ['Me', 'Q-Tube', 'Quitter'];
    const { h, store, wrapper } = setup((_url, info) =>
      slow.includes(info.name)
        ? new Promise<Response>((_resolve, reject) => {
            hanging.push(() => reject(new TypeError('timed out')));
          })
        : imageResponse()
    );
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    // The top bar and Home ask for these right after login.
    for (const name of slow) {
      h.cache.request(h.cache.keyFor(name), { name, priority: 'high' });
    }
    renderHook(
      () => useQdnAvatarPrewarm({ enabled: true, address: ME, timing: FAST }),
      { wrapper }
    );
    executeEvent('setTabsToNav', {
      data: { tabs: [{ service: 'APP', name: 'Open App' }] },
    });
    await waitFor(() => expect(hanging).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Visible avatars first: the prewarm asks nothing meanwhile.
    expect(h.calls.map((call) => call.name)).toEqual(slow);

    for (const fail of hanging.splice(0)) fail();
    await waitFor(() => expect(h.calls).toHaveLength(7));
    await flushAsync(10);
    // Their failures did not end the run: the rest was still fetched.
    expect(h.calls.slice(3).map((call) => call.name)).toEqual([
      'Open App',
      'Q-Mail',
      'SubWire',
      'Q-Trade',
    ]);
  });

  it('skips the run while the node is known to be unavailable', async () => {
    const { h, store, wrapper } = setup();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    store.set(isPublicNodeUnavailableAtom, true);
    renderHook(
      () => useQdnAvatarPrewarm({ enabled: true, address: ME, timing: FAST }),
      { wrapper }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.calls).toEqual([]);
  });

  it('stops when the wallet locks or signs out', async () => {
    let release: (() => void) | null = null;
    const { h, store, wrapper } = setup(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(imageResponse());
        })
    );
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    const { rerender } = renderHook(
      ({ enabled }) =>
        useQdnAvatarPrewarm({ enabled, address: ME, timing: FAST }),
      { wrapper, initialProps: { enabled: true } }
    );
    await waitFor(() => expect(h.calls).toHaveLength(1));
    rerender({ enabled: false });
    release?.();
    await flushAsync(10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.calls).toHaveLength(1);
  });

  it('an account switch waits for the old avatar and keeps its tabs out', async () => {
    let releaseMe: (() => void) | null = null;
    const { h, store, wrapper } = setup((_url, info) =>
      info.name === 'Me'
        ? new Promise<Response>((resolve) => {
            releaseMe = () => resolve(imageResponse());
          })
        : imageResponse()
    );
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    const { rerender } = renderHook(
      ({ address }) =>
        useQdnAvatarPrewarm({ enabled: true, address, timing: FAST }),
      { wrapper, initialProps: { address: ME } }
    );
    executeEvent('setTabsToNav', {
      data: { tabs: [{ service: 'APP', name: 'Tab Of Me' }] },
    });
    // The first account's run is stuck on its own avatar (slow node).
    await waitFor(() => expect(h.calls).toHaveLength(1));

    store.set(userInfoAtom, { address: OTHER, name: 'Other' });
    rerender({ address: OTHER });
    // One prewarm avatar at a time, app-wide: the new account waits.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.calls.map((call) => call.name)).toEqual(['Me']);

    releaseMe?.();
    await waitFor(() => expect(h.calls).toHaveLength(7));
    await flushAsync(10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Each avatar once: the old run stopped after its own avatar, and the
    // new one did not take the first account's open tab.
    expect(h.calls.map((call) => call.name)).toEqual([
      'Me',
      'Other',
      'Q-Tube',
      'Quitter',
      'Q-Mail',
      'SubWire',
      'Q-Trade',
    ]);
  });

  it('uses the wallet picker copy while the node is unavailable', async () => {
    const { h, store, wrapper } = setup(() => {
      throw new TypeError('offline');
    });
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    store.set(isPublicNodeUnavailableAtom, true);
    walletAvatar.entry = { dataUrl: pngDataUrl(), primaryName: 'Me' };
    // The top bar asked for it and the node did not answer.
    h.cache.request(h.cache.keyFor('Me'), { name: 'Me', priority: 'high' });
    await h.idle();
    expect(statusOf(h, 'Me').status).toBe('failed');

    renderHook(
      () => useQdnAvatarPrewarm({ enabled: true, address: ME, timing: FAST }),
      { wrapper }
    );
    // No prewarm run happens, but the own avatar still shows.
    await waitFor(() =>
      expect(statusOf(h, 'Me')).toMatchObject({
        status: 'ready',
        source: 'cache',
      })
    );
    expect(h.calls).toHaveLength(1);
  });

  it('a lock / unlock right after a run does not start another run', async () => {
    const { h, store, wrapper } = setup();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    const { rerender } = renderHook(
      ({ enabled }) =>
        useQdnAvatarPrewarm({ enabled, address: ME, timing: FAST }),
      { wrapper, initialProps: { enabled: true } }
    );
    await waitFor(() => expect(h.calls).toHaveLength(6));
    await flushAsync(10);

    rerender({ enabled: false });
    // A new tab would be fetched by any new run.
    executeEvent('setTabsToNav', {
      data: { tabs: [{ service: 'APP', name: 'New Tab' }] },
    });
    rerender({ enabled: true });
    await flushAsync(10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.calls).toHaveLength(6);
  });
});

describe('seedOwnQdnAvatarFromWalletCache', () => {
  it('uses the wallet picker copy when the node failed', async () => {
    const { store } = setup(() => {
      throw new TypeError('offline');
    });
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    walletAvatar.entry = { dataUrl: pngDataUrl(), primaryName: 'Me' };

    // Nothing failed yet: leave the cache alone.
    await expect(seedOwnQdnAvatarFromWalletCache(store, ME)).resolves.toBe(
      false
    );

    const { prewarmQdnAvatars } = await import('./index');
    await prewarmQdnAvatars(['Me']);
    expect(getQdnAvatarSnapshot('Me').status).toBe('failed');

    await expect(seedOwnQdnAvatarFromWalletCache(store, ME)).resolves.toBe(
      true
    );
    expect(getQdnAvatarSnapshot('Me')).toMatchObject({
      status: 'ready',
      source: 'cache',
    });
  });

  it('does not use a picker copy saved without this name', async () => {
    const { store } = setup(() => {
      throw new TypeError('offline');
    });
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    // Older copies carry no name: it may be a previous avatar.
    walletAvatar.entry = { dataUrl: pngDataUrl(), primaryName: '' };
    const { prewarmQdnAvatars } = await import('./index');
    await prewarmQdnAvatars(['Me']);
    expect(getQdnAvatarSnapshot('Me').status).toBe('failed');
    await expect(seedOwnQdnAvatarFromWalletCache(store, ME)).resolves.toBe(
      false
    );
    expect(getQdnAvatarSnapshot('Me').status).toBe('failed');
  });

  it('reads the status without keeping the object URL alive', async () => {
    const { h, store } = setup();
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    walletAvatar.entry = { dataUrl: pngDataUrl(), primaryName: 'Me' };
    const { prewarmQdnAvatars } = await import('./index');
    await prewarmQdnAvatars(['Me']);
    h.cache.request(h.cache.keyFor('Me'), { name: 'Me' });
    await h.idle();
    expect(statusOf(h, 'Me').status).toBe('ready');
    await expect(seedOwnQdnAvatarFromWalletCache(store, ME)).resolves.toBe(
      false
    );
    // A retained URL would never be revoked when the avatar is refreshed.
    expect(h.cache.debugState().retainedUrls).toEqual([]);
  });

  it('leaves a confirmed missing avatar and other accounts alone', async () => {
    const { store } = setup(
      () =>
        new Response(
          JSON.stringify({
            error: 1401,
            message:
              "Couldn't find PUT transaction for name Me, service THUMBNAIL and identifier qortal_avatar",
          }),
          { status: 404 }
        )
    );
    store.set(userInfoAtom, { address: ME, name: 'Me' });
    walletAvatar.entry = { dataUrl: pngDataUrl(), primaryName: 'Me' };
    const { prewarmQdnAvatars } = await import('./index');
    await prewarmQdnAvatars(['Me']);
    expect(getQdnAvatarSnapshot('Me').status).toBe('missing');
    await expect(seedOwnQdnAvatarFromWalletCache(store, ME)).resolves.toBe(
      false
    );
    await expect(
      seedOwnQdnAvatarFromWalletCache(store, 'QSomeoneElse')
    ).resolves.toBe(false);
  });
});
