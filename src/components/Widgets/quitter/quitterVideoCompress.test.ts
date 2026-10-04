import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startBackgroundVideoPrepare } from './quitterVideoCompress';

const clipBytes = () =>
  new Uint8Array(
    readFileSync(
      resolve(
        __dirname,
        '../../../utils/__fixtures__/media-metadata/android-xyz-mdta.mp4'
      )
    )
  );

const readText = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () =>
      done(Buffer.from(reader.result as ArrayBuffer).toString('latin1'));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const geotaggedClip = () =>
  new File([clipBytes()], 'holiday.mp4', { type: 'video/mp4' });

describe('Quitter video originals', () => {
  it('publishes an uncompressed MP4 without its recording location', async () => {
    const file = geotaggedClip();
    expect(await readText(file)).toContain('51.5021');
    const result = await startBackgroundVideoPrepare({
      file,
      size: file.size,
      name: file.name,
      mimeType: 'video/mp4',
      compressLevel: 'none',
    }).promise;

    expect(result.compressed).toBe(false);
    expect(result.file.size).toBe(file.size);
    expect(result.file.name).toBe('holiday.mp4');
    const body = await readText(result.file);
    expect(body).not.toContain('51.5021');
    expect(body).not.toContain('PrivateModel');
  });

  it('scrubs the original when native compression is unavailable', async () => {
    const file = geotaggedClip();
    const result = await startBackgroundVideoPrepare({
      file,
      // Pretend it is big enough that compression was wanted.
      size: 80 * 1024 * 1024,
      name: file.name,
      mimeType: 'video/mp4',
      compressLevel: 'high',
    }).promise;

    expect(result.compressed).toBe(false);
    expect(await readText(result.file)).not.toContain('51.5021');
  });
});
