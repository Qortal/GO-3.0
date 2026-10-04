import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import { DirectRowAvatar } from './DirectRowAvatar';

const never = () => new Promise<Response>(() => {});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

const settle = () =>
  act(async () => {
    await flushAsync();
  });

const avatarRoot = () =>
  document.querySelector('[data-qdn-avatar]') as HTMLElement;

describe('DirectRowAvatar', () => {
  it('shows the cached picture at once and opens the preview with it', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Alice', PNG_BYTES);
    const onOpenPreview = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <DirectRowAvatar
          name="Alice"
          label="Alice"
          size={34}
          onOpenPreview={onOpenPreview}
        />
      </div>
    );
    await settle();

    const img = screen.getByAltText('Alice');
    expect(img.getAttribute('src')).toBe('blob:test/1');
    fireEvent.click(img);
    expect(onOpenPreview).toHaveBeenCalledWith('blob:test/1');
    // The tap opens the picture, not the chat.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows the first letter while there is no picture, and is not clickable', async () => {
    setQdnAvatarCacheForTests(
      createAvatarTestHarness({ handler: never }).cache
    );
    const onOpenPreview = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <DirectRowAvatar
          name="Bob"
          label="Bob"
          size={34}
          onOpenPreview={onOpenPreview}
        />
      </div>
    );
    await settle();

    expect(screen.queryByRole('img')).toBeNull();
    expect(avatarRoot().textContent).toBe('B');
    expect(avatarRoot().getAttribute('data-qdn-avatar')).toBe('fallback');
    fireEvent.click(avatarRoot());
    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('falls back to the letter when the picture cannot be shown', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);
    await h.cache.putImage('Carol', PNG_BYTES);
    const onOpenPreview = vi.fn();

    render(
      <DirectRowAvatar
        name="Carol"
        label="Carol"
        size={34}
        onOpenPreview={onOpenPreview}
      />
    );
    await settle();

    fireEvent.error(screen.getByAltText('Carol'));

    expect(screen.queryByAltText('Carol')).toBeNull();
    expect(avatarRoot().textContent).toBe('C');
    fireEvent.click(avatarRoot());
    expect(onOpenPreview).not.toHaveBeenCalled();
  });

  it('shows the Qortal logo for saved messages and looks nothing up', async () => {
    const h = createAvatarTestHarness({ handler: never });
    setQdnAvatarCacheForTests(h.cache);

    render(<DirectRowAvatar name="Me" label="Me" size={34} savedMessages />);
    await settle();

    expect(avatarRoot().querySelector('img[aria-hidden]')).not.toBeNull();
    expect(avatarRoot().textContent).toBe('');
    expect(h.calls).toEqual([]);
  });
});
