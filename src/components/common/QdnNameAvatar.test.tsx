import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import { QdnNameAvatar } from './QdnNameAvatar';

const imgSrc = (container: HTMLElement) =>
  container.querySelector('img')?.getAttribute('src') ?? null;

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('QdnNameAvatar', () => {
  it('shows the fallback, then the cached avatar', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QdnNameAvatar avatarName="Q-Mail" avatarIdentifier="qortal_avatar">
        Q
      </QdnNameAvatar>
    );
    expect(container.textContent).toBe('Q');
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBe('blob:test/1');
  });

  it('uses overrideSrc without asking the node', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = render(
      <QdnNameAvatar avatarName="Q-Mail" overrideSrc="http://node.test/x.png">
        Q
      </QdnNameAvatar>
    );
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(container)).toBe('http://node.test/x.png');
    expect(h.calls).toHaveLength(0);
  });

  it('shows only the fallback without a name or when disabled', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const none = render(<QdnNameAvatar avatarName={null}>N</QdnNameAvatar>);
    const off = render(
      <QdnNameAvatar avatarName="Alice" avatarEnabled={false}>
        A
      </QdnNameAvatar>
    );
    await act(async () => {
      await flushAsync();
    });
    expect(imgSrc(none.container)).toBeNull();
    expect(imgSrc(off.container)).toBeNull();
    expect(h.calls).toHaveLength(0);
  });
});
