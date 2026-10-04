import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bytesToDataUrl,
  downscaleAvatarImage,
  hasSafeImageDimensions,
  isAnimatedImage,
  readImageDimensions,
  sniffImageType,
} from './imageBytes';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('sniffImageType', () => {
  it('recognises the image formats QDN avatars use', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0))).toBe(
      'image/png'
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBe('image/gif');
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)
      )
    ).toBe('image/webp');
    expect(
      sniffImageType(
        bytes(0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)
      )
    ).toBe('image/avif');
  });

  it('rejects JSON error bodies, HTML and short input', () => {
    const json = new TextEncoder().encode('{"error":1401}');
    expect(sniffImageType(json)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImageType(null as unknown as ArrayBuffer)).toBeNull();
  });
});

describe('bytesToDataUrl', () => {
  it('encodes bytes as base64', () => {
    expect(bytesToDataUrl(bytes(0x89, 0x50, 0x4e, 0x47), 'image/png')).toBe(
      'data:image/png;base64,iVBORw=='
    );
  });
});

describe('downscaleAvatarImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const image = { bytes: bytes(0x89, 0x50, 0x4e, 0x47), type: 'image/png' };

  it('returns the image unchanged without createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(downscaleAvatarImage(image)).resolves.toBe(image);
  });

  it('keeps images that already fit (never enlarges)', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 96, height: 96, close }))
    );
    await expect(downscaleAvatarImage(image)).resolves.toBe(image);
    expect(close).toHaveBeenCalled();
  });

  it('shrinks large images to fit 128x128 as WebP', async () => {
    const drawImage = vi.fn();
    const sizes: number[][] = [];
    class FakeOffscreenCanvas {
      constructor(width: number, height: number) {
        sizes.push([width, height]);
      }
      getContext() {
        return { drawImage, imageSmoothingEnabled: false };
      }
      async convertToBlob({ type }: { type: string }) {
        return new Blob([new Uint8Array([1, 2, 3])], { type });
      }
    }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1000, height: 500, close: vi.fn() }))
    );
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    const result = await downscaleAvatarImage(image);
    expect(sizes).toEqual([[128, 64]]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 128, 64);
    expect(result.type).toBe('image/webp');
    expect(result.bytes.byteLength).toBe(3);
  });

  it('resolves null when the browser cannot decode the image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode');
      })
    );
    await expect(downscaleAvatarImage(image)).resolves.toBeNull();
  });

  it('keeps the original when re-encoding fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 512, height: 512, close: vi.fn() }))
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      }
    );
    vi.stubGlobal('document', undefined);
    await expect(downscaleAvatarImage(image)).resolves.toBe(image);
  });
});

// ------------------------------------------------------------ header parsing

const be32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const text = (value: string) => Array.from(value, (c) => c.charCodeAt(0));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG chunk (the CRC is not checked). */
const pngChunk = (type: string, data: number[]) => [
  ...be32(data.length),
  ...text(type),
  ...data,
  ...be32(0),
];
const png = (width: number, height: number, frames = 0) =>
  new Uint8Array([
    ...PNG_SIG,
    ...pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...(frames ? pngChunk('acTL', [...be32(frames), ...be32(0)]) : []),
    ...pngChunk('IDAT', [0]),
  ]);

/** GIF89a with `frames` 1x1 frames and no colour tables. */
const gif = (width: number, height: number, frames: number) => {
  const out = [...text('GIF89a'), ...le16(width), ...le16(height), 0, 0, 0];
  for (let i = 0; i < frames; i += 1) {
    out.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0); // graphic control extension
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0); // image descriptor
    out.push(2, 2, 0x4c, 0x01, 0); // LZW data
  }
  out.push(0x3b);
  return new Uint8Array(out);
};

const riff = (chunk: string, data: number[]) =>
  new Uint8Array([
    ...text('RIFF'),
    ...le24(data.length + 12),
    0,
    ...text('WEBP'),
    ...text(chunk),
    ...le24(data.length),
    0,
    ...data,
  ]);
const webpVp8x = (width: number, height: number, animated: boolean) =>
  riff('VP8X', [
    animated ? 0x02 : 0,
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1),
  ]);
