import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useQdnAvatar } from '../lib/qdnAvatars';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../lib/qdnAvatars/testHarness';
import { useQdnAvatarSrc } from './useQdnAvatarSrc';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('useQdnAvatarSrc', () => {
  it('returns the cached image src', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    let src: string | undefined = 'unset';
    const Probe = () => {
      src = useQdnAvatarSrc('Alice');
      return null;
    };
    render(<Probe />);
    expect(src).toBeUndefined();
    await act(async () => {
      await flushAsync();
    });
    expect(src).toBe('blob:test/1');
    expect(h.calls[0].url).toContain('/arbitrary/THUMBNAIL/Alice/');
  });

  it('does not re-render on a status-only change (retry on a dead node)', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    const renders = { src: 0, snapshot: 0 };
    const SrcProbe = () => {
      useQdnAvatarSrc('Bob');
      renders.src += 1;
      return null;
    };
    const SnapshotProbe = () => {
      useQdnAvatar('Bob');
      renders.snapshot += 1;
      return null;
    };
    render(
      <>
        <SrcProbe />
        <SnapshotProbe />
      </>
    );
    await act(async () => {
      await flushAsync(10);
    });
    const before = { ...renders };
    await act(async () => {
      await h.advance(31_000);
      await flushAsync(10);
    });
    expect(h.calls.length).toBeGreaterThanOrEqual(2);
    // The full snapshot hook re-renders for failed -> loading -> failed.
    expect(renders.snapshot).toBeGreaterThan(before.snapshot);
    expect(renders.src).toBe(before.src);
  });

  it('asks the node for nothing when disabled or without a name', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const Probe = () => {
      useQdnAvatarSrc('Carol', { enabled: false });
      useQdnAvatarSrc('');
      return null;
    };
    render(<Probe />);
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls).toHaveLength(0);
  });

  it('loads a group avatar by identifier', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const Probe = () => {
      useQdnAvatarSrc('Owner', { identifier: 'qortal_group_avatar_7' });
      return null;
    };
    render(<Probe />);
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_7'
    );
  });
});
