import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./walletAvatarCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./walletAvatarCache')>()),
  setWalletAvatarCache: vi.fn(async () => undefined),
}));

import {
  fullSizeAvatarRequestUrl,
  resetAvatarPublishesForTests,
} from '../components/Group/avatarPreviewUrls';
import {
  refreshOwnQdnAvatarOnce,
  resetOwnQdnAvatarRefreshForTests,
} from '../hooks/useOwnQdnAvatarRefresh';
import { setQdnAvatarCacheForTests } from '../lib/qdnAvatars/defaultCache';
import { qdnAvatarKey } from '../lib/qdnAvatars/keys';
import {
  createAvatarTestHarness,
  flushAsync,
  imageResponse,
  PNG_BYTES,
} from '../lib/qdnAvatars/testHarness';
import { applyPublishedOwnAvatar } from './ownQdnAvatarPublish';
import { setWalletAvatarCache } from './walletAvatarCache';

const pngDataUrl = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
const FULL_URL = 'http://node.test/arbitrary/THUMBNAIL/Alice/qortal_avatar';

beforeEach(() => {
  vi.mocked(setWalletAvatarCache).mockClear();
  resetOwnQdnAvatarRefreshForTests();
  resetAvatarPublishesForTests();
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

describe('applyPublishedOwnAvatar', () => {
  it('puts the new avatar in the cache and the wallet copy, without asking the node', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await expect(
      applyPublishedOwnAvatar('Alice', pngDataUrl, 'Qalice')
    ).resolves.toBe(true);
    await flushAsync();
    expect(h.cache.getSnapshot(qdnAvatarKey('Alice'))).toMatchObject({
      source: 'cache',
      status: 'ready',
    });
    expect(setWalletAvatarCache).toHaveBeenCalledWith(
      'Qalice',
      pngDataUrl,
      'Alice'
    );
    expect(h.calls).toHaveLength(0);
    // No session re-check that could fetch the old file from the node...
    expect(refreshOwnQdnAvatarOnce('Alice', 'ready')).toBe(false);
    // ...and no full-size load of the old node file for a while.
    expect(fullSizeAvatarRequestUrl(FULL_URL)).toBeNull();
  });

  it('asks the node again when the cache does not take the image', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await expect(applyPublishedOwnAvatar('Alice', svgDataUrl)).resolves.toBe(
      false
    );
    await h.idle();
    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.calls[0].url).toContain('/arbitrary/THUMBNAIL/Alice/');
    expect(setWalletAvatarCache).not.toHaveBeenCalled();
  });

  it('does nothing without a name', async () => {
    const h = createAvatarTestHarness({ handler: () => imageResponse() });
    setQdnAvatarCacheForTests(h.cache);
    await expect(applyPublishedOwnAvatar(' ', pngDataUrl, 'Q')).resolves.toBe(
      false
    );
    expect(setWalletAvatarCache).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(0);
  });
});
