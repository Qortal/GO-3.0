/**
 * Image byte helpers for the QDN avatar cache. The node serves thumbnails as
 * `application/octet-stream`, so the image type comes from the magic bytes.
 */

/** Largest avatar the cache downloads (bytes). */
export const QDN_AVATAR_MAX_DOWNLOAD_BYTES = 1024 * 1024;
/** Cached avatars are shrunk to fit this square (never enlarged). */
const QDN_AVATAR_MAX_DIMENSION = 128;
/**
 * Largest source image the cache decodes (pixels, and longest side). A small
 * file can declare huge dimensions and make the phone decode hundreds of MB;
 * anything larger is treated as "not an avatar". 16.7 MP still lets through
 * an unscaled phone photo.
 */
const QDN_AVATAR_MAX_SOURCE_PIXELS = 4096 * 4096;
const QDN_AVATAR_MAX_SOURCE_SIDE = 8192;
/**
 * Animated GIF/WebP/PNG avatars up to this size are kept as published (still
 * animated) instead of being shrunk to their first frame.
 */
const QDN_AVATAR_MAX_ANIMATED_BYTES = 200 * 1024;

/** MIME type of an image file from its first bytes, or null. */
export function sniffImageType(bytes: ArrayBuffer | Uint8Array): string | null {
  if (!bytes) return null;
  const length = Math.min(16, bytes.byteLength);
  const head = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, length)
    : new Uint8Array(bytes, 0, length);
  if (head.length < 4) return null;
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'image/png';
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    return 'image/gif';
  }
  if (head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp';
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return 'image/webp';
  }
  // ISO-BMFF `ftyp` box with an AVIF brand.
  if (
    head.length >= 12 &&
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70 &&
    head[8] === 0x61 &&
    head[9] === 0x76 &&
    head[10] === 0x69 &&
    (head[11] === 0x66 || head[11] === 0x73)
  ) {
    return 'image/avif';
  }
  return null;
}

/** `data:` URL for image bytes (synchronous; avatars are small). */
export function bytesToDataUrl(bytes: ArrayBuffer, type: string): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(view.subarray(i, i + chunk))
    );
  }
  return `data:${type};base64,${btoa(binary)}`;
}

/** Bytes of a base64 `data:` URL, or null. */
export function dataUrlToBytes(url: string): AvatarImageBytes | null {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(url || '');
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes: bytes.buffer, type: match[1] };
  } catch {
    return null;
  }
}

/** Bytes of a Blob, ArrayBuffer or typed array; null when unreadable. */
export async function toArrayBuffer(
  data: Blob | ArrayBuffer | ArrayBufferView
): Promise<ArrayBuffer | null> {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    if (typeof data.arrayBuffer === 'function') return data.arrayBuffer();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        resolve(
          result && typeof result !== 'string' && 'byteLength' in result
            ? result
            : null
        );
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(data);
    });
  }
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return view.slice().buffer;
  }
  return data && typeof (data as ArrayBuffer).byteLength === 'number'
    ? (data as ArrayBuffer)
    : null;
}

export type AvatarImageBytes = {
  bytes: ArrayBuffer;
  type: string;
};

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): AnyCanvas | null {
  if (typeof OffscreenCanvas === 'function') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // fall through to a DOM canvas
    }
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(
  canvas: AnyCanvas,
  type: string,
  quality: number
): Promise<Blob | null> {
  try {
    if ('convertToBlob' in canvas) {
      return await canvas.convertToBlob({ type, quality });
    }
    return await new Promise<Blob | null>((resolve) => {
      (canvas as HTMLCanvasElement).toBlob(resolve, type, quality);
    });
  } catch {
    return null;
  }
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const i32le = (b: Uint8Array, i: number) =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const ascii = (b: Uint8Array, i: number, length: number) =>
  String.fromCharCode(...Array.from(b.subarray(i, i + length)));

const asBytes = (bytes: ArrayBuffer | Uint8Array): Uint8Array =>
  ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);

function jpegDimensions(b: Uint8Array) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      i += 2; // no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan data
    const length = u16be(b, i + 2);
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/**
 * Width and height from the image header, without decoding. null when the
 * format is not parsed here (AVIF) or the header is cut short.
 */
