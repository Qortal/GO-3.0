import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  PNG_BYTES,
} from '../lib/qdnAvatars/testHarness';
import {
  useShownQdnAvatarSrc,
  type ShownQdnAvatar,
  type ShownQdnAvatarOptions,
} from './useShownQdnAvatarSrc';

const never = () => new Promise<Response>(() => {});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

const probe = (name: string, options?: ShownQdnAvatarOptions) => {
  const latest: { current: ShownQdnAvatar | null } = { current: null };
  const Probe = () => {
    latest.current = useShownQdnAvatarSrc(name, options);
    return null;
  };
  render(<Probe />);
  return latest;
};

describe('useShownQdnAvatarSrc', () => {
  it('shows the cached picture until the WebView fails to decode it', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Alice', PNG_BYTES);

    const latest = probe('Alice');
    await act(async () => {
      await flushAsync();
    });
    expect(latest.current?.shownSrc).toBe('blob:test/1');

    act(() => latest.current?.onImgError());
    expect(latest.current?.shownSrc).toBeUndefined();
  });

  it('tries a new picture for the name again', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Alice', PNG_BYTES);

    const latest = probe('Alice');
    await act(async () => {
      await flushAsync();
    });
    act(() => latest.current?.onImgError());

    await act(async () => {
      await h.cache.putImage('Alice', PNG_BYTES);
      await flushAsync();
    });
    expect(latest.current?.shownSrc).toBe('blob:test/2');
  });

  it('never asks the cache for saved messages', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);

    const latest = probe('Saved Messages', { savedMessages: true });
    await act(async () => {
      await flushAsync();
    });
    expect(latest.current?.shownSrc).toBeUndefined();
    expect(h.calls).toEqual([]);
  });
});
