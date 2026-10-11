import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { type ReactNode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import '../../i18n/i18n';

const gifCache = vi.hoisted(() => ({
  urls: new Map<string, string>(),
  listeners: new Set<() => void>(),
  peek: vi.fn(),
  subscribe: vi.fn(),
  request: vi.fn(),
}));

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));
vi.mock('./gifs/gifMediaCache', () => ({
  peekLibraryGifUrl: gifCache.peek,
  subscribeLibraryGifCached: gifCache.subscribe,
  requestLibraryGifUrl: gifCache.request,
}));

import { blobControllerAtom } from '../../atoms/global';
import {
  __resetReplyThumbnailCacheForTests,
  ReplyImageThumbnail,
  resolveLocalReticulumThumbnailUrl,
} from './ReplyImageThumbnail';
import { type ReplyMedia } from './replyMedia';

type ResourceCallback = (payload: {
  fileHash?: string;
  complete?: boolean;
}) => void;

const reticulumMedia = (fileHash = 'h1'): ReplyMedia => ({
  kind: 'image',
  key: `rt:${fileHash}`,
  source: { via: 'reticulum', fileHash },
});

const ALT = 'Picture in the quoted message';

let fetchSpy: MockInstance;
let revokeSpy: MockInstance;
let resourceCallbacks: Set<ResourceCallback>;
let unsubscribeResource: Mock<() => void>;
let getStatus: ReturnType<typeof vi.fn>;
let getUrl: ReturnType<typeof vi.fn>;
let requestResource: ReturnType<typeof vi.fn>;
let requestDirectResource: ReturnType<typeof vi.fn>;

const complete = (extra: Record<string, unknown> = {}) => ({
  success: true,
  complete: true,
  totalBytes: 20_000,
  manifest: { mimeType: 'image/webp', sizeBytes: 20_000 },
  ...extra,
});

const emitResource = (payload: { fileHash?: string; complete?: boolean }) =>
  act(async () => {
    resourceCallbacks.forEach((cb) => cb(payload));
    await Promise.resolve();
  });

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

const thumbnailImg = () =>
  screen.getByTestId('reply-thumbnail').querySelector('img');

beforeEach(() => {
  gifCache.urls.clear();
  gifCache.listeners.clear();
  gifCache.peek
    .mockReset()
    .mockImplementation(
      (gif: { name: string; identifier: string }) =>
        gifCache.urls.get(`${gif.name}::${gif.identifier}`) ?? null
    );
  gifCache.subscribe.mockReset().mockImplementation((cb: () => void) => {
    gifCache.listeners.add(cb);
    return () => gifCache.listeners.delete(cb);
  });
  gifCache.request.mockReset();

  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('no network in this test'));
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => {};
  }
  revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

  resourceCallbacks = new Set();
  unsubscribeResource = vi.fn<() => void>();
  requestResource = vi.fn();
  requestDirectResource = vi.fn();
  (window as any).reticulumChat = {
    requestResource,
    requestDirectResource,
    onResource: vi.fn((cb: ResourceCallback) => {
      resourceCallbacks.add(cb);
      return () => {
        unsubscribeResource();
        resourceCallbacks.delete(cb);
      };
    }),
  };
  getStatus = vi.fn(async () => complete());
  getUrl = vi.fn(async () => ({ success: true, url: 'blob:h1' }));
  (window as any).reticulumResources = { getStatus, getUrl };
});

afterEach(() => {
  cleanup();
  const fetched = fetchSpy.mock.calls.length;
  const revoked = revokeSpy.mock.calls.length;
  fetchSpy.mockRestore();
  revokeSpy.mockRestore();
  __resetReplyThumbnailCacheForTests();
  delete (window as any).reticulumChat;
  delete (window as any).reticulumResources;
  // The thumbnail never downloads, never asks the network, never revokes.
  expect(fetched).toBe(0);
  expect(revoked).toBe(0);
  expect(requestResource).not.toHaveBeenCalled();
  expect(requestDirectResource).not.toHaveBeenCalled();
  expect(gifCache.request).not.toHaveBeenCalled();
});

