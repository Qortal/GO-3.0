import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { blobControllerAtom } from '../../atoms/global';

vi.mock('./gifs/gifMediaCache', () => ({
  requestLibraryGifUrl: vi.fn(async () => 'blob:gif'),
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));

import {
  collectChatMedia,
  findChatMediaIndex,
  mediaKindOf,
  resolveChatMediaItem,
} from './chatMediaGallery';

const resource = (fileHash: string, extra: Record<string, unknown> = {}) => ({
  reticulumResource: true,
  fileHash,
  ...extra,
});

describe('chat media gallery', () => {
  afterEach(() => {
    delete (window as { reticulumResources?: unknown }).reticulumResources;
  });

  it('collects pictures and videos in chat order, nothing else', () => {
    const items = collectChatMedia([
      {
        signature: 'm1',
        reticulumChat: true,
        images: [resource('h1', { fileName: 'a.png' })],
      },
      {
        signature: 'm2',
        reticulumDirect: true,
        attachments: [
          resource('h2', { fileName: 'clip.mp4', mimeType: 'video/mp4' }),
          resource('h3', {
            fileName: 'notes.pdf',
            mimeType: 'application/pdf',
          }),
          resource('h4', { fileName: 'IMG_1.JPG' }),
        ],
      },
      // Still sending, or not Reticulum: left out.
      {
        signature: 'm3',
        reticulumChat: true,
        isTemp: true,
        images: [resource('h5')],
      },
      { signature: 'm4', images: [resource('h6')] },
      { signature: 'm5', reticulumChat: true, images: [{ fileHash: 'h7' }] },
    ]);
    expect(items.map((item) => [item.key, item.kind, item.fileHash])).toEqual([
      ['m1:image', 'image', 'h1'],
      ['m2:attachment:0', 'video', 'h2'],
      ['m2:attachment:2', 'image', 'h4'],
    ]);
  });

  it('tells videos and pictures by type, else by name', () => {
    expect(mediaKindOf('video/webm')).toBe('video');
    expect(mediaKindOf(undefined, 'holiday.MOV')).toBe('video');
    expect(mediaKindOf('image/webp')).toBe('image');
    expect(mediaKindOf('application/zip', 'a.zip')).toBeNull();
  });

  it('only shows what is on this device, and reads a video in when asked', async () => {
    const getUrl = vi.fn(async () => ({ success: true, url: 'blob:x' }));
    (window as { reticulumResources?: unknown }).reticulumResources = {
      getStatus: async (hash: string) => ({
        success: true,
        complete: hash !== 'missing',
      }),
      getUrl,
    };
    const video = {
      key: 'k',
      messageKey: 'm',
      fileHash: 'h',
      kind: 'video' as const,
    };
    expect(await resolveChatMediaItem(video, false)).toEqual({
      status: 'available',
    });
    expect(getUrl).not.toHaveBeenCalled();
    expect(await resolveChatMediaItem(video, true)).toEqual({
      status: 'ready',
      src: 'blob:x',
    });
    expect(
      await resolveChatMediaItem({ ...video, fileHash: 'missing' }, true)
    ).toEqual({ status: 'missing' });
  });
});

describe('chat media gallery: GIFs and QDN pictures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getDefaultStore().set(blobControllerAtom, {});
  });

  const messages = [
    {
      signature: 'g1',
      images: [
        {
          service: 'IMAGE',
          name: 'alice',
          identifier: 'gif-qortal-cat',
          libraryGif: true,
        },
      ],
    },
    {
      signature: 'q1',
      images: [{ service: 'IMAGE', name: 'bob', identifier: 'holiday' }],
    },
    {
      signature: 'd1',
      images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
    },
    {
      signature: 't1',
      messageText:
        '<p>look <span data-url="qortal://use-embed/IMAGE?name=carol&amp;identifier=sunset&amp;service=IMAGE&amp;mimeType=image%2Fjpeg">x</span></p>',
    },
    {
      signature: 'p1',
      messageText: '<p>qortal://use-embed/POLL?name=dave&poll=lunch</p>',
    },
  ];

  it('takes in GIFs, message pictures, inline pictures and image embeds', () => {
    const items = collectChatMedia(messages);
    expect(items.map((item) => item.key)).toEqual([
      'g1:gif',
      'q1:image-embed',
      'd1:image-data',
      't1:embed',
    ]);
    expect(items[0].gif).toEqual({
      name: 'alice',
      identifier: 'gif-qortal-cat',
    });
    expect(items[3].qdn).toEqual({
      service: 'IMAGE',
      name: 'carol',
      identifier: 'sunset',
      encrypted: false,
    });
  });

  it('finds the tapped picture by its message, else by its address', () => {
    const items = collectChatMedia([
      ...messages,
      { ...messages[1], signature: 'q2' },
    ]);
    const holiday = { service: 'IMAGE', name: 'bob', identifier: 'holiday' };
    expect(
      items[findChatMediaIndex(items, { messageKey: 'q2', qdn: holiday })]
        .messageKey
    ).toBe('q2');
    expect(items[findChatMediaIndex(items, { qdn: holiday })].messageKey).toBe(
      'q2'
    );
    expect(
      items[findChatMediaIndex(items, { messageKey: 'g1', gif: true })].key
    ).toBe('g1:gif');
  });

  it('loads a GIF, an inline picture, and a QDN picture once it is there', async () => {
    const items = collectChatMedia(messages);
    expect(await resolveChatMediaItem(items[0], true)).toEqual({
      status: 'ready',
      src: 'blob:gif',
    });
    expect(await resolveChatMediaItem(items[2], true)).toEqual({
      status: 'ready',
      src: 'data:image/png;base64,AAAA',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ status: 'READY' }) }))
    );
    expect(await resolveChatMediaItem(items[1], true)).toEqual({
      status: 'ready',
      src: 'http://node/arbitrary/IMAGE/bob/holiday',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ status: 'NOT_PUBLISHED' }) }))
    );
    expect(await resolveChatMediaItem(items[3], true)).toEqual({
      status: 'missing',
    });
  });

  it('reuses what the chat already decrypted for a group picture', async () => {
    const [item] = collectChatMedia([
      {
        signature: 'e1',
        images: [
          { service: 'IMAGE', name: 'grp', identifier: 'grp-q-manager_0-1' },
        ],
      },
    ]);
    expect(item.qdn?.encrypted).toBe(true);
    expect(await resolveChatMediaItem(item, true)).toEqual({
      status: 'missing',
    });
    getDefaultStore().set(blobControllerAtom, {
      'IMAGE-grp-grp-q-manager_0-1': { blobUrl: 'blob:decrypted' },
    });
    expect(await resolveChatMediaItem(item, true)).toEqual({
      status: 'ready',
      src: 'blob:decrypted',
    });
  });
});
