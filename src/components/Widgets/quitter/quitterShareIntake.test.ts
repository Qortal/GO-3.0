import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const photoBytes = new Uint8Array(
  readFileSync(
    resolve(
      __dirname,
      '../../../utils/__fixtures__/media-metadata/phone-exif-gps.jpg'
    )
  )
);

vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (path: string) => `http://localhost${path}` },
}));

const sharedPhoto = (index: number) => ({
  path: `/cache/share/IMG_${2001 + index}.jpg`,
  name: `IMG_${2001 + index}.jpg`,
  mimeType: 'image/jpeg',
  size: photoBytes.length,
});
const share = vi.hoisted(() => ({
  pending: [] as unknown[],
  listener: null as null | (() => void),
  setShareTarget: null as null | ((target: string) => Promise<void>),
}));
share.pending = [sharedPhoto(0)];

vi.mock('../../../plugins/ShareReceiver', () => {
  share.setShareTarget = vi.fn(async () => undefined);
  return {
    isShareReceiverAvailable: () => true,
    ShareReceiver: {
      getPendingShare: vi.fn(async () => {
        const items = share.pending;
        share.pending = [];
        return items;
      }),
      consumeSharedFile: vi.fn(async () => undefined),
      getPendingRevShare: vi.fn(async () => null),
      setShareTarget: (target: string) => share.setShareTarget!(target),
      addShareListener: vi.fn(async (listener: () => void) => {
        share.listener = listener;
        return { remove: vi.fn() };
      }),
    },
  };
});

vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));

import { getDefaultStore } from 'jotai';
import { executeEvent } from '../../../utils/events';
import {
  homeComposerOpenAtom,
  setHomeComposerOpen,
} from './quitterComposerSession';
import {
  initQuitterShareIntake,
  QUITTER_SHARED_MEDIA_EVENT,
  takePendingQuitterShare,
} from './quitterShareIntake';

const readText = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(blob);
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Share to Torq intake', () => {
  it('hands the composer shared photos without their GPS/camera metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([photoBytes], { type: 'image/jpeg' }),
      }))
    );

    initQuitterShareIntake();
    let media: ReturnType<typeof takePendingQuitterShare> = null;
    await vi.waitFor(() => {
      media = media || takePendingQuitterShare();
      if (!media) throw new Error('share not drained yet');
    });
    expect(media.images).toHaveLength(1);
    const [image] = media.images;
    expect(image.mimeType).toBe('image/jpeg');
    expect(image.file.name).toBe('IMG_2001.jpg');
    expect(image.file.size).toBeLessThan(photoBytes.length);
    const body = await readText(image.file);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');
    // At boot the share-sheet entry is set to Torq, whatever was chosen.
    expect(share.setShareTarget).toHaveBeenCalledWith('torq');
    expect(share.setShareTarget).not.toHaveBeenCalledWith('quitter');
  });

  it('opens the composer in the Torq window, on Home', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([photoBytes], { type: 'image/jpeg' }),
      }))
    );
    setHomeComposerOpen(false);
    vi.mocked(executeEvent).mockClear();
    share.pending = [sharedPhoto(0)];
    share.listener!();
    await vi.waitFor(() => {
      if (!vi.mocked(executeEvent).mock.calls.length) {
        throw new Error('share not drained yet');
      }
    });
    // Open before Home looks: the window shows even with the feed off.
    expect(getDefaultStore().get(homeComposerOpenAtom)).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls.map(([name]) => name)).toEqual([
      'open-home-mode',
      QUITTER_SHARED_MEDIA_EVENT,
    ]);
    expect(takePendingQuitterShare()?.images).toHaveLength(1);
  });

  it('takes up to 10 shared photos, as a Torq post does', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([photoBytes], { type: 'image/jpeg' }),
      }))
    );
    const drain = async () => {
      share.listener!();
      let media: ReturnType<typeof takePendingQuitterShare> = null;
      await vi.waitFor(() => {
        media = media || takePendingQuitterShare();
        if (!media) throw new Error('share not drained yet');
      });
      return media!;
    };

    share.pending = Array.from({ length: 5 }, (_, i) => sharedPhoto(i));
    expect((await drain()).images).toHaveLength(5);

    share.pending = Array.from({ length: 12 }, (_, i) => sharedPhoto(i));
    expect((await drain()).images).toHaveLength(10);
  });
});