const webpVp8l = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff('VP8L', [
    0x2f,
    bits & 0xff,
    (bits >>> 8) & 0xff,
    (bits >>> 16) & 0xff,
    (bits >>> 24) & 0xff,
    0,
  ]);
};
const webpVp8 = (width: number, height: number) =>
  riff('VP8 ', [
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    ...le16(width),
    ...le16(height),
    0,
    0,
  ]);

/** SOI, an APP0 segment, a progressive SOF2 frame header, EOI. */
const jpeg = (width: number, height: number) =>
  new Uint8Array([
    ...[0xff, 0xd8],
    ...[0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46],
    ...[0xff, 0xc2, 0, 11, 8, height >> 8, height & 0xff],
    ...[width >> 8, width & 0xff, 1, 1, 0x11, 0],
    ...[0xff, 0xd9],
  ]);

describe('readImageDimensions', () => {
  it('reads the size from PNG, GIF, WebP, JPEG and BMP headers', () => {
    expect(readImageDimensions(png(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(gif(300, 200, 1))).toEqual({
      width: 300,
      height: 200,
    });
    expect(readImageDimensions(webpVp8x(1000, 800, false))).toEqual({
      width: 1000,
      height: 800,
    });
    expect(readImageDimensions(webpVp8l(256, 128))).toEqual({
      width: 256,
      height: 128,
    });
    expect(readImageDimensions(webpVp8(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions(jpeg(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
    const bmp = new Uint8Array(30);
    bmp.set(text('BM'));
    bmp.set([40, 0, 0, 0], 14);
    bmp.set([0x00, 0x02, 0, 0], 18); // 512
    bmp.set([0x00, 0xff, 0xff, 0xff], 22); // -256 (top-down)
    expect(readImageDimensions(bmp)).toEqual({ width: 512, height: 256 });
  });

  it('is null for formats it does not parse and cut-off headers', () => {
    expect(readImageDimensions(png(10, 10).slice(0, 20))).toBeNull();
    expect(readImageDimensions(new TextEncoder().encode('<html>'))).toBeNull();
    expect(
      readImageDimensions(
        bytes(0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)
      )
    ).toBeNull();
  });
});

describe('hasSafeImageDimensions', () => {
  it('rejects decompression bombs, allows photos and unknown headers', () => {
    expect(hasSafeImageDimensions(png(4032, 3024))).toBe(true);
    expect(hasSafeImageDimensions(png(20_000, 20_000))).toBe(false);
    expect(hasSafeImageDimensions(png(9000, 10))).toBe(false);
    expect(hasSafeImageDimensions(png(0, 10))).toBe(false);
    expect(hasSafeImageDimensions(gif(65535, 65535, 1))).toBe(false);
    expect(hasSafeImageDimensions(bytes(0x89, 0x50, 0x4e, 0x47))).toBe(true);
  });
});

describe('isAnimatedImage', () => {
  it('detects animated GIF, WebP and PNG', () => {
    expect(isAnimatedImage(gif(10, 10, 1))).toBe(false);
    expect(isAnimatedImage(gif(10, 10, 3))).toBe(true);
    expect(isAnimatedImage(webpVp8x(10, 10, true))).toBe(true);
    expect(isAnimatedImage(webpVp8x(10, 10, false))).toBe(false);
    expect(isAnimatedImage(webpVp8l(10, 10))).toBe(false);
    expect(isAnimatedImage(png(10, 10, 4))).toBe(true);
    expect(isAnimatedImage(png(10, 10, 1))).toBe(false);
    expect(isAnimatedImage(png(10, 10))).toBe(false);
    expect(isAnimatedImage(jpeg(10, 10))).toBe(false);
  });
});

describe('downscaleAvatarImage safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a huge image before decoding it', async () => {
    const decode = vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', decode);
    const bomb = { bytes: png(30_000, 30_000).buffer, type: 'image/png' };
    await expect(downscaleAvatarImage(bomb)).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('keeps a small animated avatar animated instead of flattening it', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 300, height: 300, close: vi.fn() }))
    );
    const canvas = vi.fn();
    vi.stubGlobal('OffscreenCanvas', canvas);
    const animated = { bytes: gif(300, 300, 2).buffer, type: 'image/gif' };
    await expect(downscaleAvatarImage(animated)).resolves.toBe(animated);
    expect(canvas).not.toHaveBeenCalled();
  });
});
