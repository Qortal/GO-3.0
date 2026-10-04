import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
  PNG_BYTES,
} from '../lib/qdnAvatars/testHarness';
import { resetOwnQdnAvatarRefreshForTests } from '../hooks/useOwnQdnAvatarRefresh';
import {
  pickQortalUserAvatarSrc,
  QortalUserAvatar,
  resetSharedWalletAvatarsForTests,
} from './QortalUserAvatar';

vi.mock('../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));

const walletDataUrl = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;

const imgSrc = (container: HTMLElement) =>
  container.querySelector('img')?.getAttribute('src') ?? null;

const hasPersonIcon = (container: HTMLElement) =>
  !!container.querySelector('[data-testid="PersonIcon"]');

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  resetSharedWalletAvatarsForTests();
  resetOwnQdnAvatarRefreshForTests();
  vi.unstubAllGlobals();
});

/** Records image loads, which jsdom never finishes itself. */
const stubImageLoads = () => {
  const loads: { url: string; onload: (() => void) | null }[] = [];
  vi.stubGlobal(
    'Image',
    class {
      url = '';
      decoding = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        this.url = value;
        if (value) loads.push(this);
      }
    }
  );
  return loads;
};

const FULL_SIZE_URL = 'http://node.test/arbitrary/THUMBNAIL/Lea/qortal_avatar';

describe('QortalUserAvatar', () => {
  it('shows the cached node image once it arrives', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(<QortalUserAvatar primaryName="Alice" />);
    expect(hasPersonIcon(container)).toBe(true);
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBe('blob:test/1');
    expect(h.calls[0].url).toContain('/arbitrary/THUMBNAIL/Alice/');
  });

  it('keeps the person icon and does not throw when the node is down', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(<QortalUserAvatar primaryName="Bob" />);
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBeNull();
    expect(hasPersonIcon(container)).toBe(true);
  });

  it('never asks the node when srcOverride is set (wallet picker)', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const empty = render(
      <QortalUserAvatar primaryName="Carol" srcOverride="" />
    );
    const given = render(
      <QortalUserAvatar primaryName="Carol" srcOverride={walletDataUrl} />
    );
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls).toHaveLength(0);
    expect(imgSrc(empty.container)).toBeNull();
    expect(imgSrc(given.container)).toBe(walletDataUrl);
  });

  it('shows the wallet avatar while the node is slow, then the cached image', async () => {
    let answer: (() => void) | null = null;
    const h = createAvatarTestHarness({
      handler: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(imageResponse());
        }),
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Dan"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'dan' }}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBe(walletDataUrl);
    await act(async () => {
      answer?.();
      await flushAsync();
    });
    expect(imgSrc(container)).toBe('blob:test/1');
  });

  it('ignores a wallet avatar saved for another name', async () => {
    const h = createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Eve"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'Mallory' }}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBeNull();
  });

  it('shares the wallet avatar with the cache when the node has none', async () => {
    const h = createAvatarTestHarness({
      handler: () => notPublishedResponse('Frank'),
    });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <QortalUserAvatar
        primaryName="Frank"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'Frank' }}
      />
    );
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.cache.getSnapshot(qdnAvatarKey('Frank'))).toMatchObject({
      status: 'ready',
      source: 'cache',
    });
  });

  it('shares the wallet avatar while the node fails, then takes its newer one', async () => {
    const NEW_AVATAR = new Uint8Array([...PNG_BYTES, 1, 2, 3]);
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Ivy"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'Ivy' }}
      />
    );
    await act(async () => {
      await flushAsync(10);
    });
    // Shared, so Home, chat and the user card show it on a failing node too.
    expect(h.cache.getSnapshot(qdnAvatarKey('Ivy'))).toMatchObject({
      source: 'cache',
      status: 'ready',
    });
    expect(imgSrc(container)).toBe('blob:test/1');
    expect(h.calls).toHaveLength(1);

    // The node is asked again about 10 min after the copy was shared (not
    // within the 30 s backoff, not after 24 h).
    h.setHandler(() => imageResponse(NEW_AVATAR));
    await act(async () => {
      await h.advance(60_000);
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(1);
    // A use, so the cache looks at the copy again (as a re-mount would).
    render(<QortalUserAvatar primaryName="Ivy" />);
    await act(async () => {
      await h.advance(10 * 60_000);
      await flushAsync(10);
    });
    render(<QortalUserAvatar primaryName="Ivy" />);
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(2);
    expect(imgSrc(container)).toBe('blob:test/2');
  });

  it('asks the node only once for the own avatar without a device copy', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    resetOwnQdnAvatarRefreshForTests({ sessionStartMs: h.now() });
    const { container } = render(
      <QortalUserAvatar primaryName="Lou" ownAvatar />
    );
    await act(async () => {
      await flushAsync(10);
    });
    expect(imgSrc(container)).toBe('blob:test/1');
    expect(h.calls).toHaveLength(1);
  });

  it('asks the node only once for a stale own avatar', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Max', PNG_BYTES);
    // Next app start, a day later: the device copy is stale.
    await h.advance(25 * 60 * 60_000);
    resetOwnQdnAvatarRefreshForTests({ sessionStartMs: h.now() });
    render(<QortalUserAvatar primaryName="Max" ownAvatar />);
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(1);
  });

  it('asks the node once per session for the own avatar', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    // A fresh copy on the device from an earlier session.
    await h.cache.putImage('Jill', PNG_BYTES);
    const first = render(<QortalUserAvatar primaryName="Jill" ownAvatar />);
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toContain('/arbitrary/THUMBNAIL/Jill/');
    first.unmount();

    render(<QortalUserAvatar primaryName="Jill" ownAvatar />);
    render(<QortalUserAvatar primaryName="Jill" />);
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(1);
  });

  it('loads the full-size image for big avatars, keeping the wallet copy meanwhile', async () => {
    const loads = stubImageLoads();
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Lea"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'Lea' }}
        sx={{ height: 84, width: 84 }}
      />
    );
    await act(async () => {
      await flushAsync(10);
    });
    // The cached copy is at most 128 px; the wallet copy is full size.
    expect(imgSrc(container)).toBe(walletDataUrl);
    const fullLoad = loads.find((load) => load.url === FULL_SIZE_URL);
    expect(fullLoad).toBeTruthy();
    act(() => {
      fullLoad?.onload?.();
    });
    expect(imgSrc(container)).toBe(FULL_SIZE_URL);
  });

  it('shows the cached copy of a big avatar until the full size loads', async () => {
    const loads = stubImageLoads();
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar primaryName="Lea" fullSize />
    );
    await act(async () => {
      await flushAsync(10);
    });
    expect(imgSrc(container)).toBe('blob:test/1');
    act(() => {
      loads.find((load) => load.url === FULL_SIZE_URL)?.onload?.();
    });
    expect(imgSrc(container)).toBe(FULL_SIZE_URL);
  });

  it('does not load the full size for small avatars', async () => {
    const loads = stubImageLoads();
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Lea"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: 'Lea' }}
        sx={{ height: 32, width: 32 }}
      />
    );
    await act(async () => {
      await flushAsync(10);
    });
    expect(imgSrc(container)).toBe('blob:test/1');
    // Only MUI's own load checks of the shown images.
    expect(loads.map((load) => load.url)).not.toContain(FULL_SIZE_URL);
    expect(loads.length).toBeGreaterThan(0);
  });

  it("does not re-check other users' fresh avatars", async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Kim', PNG_BYTES);
    render(<QortalUserAvatar primaryName="Kim" />);
    await act(async () => {
      await flushAsync(10);
    });
    expect(h.calls).toHaveLength(0);
  });

  it('does not share a wallet avatar saved without a name', async () => {
    const h = createAvatarTestHarness({
      handler: () => notPublishedResponse('Hank'),
    });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        primaryName="Hank"
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: '' }}
      />
    );
    await act(async () => {
      await flushAsync(10);
    });
    // Still shown here, as before, but not copied into the shared cache.
    expect(imgSrc(container)).toBe(walletDataUrl);
    expect(h.cache.getSnapshot(qdnAvatarKey('Hank')).source).toBeNull();
  });

  it('shows a wallet avatar without a name and without the node', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QortalUserAvatar
        cachedAvatarEntry={{ dataUrl: walletDataUrl, primaryName: '' }}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBe(walletDataUrl);
    expect(h.calls).toHaveLength(0);
  });
});

