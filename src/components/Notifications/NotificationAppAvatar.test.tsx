import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));

import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import { NotificationAppAvatar } from './NotificationAppAvatar';

const QMAIL_SEED = '/seeds/q-mail.webp';

const setup = () => {
  const h = createAvatarTestHarness({
    // A slow node: nothing arrives during the test.
    handler: () => new Promise<Response>(() => {}),
    seeds: { 'THUMBNAIL/q-mail/qortal_avatar': QMAIL_SEED },
  });
  setQdnAvatarCacheForTests(h.cache);
  return h;
};

const sources = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).map((img) =>
    img.getAttribute('src')
  );

const renderAvatar = async (
  notification: Record<string, unknown>,
  flags: { isQChatMention?: boolean; isQMail?: boolean } = {}
) => {
  const result = render(
    <NotificationAppAvatar
      alt="App"
      isQChatMention={flags.isQChatMention ?? false}
      isQMail={flags.isQMail ?? false}
      notification={notification}
    />
  );
  await act(async () => {
    await flushAsync();
  });
  return result;
};

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('NotificationAppAvatar', () => {
  it('shows the Q-Mail icon from the device, without a node URL in the page', async () => {
    const h = setup();
    const { container } = await renderAvatar(
      {
        appName: 'Q-Mail',
        image: '/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true',
      },
      { isQMail: true }
    );
    expect(sources(container)).toEqual([QMAIL_SEED]);
    expect(container.innerHTML).not.toContain('node.test');
    // The cache asks the node in the background (for the live icon).
    expect(h.calls[0]?.url).toContain('/arbitrary/THUMBNAIL/Q-Mail/');
  });

  it('shows the cached live icon once the cache has it', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    const { container } = await renderAvatar({ appName: 'Q-Tube' });
    expect(sources(container)).toEqual(['blob:test/1']);
  });

  it('drops images on other hosts and shows the logo, without a request', async () => {
    const h = setup();
    const { container } = await renderAvatar({
      appName: 'Some App',
      image: 'https://tracker.example/pixel.png',
    });
    expect(sources(container)).toEqual([LogoSelected]);
    expect(container.innerHTML).not.toContain('tracker.example');
    expect(h.calls).toHaveLength(0);
  });

  it('makes no request for Q-Chat mentions', async () => {
    const h = setup();
    const { container } = await renderAvatar(
      { appName: 'Q-Chat', image: '' },
      { isQChatMention: true }
    );
    expect(sources(container)).toEqual([LogoSelected]);
    expect(h.calls).toHaveLength(0);
  });

  it('keeps the bundled logo of Reticulum notifications at its small size', async () => {
    const h = setup();
    const { container } = await renderAvatar({
      appName: 'Q-Chat',
      image: LogoSelected,
    });
    const images = Array.from(container.querySelectorAll('img'));
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      LogoSelected,
    ]);
    // The 20 px child logo, not the avatar image filling the circle.
    expect(images[0].style.width).toBe('20px');
    expect(h.calls).toHaveLength(0);
  });

  it('asks the cache for other QDN thumbnails, with the logo meanwhile', async () => {
    const h = setup();
    const { container } = await renderAvatar({
      appName: 'Some App',
      image: '/arbitrary/THUMBNAIL/Some App/other_icon',
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toContain('/THUMBNAIL/Some%20App/other_icon');
    expect(sources(container)).toEqual([LogoSelected]);
  });

  it("shows other images of the user's own node as they are", async () => {
    const h = setup();
    const { container } = await renderAvatar({
      appName: 'Some App',
      image: '/arbitrary/IMAGE/someone/banner',
    });
    expect(h.calls).toHaveLength(0);
    expect(sources(container)).toEqual([
      'http://node.test/arbitrary/IMAGE/someone/banner',
    ]);
  });
});
