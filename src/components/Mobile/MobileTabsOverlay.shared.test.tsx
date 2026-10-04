import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { qdnAvatarKey } from '../../lib/qdnAvatars';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import { TabAvatar } from './MobileTabsOverlay.shared';

const Q_TUBE_SEED = '/seeds/q-tube.webp';
const never = () => new Promise<Response>(() => {});

function installHarness(
  options: Parameters<typeof createAvatarTestHarness>[0]
) {
  const harness = createAvatarTestHarness(options);
  setQdnAvatarCacheForTests(harness.cache);
  return harness;
}

const iconSrc = (container: HTMLElement) =>
  container.querySelector('img')?.getAttribute('src') ?? null;

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('TabAvatar', () => {
  it('shows the cached app icon at once', async () => {
    const h = installHarness({ handler: never });
    await h.cache.putImage('Q-Mail', PNG_BYTES);

    const { container } = render(
      <TabAvatar tab={{ name: 'Q-Mail' }} title="Q-Mail" color="#5b8def" />
    );

    expect(iconSrc(container)).toBe('blob:test/1');
    expect(h.calls).toHaveLength(0);
  });

  it('shows the icon GO ships, then the live one', async () => {
    const h = installHarness({
      seeds: { [qdnAvatarKey('Q-Tube')!]: Q_TUBE_SEED },
      handler: never,
    });

    const { container } = render(
      <TabAvatar tab={{ name: 'Q-Tube' }} title="Q-Tube" color="#5b8def" />
    );
    expect(iconSrc(container)).toBe(Q_TUBE_SEED);

    h.setHandler(() => imageResponse());
    await act(async () => {
      h.cache.refresh('Q-Tube');
      await flushAsync();
    });
    expect(iconSrc(container)).toBe('blob:test/1');
  });

  it('shows the letter while there is no icon', () => {
    installHarness({ handler: never });

    const { container, getByText } = render(
      <TabAvatar tab={{ name: 'New-App' }} title="New App" color="#5b8def" />
    );

    expect(iconSrc(container)).toBeNull();
    expect(getByText('N')).toBeInTheDocument();
  });

  it('falls back to the letter when an icon cannot load, and tries a new one', async () => {
    const h = installHarness({
      seeds: { [qdnAvatarKey('Q-Tube')!]: Q_TUBE_SEED },
      handler: never,
    });
    const { container, getByText } = render(
      <TabAvatar tab={{ name: 'Q-Tube' }} title="Q-Tube" color="#5b8def" />
    );

    fireEvent.error(container.querySelector('img')!);
    expect(iconSrc(container)).toBeNull();
    expect(getByText('Q')).toBeInTheDocument();

    await act(async () => {
      await h.cache.putImage('Q-Tube', PNG_BYTES);
    });
    expect(iconSrc(container)).toBe('blob:test/1');
  });

  it('uses a private logo, and fetches nothing for it or for GO screens', async () => {
    const h = installHarness({ handler: () => imageResponse() });

    const privateTab = render(
      <TabAvatar
        tab={{ name: 'Owner', privateAppProperties: { logo: '/logo.png' } }}
        title="Private"
        color="#5b8def"
      />
    );
    const internalTab = render(
      <TabAvatar
        tab={{ name: 'Chat', internal: 'chat' }}
        title="Chat"
        color="#5b8def"
      />
    );
    await act(async () => {
      await flushAsync();
    });

    expect(iconSrc(privateTab.container)).toBe('/logo.png');
    expect(iconSrc(internalTab.container)).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it("never shows the publisher's avatar for a private app without a logo", async () => {
    const h = installHarness({ handler: () => imageResponse() });
    await h.cache.putImage('Owner', PNG_BYTES);

    const { container, getByText } = render(
      <TabAvatar
        tab={{ name: 'Owner', isPrivate: true }}
        title="My App"
        color="#5b8def"
      />
    );
    await act(async () => {
      await flushAsync();
    });

    expect(iconSrc(container)).toBeNull();
    expect(getByText('M')).toBeInTheDocument();
    expect(h.calls).toHaveLength(0);
  });
});
