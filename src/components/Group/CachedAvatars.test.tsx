import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQdnAvatarCache } from '../../lib/qdnAvatars/avatarCache';
import { createMemoryAvatarStore } from '../../lib/qdnAvatars/avatarStore';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  notPublishedResponse,
} from '../../lib/qdnAvatars/testHarness';
import {
  avatarFallback,
  CachedGroupAvatar,
  CachedUserAvatar,
  mergeAvatarSx,
} from './CachedAvatars';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

const settle = () =>
  act(async () => {
    await flushAsync();
  });

const imgOf = (testId: string) =>
  screen.getByTestId(testId).querySelector('img');

describe('CachedUserAvatar', () => {
  it('shows the cached image once it arrives, the fallback before', async () => {
    let answer: () => void = () => {};
    const h = createAvatarTestHarness({
      handler: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(imageResponse());
        }),
    });
    setQdnAvatarCacheForTests(h.cache);

    render(
      <CachedUserAvatar data-testid="a" name="Alice" alt="Alice">
        A
      </CachedUserAvatar>
    );
    await settle();
    expect(imgOf('a')).toBeNull();
    expect(screen.getByTestId('a').textContent).toBe('A');
    expect(screen.getByTestId('a').getAttribute('data-qdn-avatar')).toBe(
      'loading'
    );

    await act(async () => {
      answer();
      await flushAsync();
    });
    expect(imgOf('a')?.getAttribute('src')).toBe('blob:test/1');
    expect(screen.getByTestId('a').getAttribute('data-qdn-avatar')).toBe(
      'ready'
    );
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true'
    );
  });

  it('shows an already cached image on the first render', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const key = qdnAvatarKey('Bob');
    h.cache.request(key, { name: 'Bob' });
    await flushAsync();
    expect(h.calls).toHaveLength(1);

    render(<CachedUserAvatar data-testid="b" name="bob" alt="bob" />);
    expect(imgOf('b')?.getAttribute('src')).toBe('blob:test/1');
    await settle();
    // Fresh in the cache: the node is not asked again.
    expect(h.calls).toHaveLength(1);
  });

  it('keeps the letter of alt as the fallback when no children are given', async () => {
    const h = createAvatarTestHarness({
      handler: () => notPublishedResponse('Carol'),
    });
    setQdnAvatarCacheForTests(h.cache);
    render(<CachedUserAvatar data-testid="c" name="Carol" alt="Carol" />);
    await settle();
    expect(imgOf('c')).toBeNull();
    expect(screen.getByTestId('c').textContent).toBe('C');
    expect(screen.getByTestId('c').getAttribute('data-qdn-avatar')).toBe(
      'missing'
    );
  });

  it('shows the person icon and asks nothing without a name', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(<CachedUserAvatar data-testid="d" name="" alt="someone" />);
    await settle();
    expect(screen.getByTestId('PersonIcon')).toBeTruthy();
    expect(h.calls).toHaveLength(0);
  });

  it('does not look anything up when disabled', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <CachedUserAvatar data-testid="e" name="Eve" enabled={false}>
        E
      </CachedUserAvatar>
    );
    await settle();
    expect(h.calls).toHaveLength(0);
    expect(screen.getByTestId('e').textContent).toBe('E');
    expect(screen.getByTestId('e').getAttribute('data-qdn-avatar')).toBe(
      'idle'
    );
  });

  it('passes priority and countUse to the cache, and not to the DOM', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const request = vi.spyOn(h.cache, 'request');
    const noteUse = vi.spyOn(h.cache, 'noteUse');
    render(
      <>
        <CachedUserAvatar
          data-testid="s"
          name="Searched"
          priority="low"
          countUse={false}
        />
        <CachedGroupAvatar
          data-testid="g"
          ownerName="Owner"
          groupId={9}
          priority="low"
          countUse={false}
        />
        <CachedUserAvatar data-testid="c" name="Contact" />
      </>
    );
    await settle();
    expect(request).toHaveBeenCalledWith(qdnAvatarKey('Searched'), {
      name: 'Searched',
      priority: 'low',
    });
    expect(request).toHaveBeenCalledWith(
      qdnAvatarKey('Owner', 'qortal_group_avatar_9'),
      { name: 'Owner', priority: 'low' }
    );
    expect(noteUse.mock.calls.map(([key]) => key)).toEqual([
      qdnAvatarKey('Contact'),
    ]);
    expect(screen.getByTestId('s').hasAttribute('countuse')).toBe(false);
    expect(screen.getByTestId('s').hasAttribute('priority')).toBe(false);
  });

  it('passes whether an image is shown to sxWithImage', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const sxWithImage = vi.fn(() => ({}));
    render(
      <CachedUserAvatar name="Frank" sxWithImage={sxWithImage}>
        F
      </CachedUserAvatar>
    );
    expect(sxWithImage).toHaveBeenLastCalledWith(false);
    await settle();
    expect(sxWithImage).toHaveBeenLastCalledWith(true);
  });

  it('renders the fallback when the node address cannot be resolved', async () => {
    const cache = createQdnAvatarCache({
      getApiBase: () => {
        throw new Error('no node yet');
      },
      openStore: async () => createMemoryAvatarStore(),
      fetch: async () => imageResponse(),
      downscale: async (image) => image,
    });
    setQdnAvatarCacheForTests(cache);
    expect(() =>
      render(
        <CachedUserAvatar data-testid="g" name="Grace">
          G
        </CachedUserAvatar>
      )
    ).not.toThrow();
    await settle();
    expect(imgOf('g')).toBeNull();
    expect(screen.getByTestId('g').textContent).toBe('G');
  });

  it('shows the bundled seed for a well-known Q-App at once', () => {
    const key = qdnAvatarKey('Q-Tube');
    const h = createAvatarTestHarness({
      seeds: { [key]: '/seed/q-tube.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    render(<CachedUserAvatar data-testid="q" name="Q-Tube" alt="Q-Tube" />);
    expect(imgOf('q')?.getAttribute('src')).toBe('/seed/q-tube.webp');
  });
});

describe('CachedGroupAvatar', () => {
  it('loads the owner-published group avatar', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <CachedGroupAvatar data-testid="grp" ownerName="Owner" groupId={12}>
        G
      </CachedGroupAvatar>
    );
    await settle();
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_12?async=true'
    );
    expect(imgOf('grp')?.getAttribute('src')).toBe('blob:test/1');
  });

  it('keeps the fallback without an owner or group id', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <>
        <CachedGroupAvatar data-testid="no-owner" groupId={3}>
          X
        </CachedGroupAvatar>
        <CachedGroupAvatar data-testid="no-id" ownerName="Owner">
          Y
        </CachedGroupAvatar>
      </>
    );
    await settle();
    expect(h.calls).toHaveLength(0);
    expect(screen.getByTestId('no-owner').textContent).toBe('X');
    expect(screen.getByTestId('no-id').textContent).toBe('Y');
  });
});

describe('helpers', () => {
  it('merges sx values into one list', () => {
    expect(mergeAvatarSx(undefined, undefined)).toBeUndefined();
    expect(mergeAvatarSx({ width: 1 }, undefined)).toEqual({ width: 1 });
    expect(mergeAvatarSx(undefined, { width: 2 })).toEqual({ width: 2 });
    expect(mergeAvatarSx([{ width: 1 }], { height: 2 })).toEqual([
      { width: 1 },
      { height: 2 },
    ]);
  });

  it('picks the same fallback MUI used for a failed image', () => {
    expect(avatarFallback('X', true, 'Alice')).toBe('X');
    expect(avatarFallback(undefined, true, 'Alice')).toBe('A');
    expect(avatarFallback(undefined, false, 'Alice')).toBeUndefined();
    expect(avatarFallback(undefined, true, '')).toBeUndefined();
  });
});
