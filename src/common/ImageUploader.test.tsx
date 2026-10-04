import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type CompressorOptions = {
  success: (result: Blob) => void;
  error: (err: Error) => void;
};

const compressor = vi.hoisted(() => ({
  run: null as null | ((file: Blob, opts: CompressorOptions) => void),
}));

vi.mock('compressorjs', () => ({
  default: class {
    constructor(file: Blob, opts: CompressorOptions) {
      compressor.run?.(file, opts);
    }
  },
}));

import ImageUploader from './ImageUploader';

const photoBytes = new Uint8Array(
  readFileSync(
    resolve(__dirname, '../utils/__fixtures__/media-metadata/exif-xmp.webp')
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

const pick = async (onPick: Mock<(file: File) => void>) => {
  const { container } = render(
    <ImageUploader onPick={onPick}>
      <span>avatar</span>
    </ImageUploader>
  );
  const input = container.querySelector('input');
  const file = new File([photoBytes], 'me.webp', { type: 'image/webp' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
  return onPick.mock.calls[0][0] as File;
};

beforeEach(() => {
  compressor.run = null;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ImageUploader (avatars)', () => {
  it('strips GPS/camera metadata when compression fails and the original is used', async () => {
    compressor.run = (_file, opts) => opts.error(new Error('canvas failed'));
    const picked = await pick(vi.fn());
    const body = await readText(picked);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');
    expect(body.startsWith('RIFF')).toBe(true);
  });

  it('strips metadata when Compressor.js hands back its input unchanged', async () => {
    compressor.run = (file, opts) => opts.success(file);
    const picked = await pick(vi.fn());
    expect(await readText(picked)).not.toContain('GPSSECRET');
  });
});
