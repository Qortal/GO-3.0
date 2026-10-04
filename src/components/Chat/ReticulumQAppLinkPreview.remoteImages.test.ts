import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import { createAvatarTestHarness } from '../../lib/qdnAvatars/testHarness';
import {
  ReticulumQAppLinkPreviews,
  resolveReticulumPreviewImageUrl,
} from './ReticulumQAppLinkPreview';
import { setCurrentNodeBaseResolver } from '../../utils/remoteContentPolicy';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));

const TRACKER = 'https://tracker.example/p.png?u=victim';

// App icons come from the avatar cache (a node that never answers here).
beforeEach(() => {
  setQdnAvatarCacheForTests(
    createAvatarTestHarness({
      handler: () => new Promise<Response>(() => {}),
    }).cache
  );
});

afterEach(() => {
  setQdnAvatarCacheForTests(null);
  vi.unstubAllGlobals();
  setCurrentNodeBaseResolver(() => null);
});

describe('resolveReticulumPreviewImageUrl remote images', () => {
  it('drops a publisher-chosen image on a third-party host', () => {
    expect(resolveReticulumPreviewImageUrl(TRACKER, 'Mallory', 'vid')).toBe('');
    expect(
      resolveReticulumPreviewImageUrl(
        'http://203.0.113.9/pixel.gif',
        'Mallory',
        'vid'
      )
    ).toBe('');
  });

  it('drops third-party images inside a SubWire cover object', () => {
    for (const field of ['src', 'data', 'base64', 'url']) {
      const resolved = resolveReticulumPreviewImageUrl(
        { [field]: TRACKER },
        'Mallory',
        'pub'
      );
      expect(resolved).not.toContain('tracker.example');
    }
  });

  it('keeps images served by a Qortal node, GO itself or inline data', () => {
    const local = 'http://127.0.0.1:12391/arbitrary/THUMBNAIL/a/b?async=true';
    expect(resolveReticulumPreviewImageUrl(local, 'a', 'b')).toBe(local);
    const publicNode = 'https://ext-node.qortal.link/arbitrary/IMAGE/a/b';
    expect(resolveReticulumPreviewImageUrl(publicNode, 'a', 'b')).toBe(
      publicNode
    );
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveReticulumPreviewImageUrl(inline, 'a', 'b')).toBe(inline);
    expect(resolveReticulumPreviewImageUrl({ url: local }, 'a', 'b')).toBe(
      local
    );
  });

  it('keeps images on the node GO is using now', () => {
    setCurrentNodeBaseResolver(() => 'https://my-node.example:12391');
    const own = 'https://my-node.example:12391/arbitrary/IMAGE/a/b';
    expect(resolveReticulumPreviewImageUrl(own, 'a', 'b')).toBe(own);
    expect(
      resolveReticulumPreviewImageUrl(
        'https://other-node.example:12391/arbitrary/IMAGE/a/b',
        'a',
        'b'
      )
    ).toBe('');
  });

  it('still builds node URLs for QDN identifiers', () => {
    expect(resolveReticulumPreviewImageUrl('cover-id', 'Alice', 'pub')).toBe(
      'http://127.0.0.1:12391/arbitrary/IMAGE/Alice/cover-id?async=true'
    );
  });
});

describe('ReticulumQAppLinkPreviews remote images', () => {
  it('shows the placeholder, not the tracker, for a Q-Tube poster on another host', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/arbitrary/resources/search')) {
        return { ok: true, json: async () => [] };
      }
      return {
        ok: true,
        json: async () => ({
          title: 'Tracker video',
          videoImage: TRACKER,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      createElement(ReticulumQAppLinkPreviews, {
        source: 'qortal://APP/Q-Tube/video/Mallory/remote-image-test-1',
      })
    );

    await waitFor(() =>
      expect(screen.getByText('Tracker video')).toBeVisible()
    );
    const sources = [...container.querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    );
    expect(sources.some((src) => src?.includes('tracker.example'))).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('tracker.example')
      )
    ).toBe(false);
  });
});