export function readImageDimensions(
  bytes: ArrayBuffer | Uint8Array
): { width: number; height: number } | null {
  try {
    const b = asBytes(bytes);
    const type = sniffImageType(b);
    if (type === 'image/png') {
      if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
      return { width: u32be(b, 16), height: u32be(b, 20) };
    }
    if (type === 'image/gif') {
      if (b.length < 10) return null;
      return { width: u16le(b, 6), height: u16le(b, 8) };
    }
    if (type === 'image/bmp') {
      if (b.length < 26) return null;
      if (i32le(b, 14) === 12) {
        return { width: u16le(b, 18), height: u16le(b, 20) };
      }
      return { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
    }
    if (type === 'image/webp') {
      if (b.length < 25) return null;
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X') {
        if (b.length < 30) return null;
        return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
      }
      if (chunk === 'VP8L') {
        if (b[20] !== 0x2f) return null;
        const bits =
          (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >>> 14) & 0x3fff) + 1,
        };
      }
      if (chunk === 'VP8 ') {
        if (b.length < 30) return null;
        if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
        return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
      }
      return null;
    }
    if (type === 'image/jpeg') return jpegDimensions(b);
    return null;
  } catch {
    return null;
  }
}

function gifFrameCount(b: Uint8Array, stopAt: number): number {
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1)); // global colours
  let frames = 0;
  const skipSubBlocks = () => {
    while (i < b.length) {
      const size = b[i];
      i += 1;
      if (!size) return;
      i += size;
    }
  };
  while (i < b.length && frames < stopAt) {
    const block = b[i];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      i += 2; // introducer + label
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      const flags = b[i + 9];
      i += 10;
      if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1)); // local colours
      i += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return frames;
}

function pngIsAnimated(b: Uint8Array): boolean {
  let i = 8;
  while (i + 12 <= b.length) {
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (type === 'acTL') return u32be(b, i + 8) > 1; // number of frames
    if (type === 'IDAT' || type === 'IEND') return false;
    i += 12 + length;
  }
  return false;
}

/** True for an animated GIF, WebP or PNG (more than one frame). */
export function isAnimatedImage(bytes: ArrayBuffer | Uint8Array): boolean {
  try {
    const b = asBytes(bytes);
    const type = sniffImageType(b);
    if (type === 'image/gif') return gifFrameCount(b, 2) > 1;
    if (type === 'image/webp') {
      return b.length > 20 && ascii(b, 12, 4) === 'VP8X' && !!(b[20] & 0x02);
    }
    if (type === 'image/png') return pngIsAnimated(b);
    return false;
  } catch {
    return false;
  }
}

/** False when the header declares an image too large to decode safely. */
export function hasSafeImageDimensions(
  bytes: ArrayBuffer | Uint8Array
): boolean {
  const size = readImageDimensions(bytes);
  if (!size) return true; // unknown header: let the decoder decide
  const { width, height } = size;
  return (
    width > 0 &&
    height > 0 &&
    width <= QDN_AVATAR_MAX_SOURCE_SIDE &&
    height <= QDN_AVATAR_MAX_SOURCE_SIDE &&
    width * height <= QDN_AVATAR_MAX_SOURCE_PIXELS
  );
}

/**
 * Shrinks an image to fit `maxDimension` x `maxDimension` (keeping its aspect
 * ratio) and re-encodes it as WebP, or PNG where WebP encoding is missing.
 * Images that already fit come back unchanged, and so do animated images up
 * to QDN_AVATAR_MAX_ANIMATED_BYTES (they keep their animation; larger ones
 * keep only the first frame). Resolves null when the header declares an
 * image too large to decode safely, or when the browser cannot decode it at
 * all (an <img> could not show it either); without createImageBitmap
 * (tests, old engines) the image is kept as is.
 */
export async function downscaleAvatarImage(
  image: AvatarImageBytes,
  maxDimension = QDN_AVATAR_MAX_DIMENSION
): Promise<AvatarImageBytes | null> {
  if (!hasSafeImageDimensions(image.bytes)) return null;
  if (typeof createImageBitmap !== 'function') return image;
  let bitmap: ImageBitmap | null = null;
  try {
    try {
      bitmap = await createImageBitmap(
        new Blob([image.bytes], { type: image.type })
      );
    } catch {
      return null;
    }
    const { width, height } = bitmap;
    if (!width || !height) return null;
    if (width <= maxDimension && height <= maxDimension) return image;
    if (
      image.bytes.byteLength <= QDN_AVATAR_MAX_ANIMATED_BYTES &&
      isAnimatedImage(image.bytes)
    ) {
      return image;
    }

    const scale = Math.min(maxDimension / width, maxDimension / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = makeCanvas(targetWidth, targetHeight);
    const context = canvas?.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!canvas || !context) return image;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/png', 1);
    }
    if (!blob || !blob.size) return image;
    const scaled = await toArrayBuffer(blob);
    if (!scaled?.byteLength) return image;
    return { bytes: scaled, type: blob.type || 'image/png' };
  } catch {
    return image;
  } finally {
    try {
      bitmap?.close();
    } catch {
      // ignore
    }
  }
}
