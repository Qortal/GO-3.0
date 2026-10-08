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
import { composerTargetAtom } from './composerTarget';
import {
  initQuitterShareIntake,
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

describe('Share to Quitter / Torq intake', () => {
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
    // The share-sheet entry is renamed after the composer's app at boot.
    // Torq unless Quitter was chosen.
    expect(share.setShareTarget).toHaveBeenCalledWith('torq');
  });

  it('takes up to 10 shared photos for Torq, 2 for Quitter', async () => {
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

    getDefaultStore().set(composerTargetAtom, 'torq');
    share.pending = Array.from({ length: 5 }, (_, i) => sharedPhoto(i));
    expect((await drain()).images).toHaveLength(5);

    getDefaultStore().set(composerTargetAtom, 'quitter');
    share.pending = Array.from({ length: 5 }, (_, i) => sharedPhoto(i));
    expect((await drain()).images).toHaveLength(2);
  });
});
