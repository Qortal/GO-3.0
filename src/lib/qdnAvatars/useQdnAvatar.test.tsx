import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setQdnAvatarCacheForTests } from './defaultCache';
import { qdnAvatarKey } from './keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from './testHarness';
import { useQdnAvatar, useQdnGroupAvatar } from './useQdnAvatar';

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

const renders: Record<string, number> = {};

function Avatar({ name }: { name: string }) {
  renders[name] = (renders[name] ?? 0) + 1;
  const { src, status } = useQdnAvatar(name);
  return <span data-testid={name}>{`${status}:${src ?? '-'}`}</span>;
}

describe('useQdnAvatar', () => {
  it('re-renders only the avatar whose image arrived', async () => {
    const answers: Record<string, () => void> = {};
    const h = createAvatarTestHarness({
      handler: (_url, { name }) =>
        new Promise<Response>((resolve) => {
          answers[name] = () => resolve(imageResponse());
        }),
    });
    setQdnAvatarCacheForTests(h.cache);

    render(
      <>
        <Avatar name="Alice" />
        <Avatar name="Bob" />
      </>
    );
    await act(async () => {
      await flushAsync();
    });
    expect(screen.getByTestId('Alice').textContent).toBe('loading:-');
    const bobRenders = renders.Bob;

    await act(async () => {
      answers.Alice();
      await flushAsync();
    });
    expect(screen.getByTestId('Alice').textContent).toBe('ready:blob:test/1');
    expect(screen.getByTestId('Bob').textContent).toBe('loading:-');
    expect(renders.Bob).toBe(bobRenders);
  });

  it('shows a bundled seed at once', () => {
    const key = qdnAvatarKey('Q-Tube')!;
    const h = createAvatarTestHarness({
      seeds: { [key]: '/assets/q-tube.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useQdnAvatar('q-tube'));
    expect(result.current).toEqual({
      src: '/assets/q-tube.webp',
      status: 'loading',
      source: 'seed',
    });
  });

  it('is idle without a name or when disabled, and does not fetch', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const empty = renderHook(() => useQdnAvatar('  '));
    const disabled = renderHook(() =>
      useQdnAvatar('Carol', { enabled: false })
    );
    await act(async () => {
      await flushAsync();
    });
    expect(empty.result.current.status).toBe('idle');
    expect(disabled.result.current.status).toBe('idle');
    expect(h.calls).toHaveLength(0);
  });

  it('follows a name change', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result, rerender } = renderHook(({ name }) => useQdnAvatar(name), {
      initialProps: { name: 'Dan' },
    });
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.status).toBe('ready');
    rerender({ name: 'Eve' });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.src).toBe('blob:test/2');
    expect(h.calls.map((call) => call.name)).toEqual(['Dan', 'Eve']);
  });

  it('loads group avatars by owner and group id', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { result } = renderHook(() => useQdnGroupAvatar('Owner', 12));
    await act(async () => {
      await flushAsync();
    });
    expect(result.current.status).toBe('ready');
    expect(h.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Owner/qortal_group_avatar_12?async=true'
    );
    const none = renderHook(() => useQdnGroupAvatar('Owner', null));
    expect(none.result.current.status).toBe('idle');
  });
});