describe('pickQortalUserAvatarSrc', () => {
  const loading = { src: undefined, status: 'loading', source: null } as const;
  const seed = {
    src: '/seed.webp',
    status: 'loading',
    source: 'seed',
  } as const;
  const ready = { src: 'blob:x', status: 'ready', source: 'cache' } as const;
  const entry = { dataUrl: walletDataUrl, primaryName: 'Gina' };

  it('orders override > cached image > wallet copy > seed', () => {
    expect(
      pickQortalUserAvatarSrc({
        srcOverride: 'data:a',
        primaryName: 'Gina',
        cachedAvatarEntry: entry,
        cached: ready,
      })
    ).toBe('data:a');
    expect(
      pickQortalUserAvatarSrc({
        primaryName: 'Gina',
        cachedAvatarEntry: entry,
        cached: ready,
      })
    ).toBe('blob:x');
    expect(
      pickQortalUserAvatarSrc({
        primaryName: 'Gina',
        cachedAvatarEntry: entry,
        cached: seed,
      })
    ).toBe(walletDataUrl);
    expect(pickQortalUserAvatarSrc({ primaryName: 'Gina', cached: seed })).toBe(
      '/seed.webp'
    );
    expect(
      pickQortalUserAvatarSrc({ primaryName: 'Gina', cached: loading })
    ).toBeUndefined();
  });

  it('prefers the full size, then the exact-name wallet copy for big avatars', () => {
    expect(
      pickQortalUserAvatarSrc({
        primaryName: 'Gina',
        cachedAvatarEntry: entry,
        cached: ready,
        fullSizeSrc: 'http://node/full',
        preferWalletCopy: true,
      })
    ).toBe('http://node/full');
    expect(
      pickQortalUserAvatarSrc({
        primaryName: 'Gina',
        cachedAvatarEntry: entry,
        cached: ready,
        preferWalletCopy: true,
      })
    ).toBe(walletDataUrl);
    // A legacy copy without a name may be an earlier name's avatar.
    expect(
      pickQortalUserAvatarSrc({
        primaryName: 'Gina',
        cachedAvatarEntry: { dataUrl: walletDataUrl, primaryName: '' },
        cached: ready,
        preferWalletCopy: true,
      })
    ).toBe('blob:x');
  });
});
