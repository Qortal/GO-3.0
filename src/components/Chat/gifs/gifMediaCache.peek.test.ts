import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));

import {
  peekLibraryGifUrl,
  requestLibraryGifUrl,
  subscribeLibraryGifCached,
} from './gifMediaCache';

const GIF = { name: 'alice', identifier: 'gif-cat' };

describe('gifMediaCache peek', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads memory only and tells subscribers when a GIF arrives', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(peekLibraryGifUrl(GIF)).toBeNull();
    // Peeking never downloads.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockImplementation(
      async () =>
        new Response(new Uint8Array(200), {
          headers: { 'content-type': 'image/gif' },
        })
    );
    if (typeof URL.createObjectURL !== 'function') {
      (URL as { createObjectURL?: unknown }).createObjectURL = () => '';
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gif-cat');
    const listener = vi.fn(() => {
      throw new Error('a bad listener must not fail the load');
    });
    const unsubscribe = subscribeLibraryGifCached(listener);

    await expect(requestLibraryGifUrl(GIF)).resolves.toBe('blob:gif-cat');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(peekLibraryGifUrl(GIF)).toBe('blob:gif-cat');

    unsubscribe();
    await expect(requestLibraryGifUrl(GIF)).resolves.toBe('blob:gif-cat');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
