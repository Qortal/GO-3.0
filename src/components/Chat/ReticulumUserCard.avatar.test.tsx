import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
} from '../../lib/qdnAvatars/testHarness';
import { ReticulumUserCard } from './ReticulumUserCard';

vi.mock('../../App', () => ({
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForPrimaryName: () => 'http://node.test',
}));

vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));

// Records image loads (MUI Avatar's and the full-size preview's), which
// jsdom never finishes itself.
type FakeLoad = { url: string; onload: (() => void) | null };
const imageLoads: FakeLoad[] = [];
class FakeImage {
  url = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    this.url = value;
    imageLoads.push(this);
  }
}
const FULL_URL = 'http://node.test/arbitrary/THUMBNAIL/Alice/qortal_avatar';

const cardData = {
  address: 'Qalice',
  isMinterResolved: true,
  isOwn: false,
  minterLevel: null,
  name: 'Alice',
  status: null,
};

beforeEach(() => {
  imageLoads.length = 0;
  vi.stubGlobal('Image', FakeImage);
  // Profile lookups (name, balance) are not under test here.
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response('{}', { status: 404 })
  );
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReticulumUserCard avatar', () => {
  it('shows the cached avatar and previews the full-size image', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <ReticulumUserCard
        anchorEl={null}
        anchorPosition={{ left: 10, top: 10 }}
        data={cardData}
        onClose={() => undefined}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    const button = screen.getByRole('button', { name: "Open Alice's avatar" });
    expect(button.querySelector('img')?.getAttribute('src')).toBe(
      'blob:test/1'
    );

    fireEvent.click(button);
    // The small cached image opens at once...
    const sources = () =>
      Array.from(document.querySelectorAll('img')).map((img) =>
        img.getAttribute('src')
      );
    expect(sources()).toEqual(['blob:test/1', 'blob:test/1']);
    const fullLoads = imageLoads.filter((load) => load.url === FULL_URL);
    expect(fullLoads.length).toBeGreaterThan(0);
    // ...and the full-size image replaces it once loaded.
    act(() => {
      for (const load of fullLoads) load.onload?.();
    });
    expect(sources()).toEqual([FULL_URL, FULL_URL]);
  });

  it('sharpens the card avatar with the full-size image once loaded', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <ReticulumUserCard
        anchorEl={null}
        anchorPosition={{ left: 10, top: 10 }}
        data={cardData}
        onClose={() => undefined}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    const button = screen.getByRole('button', { name: "Open Alice's avatar" });
    const shown = () => button.querySelector('img')?.getAttribute('src');
    // The cached copy (at most 128 px) at once...
    expect(shown()).toBe('blob:test/1');
    const fullLoad = imageLoads.find((load) => load.url === FULL_URL);
    expect(fullLoad).toBeTruthy();
    act(() => {
      fullLoad?.onload?.();
    });
    // ...then the full-size node image.
    expect(shown()).toBe(FULL_URL);
  });

  it('does not ask the node while the card is closed', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <ReticulumUserCard
        anchorEl={null}
        data={cardData}
        onClose={() => undefined}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    expect(h.calls).toHaveLength(0);
    expect(imageLoads).toHaveLength(0);
  });

  it('keeps the letter and opens no preview without an avatar', async () => {
    const h = createAvatarTestHarness({
      handler: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    setQdnAvatarCacheForTests(h.cache);
    render(
      <ReticulumUserCard
        anchorEl={null}
        anchorPosition={{ left: 10, top: 10 }}
        data={cardData}
        onClose={() => undefined}
      />
    );
    await act(async () => {
      await flushAsync();
    });
    const button = screen.getByRole('button', { name: "Open Alice's avatar" });
    expect(button.querySelector('img')).toBeNull();
    expect(button.textContent).toBe('A');
    fireEvent.click(button);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });
});