describe('ReplyImageThumbnail', () => {
  it('shows a picture this device already has', async () => {
    render(<ReplyImageThumbnail media={reticulumMedia()} size="36px" />);

    const img = await screen.findByAltText(ALT);
    expect(img).toHaveAttribute('src', 'blob:h1');
    expect(img).toHaveStyle({ objectFit: 'cover' });
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByTestId('reply-thumbnail')).toHaveStyle({
      height: '36px',
      width: '36px',
    });
    expect(getStatus).toHaveBeenCalledWith('h1');
    // Loads at once (a local URL), with the icon under it until it draws.
    expect(img).not.toHaveAttribute('loading');
    expect(screen.getByTestId('ImageRoundedIcon')).toBeInTheDocument();
    fireEvent.load(img);
    expect(screen.queryByTestId('ImageRoundedIcon')).toBeNull();
    expect(screen.getByAltText(ALT)).toBe(img);
  });

  it('waits for the original row to finish its own download', async () => {
    getStatus.mockResolvedValue({ success: true, complete: false });
    const { unmount } = render(
      <ReplyImageThumbnail media={reticulumMedia()} size="36px" />
    );
    await flush();

    expect(screen.getByTestId('ImageRoundedIcon')).toBeInTheDocument();
    expect(thumbnailImg()).toBeNull();
    expect(getUrl).not.toHaveBeenCalled();
    expect(resourceCallbacks.size).toBe(1);

    // Another resource, or progress, changes nothing.
    await emitResource({ fileHash: 'other', complete: true });
    await emitResource({ fileHash: 'h1', complete: false });
    expect(getUrl).not.toHaveBeenCalled();

    getStatus.mockResolvedValue(complete());
    await emitResource({ fileHash: 'h1', complete: true });
    expect(await screen.findByAltText(ALT)).toHaveAttribute('src', 'blob:h1');
    // Resolved: no longer listening.
    expect(unsubscribeResource).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeResource).toHaveBeenCalledTimes(1);
  });

  it('stops listening when it unmounts while waiting', async () => {
    getStatus.mockResolvedValue({ success: true, complete: false });
    const { unmount } = render(
      <ReplyImageThumbnail media={reticulumMedia()} size="36px" />
    );
    await flush();
    expect(resourceCallbacks.size).toBe(1);
    unmount();
    expect(unsubscribeResource).toHaveBeenCalledTimes(1);
    expect(resourceCallbacks.size).toBe(0);
  });

  it.each([
    [
      'encrypted',
      complete({ manifest: { encrypted: true, mimeType: 'image/webp' } }),
    ],
    ['too big', complete({ totalBytes: 1_000_000 })],
    ['not a picture', complete({ manifest: { mimeType: 'video/mp4' } })],
  ])('reads nothing for a %s resource', async (_name, status) => {
    getStatus.mockResolvedValue(status);
    render(<ReplyImageThumbnail media={reticulumMedia()} size="36px" />);
    await flush();
    expect(getUrl).not.toHaveBeenCalled();
    expect(thumbnailImg()).toBeNull();
    expect(screen.getByTestId('ImageRoundedIcon')).toBeInTheDocument();
  });

  it('never shows a network URL', async () => {
    getUrl.mockResolvedValue({
      success: true,
      url: 'https://ext-node.qortal.link/arbitrary/IMAGE/a/b',
    });
    render(<ReplyImageThumbnail media={reticulumMedia()} size="36px" />);
    await flush();
    expect(getUrl).toHaveBeenCalledTimes(1);
    expect(thumbnailImg()).toBeNull();
  });

  it('retries once after a load error, then keeps the icon', async () => {
    render(<ReplyImageThumbnail media={reticulumMedia()} size="36px" />);
    const img = await screen.findByAltText(ALT);

    fireEvent.error(img);
    await flush();
    expect(getUrl).toHaveBeenCalledTimes(2);
    expect(thumbnailImg()).toBeNull();
    expect(screen.getByTestId('ImageRoundedIcon')).toBeInTheDocument();

    await flush();
    expect(getUrl).toHaveBeenCalledTimes(2);
  });

  it('takes a fresh URL after an error (an expired desktop token)', async () => {
    getUrl
      .mockResolvedValueOnce({
        success: true,
        url: 'qortal-reticulum-resource://-/resource/h1?token=old',
      })
      .mockResolvedValueOnce({
        success: true,
        url: 'qortal-reticulum-resource://-/resource/h1?token=new',
      });
    render(<ReplyImageThumbnail media={reticulumMedia()} size="36px" />);
    fireEvent.error(await screen.findByAltText(ALT));
    await waitFor(() =>
      expect(screen.getByAltText(ALT)).toHaveAttribute(
        'src',
        'qortal-reticulum-resource://-/resource/h1?token=new'
      )
    );
  });

  it('shares one local lookup between thumbnails of the same picture', async () => {
    render(
      <>
        <ReplyImageThumbnail media={reticulumMedia()} size="36px" />
        <ReplyImageThumbnail media={reticulumMedia()} size="36px" />
      </>
    );
    await waitFor(() => expect(screen.getAllByAltText(ALT)).toHaveLength(2));
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getUrl).toHaveBeenCalledTimes(1);
    await expect(resolveLocalReticulumThumbnailUrl('h1')).resolves.toBe(
      'blob:h1'
    );
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('shows a library GIF only from memory', async () => {
    const gif: ReplyMedia = {
      kind: 'gif',
      key: 'gif:alice::gif-cat',
      source: {
        via: 'library-gif',
        gif: { name: 'alice', identifier: 'gif-cat' },
      },
    };
    render(<ReplyImageThumbnail media={gif} size="36px" />);
    expect(screen.getByTestId('GifRoundedIcon')).toBeInTheDocument();
    expect(thumbnailImg()).toBeNull();

    // The chat's own GifImage puts it in memory.
    act(() => {
      gifCache.urls.set('alice::gif-cat', 'blob:gif1');
      gifCache.listeners.forEach((cb) => cb());
    });
    expect(screen.getByAltText(ALT)).toHaveAttribute('src', 'blob:gif1');
  });

  it('reuses a private QDN picture the chat already decrypted', () => {
    const qdn = (identifier: string, encrypted: boolean): ReplyMedia => ({
      kind: 'image',
      key: `qdn:IMAGE-alice-${identifier}`,
      source: {
        via: 'qdn',
        qdnKey: `IMAGE-alice-${identifier}`,
        encrypted,
      },
    });
    const store = createStore();
    const wrap = (node: ReactNode) => <Provider store={store}>{node}</Provider>;

    const { rerender } = render(
      wrap(
        <ReplyImageThumbnail
          media={qdn('grp-q-manager_0-x', true)}
          size="36px"
        />
      )
    );
    expect(thumbnailImg()).toBeNull();

    act(() => {
      store.set(blobControllerAtom, {
        'IMAGE-alice-grp-q-manager_0-x': { blobUrl: 'blob:qdn1' },
      });
    });
    expect(screen.getByAltText(ALT)).toHaveAttribute('src', 'blob:qdn1');

    rerender(
      wrap(<ReplyImageThumbnail media={qdn('plain', false)} size="36px" />)
    );
    expect(thumbnailImg()).toBeNull();
    expect(screen.getByTestId('ImageRoundedIcon')).toBeInTheDocument();
  });

  it('shows an inline picture right away, decorative when text says what it is', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo';
    render(
      <ReplyImageThumbnail
        media={{ kind: 'image', key: 'data:1:x', source: { via: 'data', src } }}
        size="36px"
        decorative
      />
    );
    const img = thumbnailImg();
    expect(img).toHaveAttribute('src', src);
    expect(img).toHaveAttribute('alt', '');
  });

  it('draws an icon for a video and nothing for a file', () => {
    const { rerender } = render(
      <ReplyImageThumbnail
        media={{ kind: 'video', key: 'att:v', source: { via: 'none' } }}
        size="36px"
      />
    );
    expect(screen.getByTestId('VideocamRoundedIcon')).toBeInTheDocument();
    expect(thumbnailImg()).toBeNull();

    rerender(
      <ReplyImageThumbnail
        media={{ kind: 'file', key: 'att:f', source: { via: 'none' } }}
        size="36px"
      />
    );
    expect(screen.queryByTestId('reply-thumbnail')).toBeNull();
    expect(getStatus).not.toHaveBeenCalled();
  });
});
