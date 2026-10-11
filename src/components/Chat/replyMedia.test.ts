import { describe, expect, it, vi } from 'vitest';

// libraryGifs imports globalApi, which pulls in background.ts.
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));

import {
  extractReplyPreviewText,
  getReplyMedia,
  hasReplyPreviewText,
  isSafeDataImageUrl,
  isSafeReplyThumbnailSrc,
  REPLY_THUMBNAIL_MAX_RESOURCE_BYTES,
  replyMediaLabelKey,
} from './replyMedia';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

const reticulumImage = (extra: Record<string, unknown> = {}) => ({
  reticulumResource: true,
  fileHash: 'h1',
  fileName: 'photo.webp',
  mimeType: 'image/webp',
  sizeBytes: 20_000,
  ...extra,
});

describe('getReplyMedia', () => {
  it('reads a Reticulum picture, with or without the chat flag', () => {
    const expected = {
      kind: 'image',
      key: 'rt:h1',
      source: { via: 'reticulum', fileHash: 'h1' },
    };
    expect(
      getReplyMedia({ reticulumChat: true, images: [reticulumImage()] })
    ).toEqual(expected);
    // An optimistic queue row has no reticulumChat flag.
    expect(getReplyMedia({ images: [reticulumImage()] })).toEqual(expected);
  });

  it('shows only an icon for big or encrypted pictures', () => {
    expect(
      getReplyMedia({
        images: [
          reticulumImage({ sizeBytes: REPLY_THUMBNAIL_MAX_RESOURCE_BYTES * 2 }),
        ],
      })
    ).toEqual({ kind: 'image', key: 'rt:h1', source: { via: 'none' } });
    expect(
      getReplyMedia({ images: [reticulumImage({ encrypted: true })] })
    ).toEqual({ kind: 'image', key: 'rt:h1', source: { via: 'none' } });
  });

  it('calls a GIF resource a GIF', () => {
    expect(
      getReplyMedia({ images: [reticulumImage({ mimeType: 'image/gif' })] })
        ?.kind
    ).toBe('gif');
    expect(
      getReplyMedia({
        images: [
          reticulumImage({
            mimeType: undefined,
            metadata: { originalMimeType: 'image/gif' },
          }),
        ],
      })?.kind
    ).toBe('gif');
  });

  it('reads a library GIF pointer', () => {
    expect(
      getReplyMedia({
        images: [
          {
            name: 'alice',
            identifier: 'gif-cat',
            service: 'IMAGE',
            libraryGif: true,
            mimeType: 'image/gif',
          },
        ],
      })
    ).toEqual({
      kind: 'gif',
      key: 'gif:alice::gif-cat',
      source: {
        via: 'library-gif',
        gif: { name: 'alice', identifier: 'gif-cat' },
      },
    });
  });

  it('accepts inline raster pictures', () => {
    expect(getReplyMedia({ images: [{ dataUrl: PNG }] })).toEqual({
      kind: 'image',
      key: `data:${PNG.length}:${PNG.slice(-32)}`,
      source: { via: 'data', src: PNG },
    });
    expect(
      getReplyMedia({ images: [{ base64: 'AAAA', mimeType: 'image/webp' }] })
        ?.source
    ).toEqual({ via: 'data', src: 'data:image/webp;base64,AAAA' });
    expect(
      getReplyMedia({ images: [{ dataUrl: 'data:image/gif;base64,R0lG' }] })
        ?.kind
    ).toBe('gif');
  });

  it('never turns other inline values into a src', () => {
    for (const image of [
      { dataUrl: 'https://tracker.example/p.gif' },
      { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { dataUrl: 'javascript:alert(1)' },
      { dataUrl: 'blob:https://evil.example/1' },
      { base64: 'PGh0bWw+', mimeType: 'text/html' },
    ]) {
      expect(getReplyMedia({ images: [image] })).toBeNull();
    }
  });

  it('reads legacy QDN pictures and marks private group ones encrypted', () => {
    expect(
      getReplyMedia({
        images: [{ service: 'IMAGE', name: 'alice', identifier: 'id' }],
      })
    ).toEqual({
      kind: 'image',
      key: 'qdn:IMAGE-alice-id',
      source: { via: 'qdn', qdnKey: 'IMAGE-alice-id', encrypted: false },
    });
    expect(
      getReplyMedia({
        images: [
          {
            service: 'IMAGE',
            name: 'alice',
            identifier: 'grp-q-manager_0-abc',
          },
        ],
      })?.source
    ).toEqual({
      via: 'qdn',
      qdnKey: 'IMAGE-alice-grp-q-manager_0-abc',
      encrypted: true,
    });
  });

  it('names video attachments, and treats other attachments as files', () => {
    const attachment = (fileName: string, mimeType?: string) => ({
      attachments: [
        {
          reticulumResource: true,
          fileHash: `f-${fileName}`,
          fileName,
          ...(mimeType ? { mimeType } : {}),
        },
      ],
    });
    expect(getReplyMedia(attachment('clip.mp4'))).toEqual({
      kind: 'video',
      key: 'att:f-clip.mp4',
      source: { via: 'none' },
    });
    expect(getReplyMedia(attachment('notes.pdf'))?.kind).toBe('file');
    // A picture sent as a file is a file card on the row.
    expect(getReplyMedia(attachment('IMG.JPG', 'image/jpeg'))?.kind).toBe(
      'file'
    );
  });

  it('returns null without media', () => {
    expect(getReplyMedia({ images: [{}], attachments: [] })).toBeNull();
    expect(getReplyMedia(null)).toBeNull();
    expect(getReplyMedia('m1')).toBeNull();
    expect(
      getReplyMedia({ deleted: true, images: [reticulumImage()] })
    ).toBeNull();
    expect(getReplyMedia({ messageText: '<p>hi</p>' })).toBeNull();
  });
});

describe('isSafeReplyThumbnailSrc', () => {
  it.each([
    ['blob:http://localhost/abc', true],
    [PNG, true],
    ['qortal-reticulum-resource://-/resource/x?token=y', true],
    ['https://ext-node.qortal.link/arbitrary/IMAGE/a/b', false],
    ['http://127.0.0.1:12391/arbitrary/IMAGE/a/b', false],
    ['file:///sdcard/a.png', false],
    ['/_capacitor_file_/data/a.png', false],
    ['javascript:alert(1)', false],
    ['data:image/svg+xml;base64,PHN2Zz4=', false],
    ['', false],
    [null, false],
  ])('%s → %s', (src, expected) => {
    expect(isSafeReplyThumbnailSrc(src)).toBe(expected);
  });

  it('accepts only raster data pictures', () => {
    expect(isSafeDataImageUrl('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isSafeDataImageUrl('data:text/html;base64,AAAA')).toBe(false);
  });
});

describe('reply preview text helpers', () => {
  it('maps kinds to label keys', () => {
    expect(replyMediaLabelKey('image')).toBe('core:reply_preview.photo');
    expect(replyMediaLabelKey('gif')).toBe('core:reply_preview.gif');
    expect(replyMediaLabelKey('video')).toBe('core:reply_preview.video');
    expect(replyMediaLabelKey('file')).toBe('core:attachment');
  });

  it('reads message html as plain text', () => {
    expect(extractReplyPreviewText('<p></p>')).toBe('');
    expect(extractReplyPreviewText('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(extractReplyPreviewText(undefined)).toBe('');
    expect(hasReplyPreviewText('<p></p>')).toBe(false);
    expect(hasReplyPreviewText('<p>nice</p>')).toBe(true);
  });
});
