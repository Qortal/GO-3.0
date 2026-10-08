import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./imageCompression', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./imageCompression')>()),
  // jsdom can't draw pictures: redrawing an odd format fails, as it can on
  // a WebView without that codec.
  compressImageFile: vi.fn(async () => {
    throw new Error('no canvas');
  }),
}));

import { cleanPastedFiles, cleanPastedImage } from './cleanPastedImage';

const fixture = (name: string, type: string, fileName = name) =>
  new File(
    [readFileSync(resolve(__dirname, '__fixtures__/media-metadata', name))],
    fileName,
    { type }
  );

const SECRETS = ['GPSSECRET', 'PrivateModel', 'SecretPhoneCo', 'SecretCity'];

const textOf = (file: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(file);
  });

describe('cleanPastedImage', () => {
  it('takes the location and device data out of a pasted photo', async () => {
    const photo = fixture(
      'phone-exif-gps.jpg',
      'image/jpeg',
      'IMG_at_home_2026.jpg'
    );
    expect(await textOf(photo)).toContain('GPSSECRET');
    const clean = await cleanPastedImage(photo);
    expect(clean).not.toBeNull();
    const body = await textOf(clean!);
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    // Nor the copier's own file name.
    expect(clean!.name).toBe('pasted-image.jpg');
    expect(clean!.type).toBe('image/jpeg');
  });

  it('cleans PNG and WebP screenshots too', async () => {
    for (const [name, type] of [
      ['exif-text.png', 'image/png'],
      ['exif-xmp.webp', 'image/webp'],
    ]) {
      const clean = await cleanPastedImage(fixture(name, type));
      const body = await textOf(clean!);
      for (const secret of SECRETS) expect(body).not.toContain(secret);
      expect(body).not.toContain('xmpmeta');
    }
  });

  it('refuses a picture it can neither read nor redraw', async () => {
    const odd = new File(
      [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])],
      'x.heic',
      {
        type: 'image/heic',
      }
    );
    expect(await cleanPastedImage(odd)).toBeNull();
  });

  it('drops refused pictures from a paste and keeps the rest', async () => {
    const files = await cleanPastedFiles([
      fixture('clean.jpg', 'image/jpeg'),
      new File([new Uint8Array([1, 2, 3])], 'x.heic', { type: 'image/heic' }),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ]);
    expect(files.map((file) => file.name)).toEqual([
      'pasted-image.jpg',
      'notes.txt',
    ]);
  });
});
